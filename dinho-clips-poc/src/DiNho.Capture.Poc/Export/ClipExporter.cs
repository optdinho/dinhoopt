using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Text;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Export;

public sealed partial class ClipExporter : IDisposable
{
    private readonly object _exportLock = new();
    private bool _disposed;

    public static string GenerateOutputPath(string? directory = null)
    {
        directory ??= Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Desktop),
            "DiNhoClips");
        Directory.CreateDirectory(directory);
        return Path.Combine(directory, $"DiNho Optimizer {DateTime.Now:yyyy-MM-dd_HH-mm-ss}.mp4");
    }

    public string ExportToMp4(
        string outputPath,
        List<EncodedPacket> videoPackets,
        List<EncodedPacket> audioPackets,
        int width,
        int height,
        int frameRate,
        string rawFormat = "h264",
        byte[]? avccFallback = null)
    {
        if (videoPackets.Count == 0)
            throw new InvalidOperationException("No video packets to export");

        // Parse audio sample rate from first ADTS packet (used for padding & CodecDelay)
        int audioSampleRate = 48000;
        int audioChannels = 2;
        if (audioPackets.Count > 0 && audioPackets[0].Data.Length > 4)
        {
            int sri = (audioPackets[0].Data[2] >> 2) & 0x0F;
            int[] rates = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000];
            audioSampleRate = sri < rates.Length ? rates[sri] : 48000;
            audioChannels = ((audioPackets[0].Data[2] & 0x01) << 2) | ((audioPackets[0].Data[3] >> 6) & 0x03);
            if (audioChannels < 1 || audioChannels > 7) audioChannels = 2;
        }

        if (!Monitor.TryEnter(_exportLock))
            throw new InvalidOperationException("Export ja em andamento");

        try
        {
            var outputDir = Path.GetDirectoryName(Path.GetFullPath(outputPath))!;
            var drive = new DriveInfo(outputDir);
            if (drive.AvailableFreeSpace < 100_000_000)
                throw new InvalidOperationException(
                    $"Espaco insuficiente: {drive.AvailableFreeSpace / 1024 / 1024}MB");

            var mkvTemp = Path.Combine(Path.GetTempPath(), $"dhn_{Guid.NewGuid():N}.mkv");
            var adtsTemp = audioPackets.Count > 0
                ? Path.Combine(Path.GetTempPath(), $"dhn_{Guid.NewGuid():N}.adts")
                : null;

            try
            {
                // SYNC-PROBE: PTS offset between audio and video BEFORE any processing
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var vFirst = videoPackets[0].Pts;
                    var vLast = videoPackets[^1].Pts + videoPackets[^1].Duration;
                    var aFirst = audioPackets[0].Pts;
                    var aLast = audioPackets[^1].Pts + audioPackets[^1].Duration;
                    var startOffset = (aFirst - vFirst).TotalMilliseconds;
                    var endOffset = (aLast - vLast).TotalMilliseconds;
                    Log.I("SYNC-PROBE", $"ExportToMp4 RAW — Video: {vFirst.TotalSeconds:F3}s → {vLast.TotalSeconds:F3}s ({(vLast - vFirst).TotalSeconds:F2}s)  Audio: {aFirst.TotalSeconds:F3}s → {aLast.TotalSeconds:F3}s ({(aLast - aFirst).TotalSeconds:F2}s)  StartOffset={startOffset:F1}ms  EndOffset={endOffset:F1}ms");
                }

                double activeDurationSec = 0;
                double activeFps = frameRate;
                double trueVidDuration = 0;
                double audioDurationSec = 0;
                int gapsRemoved = 0;

                // Sync audio to video PTS intervals (handles alt-tab gaps)
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var vFirst = videoPackets[0].Pts;
                    var vLast = videoPackets[^1].Pts;
                    var aFirst = audioPackets[0].Pts;
                    var aLast = audioPackets[^1].Pts;
                    Log.D("PTS", $"Pre-sync — Video: {vFirst.TotalSeconds:F3}s → {vLast.TotalSeconds:F3}s ({videoPackets.Count} frames)  Audio: {aFirst.TotalSeconds:F3}s → {aLast.TotalSeconds:F3}s ({audioPackets.Count} packets)");

                    int origAudioCount = audioPackets.Count;
                    var intervals = GetVideoIntervals(videoPackets, TimeSpan.FromMilliseconds(50));
                    audioPackets = FilterAudioByIntervals(audioPackets, intervals);
                    gapsRemoved = origAudioCount - audioPackets.Count;
                    // Note: gapsRemoved is number of audio packets removed = original - filtered.

                    int startTrimmed = audioPackets.Count;
                    audioPackets = TrimAudioStart(audioPackets, videoPackets[0].Pts);
                    int startTrimCount = startTrimmed - audioPackets.Count;

                    activeDurationSec = ComputeIntervalsDuration(intervals);
                    trueVidDuration = videoPackets.Count >= 2
                        ? (videoPackets[^1].Pts - videoPackets[0].Pts).TotalSeconds + videoPackets[^1].Duration.TotalSeconds
                        : 0;

                    activeFps = activeDurationSec > 0 ? videoPackets.Count / activeDurationSec : frameRate;
                    if (activeFps < 1 || activeFps > frameRate * 3) activeFps = frameRate;

                    var lastVideoPts = videoPackets[^1].Pts + videoPackets[^1].Duration;
                    audioPackets = TrimAudioEnd(audioPackets, lastVideoPts);

                    // Sync start: só trima vídeo se offset >2s (AAC vs NVENC speed);
                    // offsets 30ms-2s com áudio após vídeo: não faz nada (áudio começa
                    // naturalmente, vídeo sem áudio por ~300ms é menos perceptível que
                    // silêncio artificial — ITU-R BT.1359: humano tolera áudio atrasado
                    // até 125ms como "detectável", 185ms como "aceitável").
                    // Offsets com áudio antes do vídeo: PadAudioWithSilence (silêncio
                    // no início do áudio para alinhar).
                    if (audioPackets.Count > 0 && videoPackets.Count > 0)
                    {
                        var offsetMs = (audioPackets[0].Pts - videoPackets[0].Pts).TotalMilliseconds;
                        if (offsetMs > 2000)
                        {
                            var target = audioPackets[0].Pts;
                            int trimIdx = videoPackets.FindIndex(p => p.Pts + p.Duration > target);
                            if (trimIdx > 0)
                            {
                                int lastKey = videoPackets.FindLastIndex(trimIdx, p => p.IsKeyFrame);
                                if (lastKey >= 0 && lastKey < trimIdx)
                                {
                                    Log.I("PTS", $"TrimVideoStart: rolling back from {trimIdx} to {lastKey} (keyframe at {videoPackets[lastKey].Pts.TotalSeconds:F3}s)");
                                    trimIdx = lastKey;
                                }
                                Log.I("PTS", $"TrimVideoStart: {trimIdx}/{videoPackets.Count} frames ({videoPackets[0].Pts.TotalSeconds:F3}s → {videoPackets[trimIdx].Pts.TotalSeconds:F3}s) because audio starts at {target.TotalSeconds:F3}s");
                                videoPackets = videoPackets.GetRange(trimIdx, videoPackets.Count - trimIdx);
                            }
                        }
                        else if (offsetMs < -30)
                        {
                            // Áudio começa ANTES do vídeo — não adiciona silêncio.
                            // O mixer já iniciou antes do NVENC produzir o 1º frame;
                            // silêncio artificial causaria delay incorreto.
                            // Passar null para PadAudioWithSilence = sem âncora, sem padding.
                            Log.D("PTS", $"NoSilenceNeeded: audio starts {-offsetMs:F0}ms before video — passing null anchor");
                            var silenceAnchor = audioPackets.Count > 0
                                && audioPackets[0].Pts < videoPackets[0].Pts
                                ? (TimeSpan?)null
                                : videoPackets[0].Pts;
                            audioPackets = PadAudioWithSilence(audioPackets, audioSampleRate, audioChannels, silenceAnchor);
                        }
                        else if (offsetMs > 30 && offsetMs <= 2000)
                        {
                            // Áudio começa DEPOIS do vídeo com offset pequeno — não faz nada.
                            // O vídeo toca sem áudio por alguns ms, que é menos perceptível
                            // que silêncio artificial no início do clipe.
                            Log.D("PTS", $"NoSyncNeeded: audio starts {offsetMs:F0}ms after video — letting audio start naturally");
                        }
                    }

                    if (audioPackets.Count > 0)
                    {
                        var af = audioPackets[0].Pts;
                        var al = audioPackets[^1].Pts + audioPackets[^1].Duration;
                        audioDurationSec = (al - af).TotalSeconds;
                    }
                    if (activeDurationSec > 5 && audioDurationSec > 0 && audioDurationSec < activeDurationSec * 0.9)
                        Log.W("PTS", $"audio duration {audioDurationSec:F2}s is <90% of active video {activeDurationSec:F2}s — {audioPackets.Count} packets may be insufficient");

                    var expectedDuration = (videoPackets[^1].Pts - videoPackets[0].Pts).TotalSeconds + videoPackets[^1].Duration.TotalSeconds;
                    var durDiff = expectedDuration - activeDurationSec;
                    Log.I("PTS", $"Post-sync — expectedDuration={expectedDuration:F2}s activeDuration={activeDurationSec:F2}s diff={durDiff:F3}s gapsRemoved={gapsRemoved} audioFrames={audioPackets.Count} startTrimmed={startTrimCount}");

                    Log.D("PTS", $"Post-sync — Video: trueDuration={trueVidDuration:F2}s activeDuration={activeDurationSec:F2}s fps={activeFps:F1} frames={videoPackets.Count}  Audio: packets={audioPackets.Count} gapsRemoved={gapsRemoved} startTrimmed={startTrimCount}");
                }

                // Frame-by-frame PTS drift diagnostic
                if (videoPackets.Count > 0 && audioPackets.Count > 0)
                {
                    var driftLog = new System.Text.StringBuilder();
                    driftLog.Append("PTS-DRIFT | ");
                    var vidStart = videoPackets[0].Pts;
                    var audStart = audioPackets[0].Pts;
                    var step = Math.Max(1, videoPackets.Count / 20);
                    for (int i = 0; i < videoPackets.Count; i += step)
                    {
                        var vp = videoPackets[i];
                        var nearestAudio = audioPackets
                            .Select(a => new { Pkt = a, Delta = (a.Pts - vp.Pts).Duration() })
                            .OrderBy(a => a.Delta)
                            .FirstOrDefault();
                        var drift = nearestAudio != null
                            ? (nearestAudio.Pkt.Pts - vp.Pts).TotalMilliseconds
                            : 0;
                        if (i > 0) driftLog.Append(", ");
                        driftLog.Append($"@{((vp.Pts - vidStart).TotalSeconds):F1}s vPTS={vp.Pts.TotalMilliseconds:F0} aPTS={nearestAudio?.Pkt.Pts.TotalMilliseconds:F0} drift={drift:F1}ms");
                    }
                    Log.I("SYNC", driftLog.ToString());
                }

                WriteMatroskaFile(mkvTemp, videoPackets, rawFormat, avccFallback,
                    audioPackets.Count > 0 ? audioPackets : null);
                var mkvLen = new FileInfo(mkvTemp).Length;
                var audioCount = audioPackets?.Count(p => p.Type == MediaType.Audio) ?? 0;
                Log.I("Exporter", $"MKV temp: {mkvTemp} ({mkvLen / 1024} KB) videoFrames={videoPackets.Count} audioPackets={audioCount}");

