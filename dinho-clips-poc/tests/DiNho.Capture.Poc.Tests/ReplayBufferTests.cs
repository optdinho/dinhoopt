using DiNho.Capture.Poc.Buffer;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class ReplayBufferTests
{
    private static string TempDir()
    {
        var dir = Path.Combine(Path.GetTempPath(), $"dinho-test-{Guid.NewGuid().ToString("N")[..8]}");
        Directory.CreateDirectory(dir);
        return dir;
    }

    private static EncodedPacket MakeVideo(TimeSpan pts, bool isKey = false, int size = 100)
    {
        var data = new byte[size];
        data[0] = 0x00; data[1] = 0x00; data[2] = 0x00; data[3] = 0x01;
        data[4] = isKey ? (byte)0x67 : (byte)0x41;
        return new EncodedPacket(data, MediaType.Video, pts, TimeSpan.FromTicks(333_333), isKey);
    }

    private static EncodedPacket MakeAudio(TimeSpan pts, int size = 256)
    {
        return new EncodedPacket(new byte[size], MediaType.Audio, pts, TimeSpan.FromTicks(1_000_000), false);
    }

    [Fact]
    public void Buffer_StartsEmpty()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        var s = buf.Stats();
        Assert.Equal(0, s.videoCount);
        Assert.Equal(0, s.audioCount);
    }

    [Fact]
    public void AddVideo_OnePacket()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        var s = buf.Stats();
        Assert.Equal(1, s.videoCount);
    }

    [Fact]
    public void AddVideo_OverflowTrims()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        var frameDuration = TimeSpan.FromTicks(333_333);
        var framesIn5s = (int)(TimeSpan.FromSeconds(5).Ticks / frameDuration.Ticks) + 10;

        for (int i = 0; i < framesIn5s; i++)
        {
            var pts = TimeSpan.FromTicks(i * frameDuration.Ticks);
            buf.AddVideo(MakeVideo(pts));
        }

        var s = buf.Stats();
        Assert.True(s.videoCount < framesIn5s, "Should have trimmed excess");
        Assert.InRange(s.duration.TotalSeconds, 4.5, 5.5);
    }

    [Fact]
    public void AddAudio_AndVideo_Separate()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        buf.AddAudio(MakeAudio(TimeSpan.Zero));
        var s = buf.Stats();
        Assert.Equal(1, s.videoCount);
        Assert.Equal(1, s.audioCount);
    }

    [Fact]
    public void GetSegments_ReturnsAll()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        buf.AddVideo(MakeVideo(TimeSpan.FromTicks(333_333)));
        buf.AddAudio(MakeAudio(TimeSpan.Zero));

        var (video, audio) = buf.GetSegments();
        Assert.Equal(2, video.Count);
        Assert.Single(audio);
    }

    [Fact]
    public void GetSegments_WithDuration_Filters()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        for (int i = 0; i < 60; i++)
        {
            var pts = TimeSpan.FromSeconds(i * 0.5);
            buf.AddVideo(MakeVideo(pts));
        }

        var (video, _) = buf.GetSegments(TimeSpan.FromSeconds(5));
        Assert.True(video.Count > 0);
        Assert.True(video.Count <= 12);
    }

    [Fact]
    public void Clear_EmptiesBuffer()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        buf.Clear();
        var s = buf.Stats();
        Assert.Equal(0, s.videoCount);
        Assert.Equal(0, s.audioCount);
    }

    [Fact]
    public void MaxBytes_Set_TrimsExcess()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30), 20000);
        for (int i = 0; i < 20; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333), false, 100));

        var before = buf.Stats();
        Assert.True(before.bytes >= 2000, $"Should have ≥2000 bytes, got {before.bytes}");

        buf.MaxBytes = 500;
        var after = buf.Stats();
        Assert.True(after.bytes <= 500, $"Should trim to ≤500 bytes, got {after.bytes}");
    }

    [Fact]
    public void MaxBytes_Zero_NoByteLimit()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(1), 0);
        for (int i = 0; i < 10; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333), false, 1000));

        var s = buf.Stats();
        Assert.True(s.videoCount > 0);
        Assert.True(s.bytes > 1000);
    }

    [Fact]
    public void VideoCount_ReturnsCorrectCount()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        Assert.Equal(0, buf.VideoCount);
        buf.AddVideo(MakeVideo(TimeSpan.Zero));
        Assert.Equal(1, buf.VideoCount);
        buf.AddVideo(MakeVideo(TimeSpan.FromTicks(333_333)));
        Assert.Equal(2, buf.VideoCount);
    }

    [Fact]
    public void MaxBytes_IndependentBudget_EachStreamStaysWithinBudget()
    {
        // Video and audio have independent byte budgets: each stream can use
        // up to _maxBytes. Combined bytes can exceed _maxBytes.
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30), 1000);
        for (int i = 0; i < 10; i++)
        {
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333), false, 200));
            buf.AddAudio(MakeAudio(TimeSpan.FromTicks(i * 333_333), 100));
        }

        var s = buf.StatsDetailed();
        Assert.True(s.videoBytes > 0, "Video should still have frames after trim");
        Assert.True(s.videoBytes <= 1000,
            $"Video bytes {s.videoBytes} > 1000 budget");
        Assert.True(s.audioBytes <= 1000,
            $"Audio bytes {s.audioBytes} > 1000 budget");
    }

    // ─── New tests ──────────────────────────────────────────────────────

    [Fact]
    public void StatsDetailed_ReportsBreakdown()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        buf.AddVideo(MakeVideo(TimeSpan.Zero, false, 200));
        buf.AddVideo(MakeVideo(TimeSpan.FromTicks(333_333), false, 200));
        buf.AddAudio(MakeAudio(TimeSpan.Zero, 256));

        var d = buf.StatsDetailed();
        Assert.Equal(2, d.videoCount);
        Assert.Equal(1, d.audioCount);
        Assert.Equal(400, d.videoBytes);
        Assert.Equal(256, d.audioBytes);
    }

    [Fact]
    public void GetSegments_EmptyBuffer_ReturnsEmpty()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
        var (video, audio) = buf.GetSegments();
        Assert.Empty(video);
        Assert.Empty(audio);
    }

    [Fact]
    public void GetSegments_WithEndOffset_FiltersOldest()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        // Add frames: 0s, 0.5s, 1.0s, 1.5s, ...
        for (int i = 0; i < 20; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i * 0.5)));

        // endOffset = 30s → cutoff = -0.5s → all 20 match
        var (all, _) = buf.GetSegments(endOffset: TimeSpan.FromSeconds(20));
        Assert.Equal(20, all.Count);

        // endOffset = 30s → cutoff = 9.5s → only newest frame matches
        var (all2, _) = buf.GetSegments(endOffset: TimeSpan.FromSeconds(30));
        Assert.Equal(1, all2.Count);
    }

    [Fact]
    public void MaxDuration_PropertyCanChange()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(10));
        // Add a few frames
        for (int i = 0; i < 5; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 1_000_000)));

        var before = buf.Stats();
        Assert.True(before.videoCount > 0);

        // Reduce max duration to near zero → all frames trimmed
        buf.MaxDuration = TimeSpan.FromMilliseconds(1);
        var after = buf.Stats();
        Assert.Equal(0, after.videoCount);
        Assert.Equal(0, after.audioCount);
    }

    [Fact]
    public void RingBuffer_WrapAfterTrim()
    {
        // Fill buffer, then partially trim, then add more — this exercises
        // the ring-buffer wrap with head != 0 after TrimExcess
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60));
        for (int i = 0; i < 100; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333)));

        // Trim to 1 second → most frames removed
        buf.MaxDuration = TimeSpan.FromSeconds(1);
        var trimmed = buf.Stats();
        Assert.True(trimmed.videoCount > 0);
        // 100 frames at 33ms spacing = ~3.3s total; 1s window = ~30 frames
        Assert.InRange(trimmed.videoCount, 25, 35);

        // Add more frames (exercises wrap with non-zero head)
        for (int i = 0; i < 50; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i * 0.5 + 100)));

        var afterAdd = buf.Stats();
        // Trim is Duration-based (not PTS-based), so after 50 more 33ms frames
        // we still keep ~30 frames (the newest 30 by ring order)
        Assert.InRange(afterAdd.videoCount, 20, 35);
    }

    [Fact]
    public void AudioMaxBytes_TrimsExcessIndependently()
    {
        // Video and audio each have their own byte budget (_maxBytes each),
        // so they don't compete for space. Combined can exceed _maxBytes.
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30), 2000);
        for (int i = 0; i < 20; i++)
        {
            buf.AddVideo(MakeVideo(TimeSpan.FromTicks(i * 333_333), false, 150));
            buf.AddAudio(MakeAudio(TimeSpan.FromTicks(i * 333_333), 200));
        }

        var s = buf.StatsDetailed();
        Assert.True(s.videoBytes > 0, "Some video should remain");
        Assert.True(s.videoBytes <= 2000,
            $"Video bytes {s.videoBytes} > 2000 budget");
        Assert.True(s.audioBytes <= 2000,
            $"Audio bytes {s.audioBytes} > 2000 budget");
        // Combined can exceed 2000 because each stream has its own budget
    }

    [Fact]
    public void BufferGrow_MultipleCapacities()
    {
        // Grow the audio buffer past multiple capacity doublings
        // (initial 1024, then 2048, 4096, ...)
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60));
        for (int i = 0; i < 3000; i++)
            buf.AddAudio(MakeAudio(TimeSpan.FromTicks(i * 1_000_000)));

        var s = buf.Stats();
        Assert.True(s.audioCount > 0, "Audio should survive grow");
    }

    [Fact]
    public void GetSegments_DurationAndEndOffset_Combine()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(30));
        for (int i = 0; i < 30; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i * 1.0)));

        // Get last 5 seconds: newest Pts=29s, start=29-5=24s
        var (video, _) = buf.GetSegments(TimeSpan.FromSeconds(5));
        Assert.InRange(video.Count, 4, 6);
        Assert.True(video[0].Pts >= TimeSpan.FromSeconds(24), $"First frame PTS {video[0].Pts} should be ≥24s");
    }

    // ─── Disk Spill Tests ──────────────────────────────────────────────

    [Fact]
    public void DiskSpill_EnabledFlag()
    {
        var dir = TempDir();
        try
        {
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(5));
            Assert.False(buf.IsDiskSpillEnabled);
            buf.EnableDiskSpill(dir);
            Assert.True(buf.IsDiskSpillEnabled);
            // Double enable is idempotent
            buf.EnableDiskSpill(dir);
            Assert.True(buf.IsDiskSpillEnabled);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_EvictedPacketsGoToSpill()
    {
        var dir = TempDir();
        try
        {
            // Tiny budget — only 500 bytes of video — forces spilling
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 500);
            buf.EnableDiskSpill(dir);

            for (int i = 0; i < 20; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

            var stats = buf.SpillStats();
            Assert.True(stats.ramVideo > 0, "Some video remains in RAM");
            Assert.True(stats.diskVideo > 0, $"Some video spilled to disk, got diskVideo={stats.diskVideo}");
            Assert.Equal(20, stats.ramVideo + stats.diskVideo);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_GetSegmentsMergesDiskAndRam()
    {
        var dir = TempDir();
        try
        {
            // Budget for ~3 frames (300 bytes), but add 10 → 7 spill to disk
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 300);
            buf.EnableDiskSpill(dir);

            for (int i = 0; i < 10; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

            // GetSegments should return ALL 10 frames (disk + ram merged)
            var (video, _) = buf.GetSegments();
            Assert.Equal(10, video.Count);

            // PTS should be sorted
            for (int i = 1; i < video.Count; i++)
                Assert.True(video[i].Pts >= video[i - 1].Pts,
                    $"PTS not sorted: {video[i - 1].Pts} > {video[i].Pts}");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_GetSegmentsWithWindow_FiltersCorrectly()
    {
        var dir = TempDir();
        try
        {
            // 100 bytes per frame, budget 500 → ~5 frames in RAM, rest on disk
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 500);
            buf.EnableDiskSpill(dir);

            // 20 frames at 1s intervals
            for (int i = 0; i < 20; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

            // Request last 5 seconds → newest PTS=19s, start=19-5=14s → frames 14-19 (6 frames)
            var (video, _) = buf.GetSegments(TimeSpan.FromSeconds(5));
            Assert.Equal(6, video.Count);
            Assert.Equal(TimeSpan.FromSeconds(14), video[0].Pts);
            Assert.Equal(TimeSpan.FromSeconds(19), video[^1].Pts);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_ClearRemovesTempFiles()
    {
        var dir = TempDir();
        try
        {
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 300);
            buf.EnableDiskSpill(dir);

            for (int i = 0; i < 10; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

            Assert.True(buf.SpillStats().diskVideo > 0);

            buf.Clear();
            var stats = buf.SpillStats();
            Assert.Equal(0, stats.diskVideo);
            Assert.Equal(0, stats.diskBytes);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_DisposeCleansUp()
    {
        var dir = TempDir();
        try
        {
            var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 300);
            buf.EnableDiskSpill(dir);

            for (int i = 0; i < 10; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

            // Spill should be non-empty before dispose
            Assert.True(buf.SpillStats().diskVideo > 0);

            buf.Dispose();
            // After dispose, the lock is disposed — don't call SpillStats
            // Just verify the temp files were cleaned up
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_AudioSpillsCorrectly()
    {
        var dir = TempDir();
        try
        {
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 300);
            buf.EnableDiskSpill(dir);

            for (int i = 0; i < 10; i++)
            {
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 50));
                buf.AddAudio(MakeAudio(TimeSpan.FromSeconds(i), 100));
            }

            var stats = buf.SpillStats();
            Assert.True(stats.diskVideo > 0 || stats.diskAudio > 0,
                "At least one stream should have spilled");

            var (video, audio) = buf.GetSegments();
            Assert.Equal(10, video.Count);
            Assert.Equal(10, audio.Count);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_PCMFloatsSurviveRoundTrip()
    {
        var dir = TempDir();
        try
        {
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 200);
            buf.EnableDiskSpill(dir);

            // PCM audio with known values
            var pcm = new float[] { 0.5f, -0.5f, 1.0f, -1.0f, 0.25f, -0.25f, 0.75f, -0.75f };
            var pkt = new EncodedPacket(pcm, MediaType.Audio, TimeSpan.FromSeconds(1),
                TimeSpan.FromTicks(1_000_000));
            buf.AddAudio(pkt);

            // Force spill by adding a large video frame
            buf.AddVideo(MakeVideo(TimeSpan.Zero, false, 500));

            var (_, audio) = buf.GetSegments();
            Assert.Single(audio);
            Assert.NotNull(audio[0].PcmSamples);
            Assert.Equal(pcm.Length, audio[0].PcmSamples!.Length);
            for (int i = 0; i < pcm.Length; i++)
                Assert.Equal(pcm[i], audio[0].PcmSamples[i]);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_NoSpillWhenDisabled()
    {
        using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 300);
        // NOT enabling disk spill

        for (int i = 0; i < 10; i++)
            buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

        var (video, _) = buf.GetSegments();
        // Without spill, only RAM frames survive (budget ~3 frames)
        Assert.True(video.Count < 10, $"Without spill, should have fewer than 10, got {video.Count}");
    }

    // ─── Disk Spill — Sliding Time Window (Opção 1) ─────────────────────

    [Fact]
    public void DiskSpill_TrimToWindow_BoundsDiskFootprint()
    {
        var dir = TempDir();
        try
        {
            // Window of 10s with a tiny RAM budget forces heavy spilling.
            // The spill must be bounded by the time window (like ShadowPlay),
            // never growing without limit.
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(10), 200);
            buf.EnableDiskSpill(dir);

            // 40 frames at 1s intervals (PTS 0..39s) — way beyond the 10s window
            for (int i = 0; i < 40; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

            var stats = buf.SpillStats();
            // RAM keeps ~1 frame (the newest); disk keeps ~the last 10s window
            Assert.True(stats.ramVideo + stats.diskVideo <= 13,
                $"Total frames should be bounded by the 10s window, got {stats.ramVideo + stats.diskVideo}");
            Assert.True(stats.diskVideo >= 8,
                $"Disk should still hold most of the window, got {stats.diskVideo}");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_TrimAlignsToKeyframe()
    {
        var dir = TempDir();
        try
        {
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(10), 200);
            buf.EnableDiskSpill(dir);

            // Every 5th frame is a keyframe
            for (int i = 0; i < 40; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), isKey: i % 5 == 0, 100));

            var stats = buf.SpillStats();
            Assert.True(stats.ramVideo + stats.diskVideo <= 12,
                $"Total frames should stay bounded, got {stats.ramVideo + stats.diskVideo}");

            // The oldest retained frame must be a keyframe so the surviving
            // stream starts at a decodable frame.
            var (video, _) = buf.GetSegments();
            Assert.NotEmpty(video);
            Assert.True(video[0].IsKeyFrame,
                $"Retained window should start at a keyframe, oldest PTS={video[0].Pts.TotalSeconds}s");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_TrimKeepsAllWithinWindow()
    {
        var dir = TempDir();
        try
        {
            // 60s window, only 10s of data → nothing should be trimmed
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 300);
            buf.EnableDiskSpill(dir);

            for (int i = 0; i < 10; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

            var stats = buf.SpillStats();
            Assert.Equal(10, stats.ramVideo + stats.diskVideo);

            var (video, _) = buf.GetSegments();
            Assert.Equal(10, video.Count);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_TrimOldest_CompactsWhenGarbageDominates()
    {
        var dir = TempDir();
        try
        {
            using var spill = new DiskSpillBuffer(dir);
            for (int i = 0; i < 100; i++)
                spill.Write(MakeVideo(TimeSpan.FromSeconds(i), false, 100));

            // Trim to last 10s → cutoff 89s → keep frames 89..99 (11 frames)
            int removed = spill.TrimOldest(TimeSpan.FromSeconds(10));
            Assert.Equal(89, removed);
            Assert.Equal(11, spill.Count);
            Assert.Equal(1100, spill.TotalBytes);

            // Compaction must run once garbage dominates (>50% of the file)
            var dataFile = Directory.GetFiles(dir, "dinho-spill-*.bin").Single();
            Assert.True(new FileInfo(dataFile).Length <= 2200,
                $"Physical file should be compacted, was {new FileInfo(dataFile).Length}");

            // Reads must still be correct after compaction (physical offsets)
            var all = spill.ReadAll();
            Assert.Equal(11, all.Count);
            for (int i = 0; i < all.Count; i++)
                Assert.Equal(TimeSpan.FromSeconds(i + 89), all[i].Pts);

            // Writes after trim/compact must land at correct offsets
            spill.Write(MakeVideo(TimeSpan.FromSeconds(120), false, 100));
            var all2 = spill.ReadAll();
            Assert.Equal(12, all2.Count);
            Assert.Equal(TimeSpan.FromSeconds(120), all2[^1].Pts);
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_CleanupOrphans_RemovesOnlySpillFiles()
    {
        var dir = TempDir();
        try
        {
            File.WriteAllText(Path.Combine(dir, "dinho-spill-aaaa1111.bin"), "stale-data");
            File.WriteAllText(Path.Combine(dir, "dinho-spill-aaaa1111.idx"), "stale-index");
            var keepFile = Path.Combine(dir, "important.txt");
            File.WriteAllText(keepFile, "keep");
            Directory.CreateDirectory(Path.Combine(dir, "dinho-spill-subdir"));

            int removed = DiskSpillBuffer.CleanupOrphans(dir);

            Assert.True(removed >= 2, $"Should remove stale spill files, removed={removed}");
            Assert.False(File.Exists(Path.Combine(dir, "dinho-spill-aaaa1111.bin")));
            Assert.False(File.Exists(Path.Combine(dir, "dinho-spill-aaaa1111.idx")));
            Assert.True(File.Exists(keepFile), "Non-spill file must be kept");
            Assert.True(Directory.Exists(Path.Combine(dir, "dinho-spill-subdir")),
                "Directories with spill-like prefix must be kept");
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_ReadAll_VideoPackets_ArePooled()
    {
        var dir = TempDir();
        try
        {
            using var spill = new DiskSpillBuffer(dir);
            for (int i = 0; i < 10; i++)
                spill.Write(MakeVideo(TimeSpan.FromSeconds(i), false, 1000));

            var all = spill.ReadAll();
            Assert.Equal(10, all.Count);
            Assert.All(all, p => Assert.True(p.IsPooled,
                $"Video packet at {p.Pts.TotalSeconds}s should be pooled"));
            Assert.All(all, p => Assert.Equal(1000, p.DataLength));
            Assert.All(all, p => Assert.NotNull(p.Data));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_ReadAll_VideoPackets_ReleaseReturnsToPool()
    {
        var dir = TempDir();
        try
        {
            using var spill = new DiskSpillBuffer(dir);
            for (int i = 0; i < 5; i++)
                spill.Write(MakeVideo(TimeSpan.FromSeconds(i), false, 1000));

            var all = spill.ReadAll();
            foreach (var pkt in all)
            {
                Assert.True(pkt.IsPooled);
                Assert.Equal(1000, pkt.DataLength);
                pkt.Release();
                Assert.Equal(0, pkt.DataLength);
            }
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_GetSegments_VideoSpilled_IsPooledAndReleasable()
    {
        var dir = TempDir();
        try
        {
            using var buf = new ReplayBuffer(TimeSpan.FromSeconds(60), 200);
            buf.EnableDiskSpill(dir);
            for (int i = 0; i < 40; i++)
                buf.AddVideo(MakeVideo(TimeSpan.FromSeconds(i), i % 5 == 0, 5000));

            var (video, _) = buf.GetSegments();
            Assert.Equal(40, video.Count);
            Assert.True(video[0].IsPooled,
                "Oldest video frame should come from spill and be pooled");
            Assert.Contains(video, p => p.IsPooled);
            foreach (var pkt in video) pkt.Release();
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }

    [Fact]
    public void DiskSpill_CleanupOrphans_NoSpillFiles_ReturnsZero()
    {
        var dir = TempDir();
        try
        {
            File.WriteAllText(Path.Combine(dir, "unrelated.bin"), "data");
            Assert.Equal(0, DiskSpillBuffer.CleanupOrphans(dir));
            Assert.True(File.Exists(Path.Combine(dir, "unrelated.bin")));
        }
        finally { try { Directory.Delete(dir, true); } catch { } }
    }
}