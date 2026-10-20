using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Export;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Descarte TOTAL do áudio no export (item 22, 2026-10-20) — os dois testes
/// end-to-end do filtro de intervalos/ADTS, extraídos de
/// <see cref="ClipExporterAtomicityTests"/> para o ficheiro original ficar abaixo
/// do limite de 800 linhas (AGENTS). Mesmo arrange, mesmas asserções; só mudou o
/// ficheiro. Usa a coleção <c>FfmpegPathOverride</c> (como os irmãos) porque
/// altera <c>FfmpegPathResolver</c> e <c>Log.Instance</c>, que são globais.
/// </summary>
[Collection("FfmpegPathOverride")]
public sealed class ClipExporterAudioFilterTests
{
    private static void TryDelete(string path)
    {
        try { if (File.Exists(path)) File.Delete(path); } catch { }
    }

    private static string? TryResolveRepoFfmpeg()
    {
        var candidates = new List<string?>
        {
            @"C:\Users\Windows\Desktop\001\resources\ffmpeg-custom\ffmpeg.exe",
            @"C:\Users\WENDEL\Desktop\001\resources\ffmpeg-custom\ffmpeg.exe",
            // O próprio resolver (staging de dev / publish / PATH), para os testes
            // não dependerem de um caminho fixo da minha máquina.
            SafeResolveDefault(),
        };
        foreach (var c in candidates)
            if (!string.IsNullOrEmpty(c) && File.Exists(c)) return c;
        return null;
    }

    private static string? SafeResolveDefault()
    {
        try { return FfmpegPathResolver.GetFfmpegPath(); }
        catch { return null; }
    }

    // ── Defesa em profundidade: descarte TOTAL do áudio (item 22) ────