#if DEBUG
                // Copia MKV para o mesmo diretório do MP4 para diagnóstico
                try
                {
                    var mkvDiag = Path.Combine(
                        Path.GetDirectoryName(Path.GetFullPath(outputPath))!,
                        Path.GetFileNameWithoutExtension(outputPath) + ".mkv");
                    File.Copy(mkvTemp, mkvDiag, overwrite: true);
                    Log.D("Exporter", $"MKV diagnostic: {mkvDiag} ({new FileInfo(mkvDiag).Length / 1024} KB)");
                }
                catch (Exception ex)
                {
                    Log.W("Exporter", $"Failed to save MKV diagnostic: {ex.Message}");
                }

                // Hex dump first 200 bytes of MKV for diagnostics
                try
                {
                    var mkvBytes = new byte[Math.Min((int)mkvLen, 200)];
                    using (var mkvFs = File.OpenRead(mkvTemp))
                        mkvFs.ReadExactly(mkvBytes, 0, mkvBytes.Length);
                    var hex = new System.Text.StringBuilder();
                    for (int i = 0; i < mkvBytes.Length; i++)
                        hex.Append($"{mkvBytes[i]:X2} ");
                    Log.D("Exporter", $"MKV hex ({mkvBytes.Length}B)={hex.ToString().Trim()}");
                }
                catch { }