    /// <summary>
    /// Quando TODOS os pacotes de áudio ADTS válidos são descartados pelo filtro de
    /// intervalos, o export é rejeitado com <c>ExpectedAudioMissing</c> — nunca
    /// publica um MP4 mudo silenciosamente.
    ///
    /// Antes da correcção <c>hasAudioTracks</c> era calculado DEPOIS do filtro, o
    /// verify aceitava o arquivo sem áudio (critério "caller não esperava áudio") e
    /// o clip mudo era publicado sem nenhum warning — o warning &lt;90% é suprimido
    /// com <c>audioDurationSec == 0</c>. O caller C# do export (EngineCoordinator)
    /// captura a excepção e loga <c>EXPORT FAILED</c>.
    /// </summary>
    [Fact]
    [Trait("Category", "Integration")]
    public void EndToEnd_AudioAllDiscardedByIntervalFilter_RejectsAndWarns()
    {
        var ffmpeg = TryResolveRepoFfmpeg();
        if (ffmpeg is null) return;
        FfmpegPathResolver.OverridePathForTest(ffmpeg);

        var dir = Path.Combine(Path.GetTempPath(), $"e2e_{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var final = Path.Combine(dir, "clip.mp4");
        var partial = ClipExporter.ResolveTempOutputPath(final);
        var thumb = ClipExporter.ResolveThumbnailPath(final);
        var originalLogger = Log.Instance;
        try
        {
            var video = FfmpegFixture.GenerateH264Packets(60, 320, 180); // 2.0 s

            // Áudio ADTS válido DEPOIS do fim do vídeo (2050–3050 ms num clipe de
            // 2000 ms): o desvio (≈1.05 s) é menor que o limiar de re-âncora (2 s),
            // então AlignAudioToVideoPts não mexe nos PTS e o filtro de intervalos
            // descarta 100% do áudio.
            var audio = FfmpegFixture.GenerateAdtsAacFrames(1.0, 48000, 2);
            foreach (var p in audio) p.Pts += TimeSpan.FromMilliseconds(2050);

            var recorder = new RecordingLogger();
            Log.Instance = recorder;

            using var exporter = new ClipExporter();
            var ex = Assert.Throws<InvalidOperationException>(
                () => exporter.ExportToMp4(final, video, audio, 320, 180, 60, "h264"));

            Assert.Contains("ExpectedAudioMissing", ex.Message);
            Assert.False(File.Exists(final), "MP4 mudo NÃO pode ser publicado quando o caller esperava áudio");
            Assert.False(File.Exists(partial), "parcial órfão deixado no diretório do usuário");
            Assert.Contains(recorder.Entries,
                e => e.Level == LogLevel.Warning && e.Message.Contains("descartado pelo filtro de intervalos"));
        }
        finally
        {
            Log.Instance = originalLogger;
            FfmpegPathResolver.OverridePathForTest(null);
            TryDelete(final); TryDelete(partial); TryDelete(thumb);
            try { Directory.Delete(dir, recursive: true); } catch { }
        }
    }

    /// <summary>
    /// Comportamento DELIBERADO preservado (ver
    /// <see cref="ClipExporterAtomicityTests.EndToEnd_ExpectedAudioMissing_IsRejectedNotPublished"/>):
    /// entrada 100% não-ADTS → publicado video-only é ACEITO (o caller não esperava
    /// áudio <b>válido</b>). A diferença aqui é que o descarte total fica REGISTADO com
    /// <c>Log.W</c> — antes era totalmente silencioso (o warning interno do
    /// <c>TrimNonAdtsPrefix</c> só dispara quando existe um pacote ADTS válido para
    /// aceitar no suffixo).
    /// </summary>
    [Fact]
    [Trait("Category", "Integration")]
    public void EndToEnd_AllNonAdtsAudio_PublishesVideoOnly_AndWarnsTotalDiscard()
    {
        var ffmpeg = TryResolveRepoFfmpeg();
        if (ffmpeg is null) return;
        FfmpegPathResolver.OverridePathForTest(ffmpeg);

        var dir = Path.Combine(Path.GetTempPath(), $"e2e_{Guid.NewGuid():N}");
        Directory.CreateDirectory(dir);
        var final = Path.Combine(dir, "clip.mp4");
        var partial = ClipExporter.ResolveTempOutputPath(final);
        var thumb = ClipExporter.ResolveThumbnailPath(final);
        var originalLogger = Log.Instance;
        try
        {
            var video = FfmpegFixture.GenerateH264Packets(60, 320, 180);
            var audio = new List<EncodedPacket>
            {
                new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.Zero, TimeSpan.FromMilliseconds(21), false),
                new(Array.Empty<byte>(), MediaType.Audio, TimeSpan.FromSeconds(1), TimeSpan.FromMilliseconds(21), false)
            };

            var recorder = new RecordingLogger();
            Log.Instance = recorder;

            using var exporter = new ClipExporter();
            exporter.ExportToMp4(final, video, audio, 320, 180, 60, "h264");

            // Deliberado: sem áudio ADTS válido não há ExpectedAudioMissing — o
            // arquivo publicado precisa existir e ter vídeo.
            Assert.True(File.Exists(final));
            Assert.False(File.Exists(partial));
            Assert.Contains("Video:", FfmpegFixture.Probe(final), StringComparison.OrdinalIgnoreCase);
            Assert.Contains(recorder.Entries,
                e => e.Level == LogLevel.Warning && e.Message.Contains("nenhum era ADTS válido"));
        }
        finally
        {
            Log.Instance = originalLogger;
            FfmpegPathResolver.OverridePathForTest(null);
            TryDelete(final); TryDelete(partial); TryDelete(thumb);
            try { Directory.Delete(dir, recursive: true); } catch { }
        }
    }

    /// <summary>
    /// Logger que registra as entradas emitidas pelo thread do teste. O
    /// <c>Log.Instance</c> é global e classes xUnit rodam em paralelo: ignora
    /// entradas de threads de fundo para as asserções serem determinísticas
    /// (padrão de <c>EngineCoordinatorCaptureTests</c>).
    /// </summary>
    private sealed class RecordingLogger : ILogger
    {
        private readonly int _threadId = Environment.CurrentManagedThreadId;
        private readonly object _gate = new();
        public List<(LogLevel Level, string Source, string Message)> Entries { get; } = new();

        private void Add(LogLevel level, string source, string message)
        {
            if (Environment.CurrentManagedThreadId != _threadId) return;
            lock (_gate)
            {
                Entries.Add((level, source, message));
            }
        }

        public void Debug(string source, string message) => Add(LogLevel.Debug, source, message);
        public void Info(string source, string message) => Add(LogLevel.Info, source, message);
        public void Warning(string source, string message) => Add(LogLevel.Warning, source, message);
        public void Error(string source, string message) => Add(LogLevel.Error, source, message);
        public void Log(LogLevel level, string source, string message) => Add(level, source, message);
    }
}