#endif

                Log.D("Exporter", $"nominalFps={frameRate} activeFps={activeFps:F1} activeDuration={activeDurationSec:F3}s totalDuration={trueVidDuration:F3}s videoFrames={videoPackets.Count} audioPackets={audioPackets.Count} gapsRemoved={gapsRemoved} audioDurationSec={audioDurationSec:F3}s");

                bool hasAudioTracks = audioPackets.Count > 0 && IsAdts(audioPackets[0]);

                // Log ASC + first audio bytes before mux for diagnostics
                if (hasAudioTracks && audioPackets.Count > 0)
                {
                    var asc = BuildAudioSpecificConfig(audioPackets[0]);
                    if (asc != null)
                    {
                        var ascHex = BitConverter.ToString(asc).Replace("-", " ");
                        Log.I("Exporter", $"ASC bytes: {ascHex} (profile={(asc[0] >> 3) & 0x1F} sampleRateIdx={((asc[0] & 0x07) << 1) | ((asc[1] >> 7) & 0x01)} channels={(asc[1] >> 3) & 0x0F})");
                    }
                    // First audio frame: show ADTS header + first 16 bytes of raw AAC
                    var firstPkt = audioPackets[0];
                    int adtsHdrLen = (firstPkt.Data[1] & 0x01) == 1 ? 7 : 9;
                    var adtsHex = BitConverter.ToString(firstPkt.Data, 0, Math.Min(adtsHdrLen, firstPkt.DataLength)).Replace("-", " ");
                    int rawStart = Math.Min(adtsHdrLen, firstPkt.DataLength);
                    int rawLen = Math.Min(16, firstPkt.DataLength - rawStart);
                    var rawHex = rawLen > 0 ? BitConverter.ToString(firstPkt.Data, rawStart, rawLen).Replace("-", " ") : "(empty)";
                    Log.I("Exporter", $"First audio: adtsHdr={adtsHex} rawStart={rawHex} totalLen={firstPkt.DataLength}B");
                }

                // Write audio to a separate raw ADTS file.
                // ffmpeg's -f adts demuxer reads ADTS natively and correctly sets
                // frame_size from the ADTS header — bypasses the Matroska demuxer
                // which doesn't set frame_size for A_AAC (causing "codec frame size
                // is not set" and audio silently dropped from MP4 output).
                if (hasAudioTracks && adtsTemp != null)
                {
                    WriteAdtsFile(adtsTemp, audioPackets);
                    var adtsLen = new FileInfo(adtsTemp).Length;
                    Log.I("Exporter", $"ADTS temp: {adtsTemp} ({adtsLen / 1024} KB) audioFrames={audioPackets.Count}");
                }

                MuxWithFfmpegStreaming(outputPath, mkvTemp, hasAudioTracks, rawFormat, adtsTemp);

                // Post-mux diagnostic: probe output MP4 for audio stream presence
                try
                {
                    using var probe = new Process
                    {
                        StartInfo = new ProcessStartInfo("ffmpeg")
                        {
                            Arguments = $"-i \"{outputPath}\"",
                            RedirectStandardError = true,
                            RedirectStandardOutput = true,
                            UseShellExecute = false,
                            CreateNoWindow = true
                        }
                    };
                    probe.Start();
                    var probeOutput = probe.StandardError.ReadToEnd();
                    probe.WaitForExit(10_000);
                    // Count audio/video streams
                    var hasVideoStream = probeOutput.Contains("Video:");
                    var hasAudioStream = probeOutput.Contains("Audio:");
                    var streamCount = System.Text.RegularExpressions.Regex.Matches(probeOutput, "Stream #").Count;
                    Log.I("Exporter", $"MP4 probe: streams={streamCount} video={hasVideoStream} audio={hasAudioStream}");
                    if (!hasAudioStream && hasAudioTracks)
                        Log.W("Exporter", $"MP4 probe FAILED: expected audio but none found! Full probe:\n{probeOutput}");
                    else if (hasAudioStream)
                        Log.I("Exporter", $"MP4 probe OK: audio stream present");
                }
                catch (Exception ex) { Log.W("Exporter", $"MP4 probe failed: {ex.Message}"); }

                // Gera thumbnail (320x180 JPEG) a partir do MP4 final
                try { GenerateThumbnail(outputPath); }
                catch (Exception ex) { Log.W("Exporter", $"Thumbnail generation failed: {ex.Message}"); }
            }
            finally
            {
                try { File.Delete(mkvTemp); } catch { }
                if (adtsTemp != null) try { File.Delete(adtsTemp); } catch { }
            }

            return outputPath;
        }
        finally
        {
            Monitor.Exit(_exportLock);
        }
    }

    private static void MuxWithFfmpegStreaming(
        string outputPath,
        string videoPath,
        bool hasAudioTracks,
        string rawFormat = "h264",
        string? adtsPath = null)
    {
        string args;
        if (hasAudioTracks && adtsPath != null && File.Exists(adtsPath))
        {
            // Two-input mux: Matroska for video, raw ADTS for audio.
            // ffmpeg's aac demuxer reads ADTS frames natively, correctly
            // sets frame_size=1024 and ASC extradata → MP4 muxer gets proper
            // codec info (no "codec frame size is not set" warning).
            // -c copy preserves exact quality of both video (NVENC) and audio (AAC).
            args = $"-y -loglevel warning " +
                   $"-f matroska -i \"{videoPath}\" " +
                   $"-f aac -i \"{adtsPath}\" " +
                   $"-map 0:v:0 -map 1:a:0 " +
                   $"-c:v copy -c:a copy " +
                   $"-metadata title=\"DiNho Clip\" -metadata comment=\"Recorded with DiNho Clips\" " +
                   $"-movflags +faststart \"{outputPath}\"";
        }
        else if (hasAudioTracks)
        {
            // Fallback: audio is in the Matroska (shouldn't happen with new flow)
            args = $"-y -loglevel warning " +
                   $"-f matroska -i \"{videoPath}\" " +
                   $"-map 0:v:0 -map 0:a:0 " +
                   $"-c:v copy -bsf:a aac_adtstoasc -c:a copy " +
                   $"-metadata title=\"DiNho Clip\" -metadata comment=\"Recorded with DiNho Clips\" " +
                   $"-movflags +faststart \"{outputPath}\"";
        }
        else
        {
            args = $"-y -loglevel warning " +
                   $"-f matroska -i \"{videoPath}\" " +
                   $"-map 0:v:0 -c:v copy " +
                   $"-metadata title=\"DiNho Clip\" -metadata comment=\"Recorded with DiNho Clips\" " +
                   $"-movflags +faststart \"{outputPath}\"";
        }

        Log.I("Exporter", $"ffmpeg mux: {args.Replace("\"", "'")}");

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = args,
                RedirectStandardInput = false,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        var stderr = new StringBuilder();
        proc.ErrorDataReceived += (s, e) =>
        {
            if (e.Data != null)
                lock (stderr) { stderr.AppendLine(e.Data); }
        };

        proc.Start();
        proc.BeginErrorReadLine();

        if (!proc.WaitForExit(300_000))
        {
            proc.Kill();
            throw new InvalidOperationException("ffmpeg nao terminou em 5min");
        }

        string finalStderr;
        lock (stderr) { finalStderr = stderr.ToString(); }

        if (proc.ExitCode != 0)
        {
            throw new InvalidOperationException(
                $"ffmpeg exit code {proc.ExitCode}: {finalStderr.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(finalStderr))
            Log.I("Exporter", $"ffmpeg stderr: {finalStderr.Trim()}");
    }

    internal static bool IsAdts(EncodedPacket pkt) =>
        pkt.Data.Length >= 2 && pkt.Data[0] == 0xFF && (pkt.Data[1] & 0xF0) == 0xF0;

    internal static void WriteAdtsFile(string path, List<EncodedPacket> audioPackets)
    {
        using var fs = new FileStream(path, FileMode.Create, FileAccess.Write,
            FileShare.Read, 256 * 1024, FileOptions.SequentialScan);
        foreach (var pkt in audioPackets)
        {
            if (pkt.Type != MediaType.Audio) continue;
            fs.Write(pkt.Data, 0, pkt.DataLength);
        }
    }

    internal static void GenerateThumbnail(string videoPath)
    {
        var thumbPath = Path.ChangeExtension(videoPath, ".thumb.jpg");

        using var proc = new Process
        {
            StartInfo = new ProcessStartInfo("ffmpeg")
            {
                Arguments = $"-y -loglevel warning -i \"{videoPath}\" -vframes 1 -s 320x180 -f image2 \"{thumbPath}\"",
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true
            }
        };

        proc.Start();
        proc.BeginErrorReadLine();

        if (!proc.WaitForExit(30_000))
        {
            proc.Kill();
            throw new InvalidOperationException("ffmpeg thumbnail timed out");
        }

        if (proc.ExitCode != 0)
            throw new InvalidOperationException($"ffmpeg thumbnail exit code {proc.ExitCode}");

        if (File.Exists(thumbPath))
            Log.I("Exporter", $"Thumbnail: {thumbPath} ({new FileInfo(thumbPath).Length / 1024} KB)");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
    }
}
