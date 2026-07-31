using System.Runtime.InteropServices;
using System.Text;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Buffer;

/// <summary>
/// Append-only temp file that stores evicted EncodedPacket data.
/// When the in-memory ReplayBuffer exceeds its byte budget, packets are spilled
/// to disk so GetSegments() can still return the full requested duration.
/// </summary>
public sealed class DiskSpillBuffer : IDisposable
{
    private readonly string _dataPath;
    private readonly string _indexPath;
    private readonly List<SpillEntry> _index = new();
    private long _currentOffset;
    private bool _disposed;
    private long _totalBytes;
    private long _totalVideoBytes;
    private long _totalAudioBytes;
    private int _videoCount;
    private int _audioCount;

    private readonly record struct SpillEntry(
        long Offset,
        int Length,
        MediaType Type,
        TimeSpan Pts,
        TimeSpan Duration,
        bool IsKeyFrame,
        int Width,
        int Height,
        int DataLength);

    public DiskSpillBuffer(string? tempDir = null)
    {
        var dir = tempDir ?? Path.GetTempPath();
        var id = Guid.NewGuid().ToString("N")[..8];
        _dataPath = Path.Combine(dir, $"dinho-spill-{id}.bin");
        _indexPath = Path.Combine(dir, $"dinho-spill-{id}.idx");
    }

    public int Count => _index.Count;
    public long TotalBytes => _totalBytes;
    public int VideoCount => _videoCount;
    public int AudioCount => _audioCount;

    /// <summary>
    /// Append a packet's raw bytes and metadata to the spill file.
    /// Must be called under ReplayBuffer's write lock.
    /// </summary>
    public void Write(EncodedPacket packet)
    {
        if (_disposed) return;

        int dataLen;
        long offset;
        using (var fs = new FileStream(_dataPath, FileMode.Append, FileAccess.Write, FileShare.None, 64 * 1024))
        {
            // Physical position in the file — stays valid even after lazy
            // compaction leaves holes, because trims never rewrite mid-file.
            offset = fs.Length;
            if (packet.PcmSamples is { Length: > 0 } pcm)
            {
                dataLen = pcm.Length * sizeof(float);
                fs.Write(MemoryMarshal.AsBytes(pcm.AsSpan()));
            }
            else
            {
                dataLen = packet.DataLength;
                fs.Write(packet.Data, 0, dataLen);
            }
        }

        _index.Add(new SpillEntry(
            offset, dataLen, packet.Type, packet.Pts,
            packet.Duration, packet.IsKeyFrame, packet.Width, packet.Height, dataLen));

        _currentOffset = offset + dataLen;
        _totalBytes += dataLen;
        if (packet.Type == MediaType.Video)
        {
            _videoCount++;
            _totalVideoBytes += dataLen;
        }
        else
        {
            _audioCount++;
            _totalAudioBytes += dataLen;
        }
    }

    /// <summary>
    /// Read all spilled packets, reconstructed as EncodedPacket objects.
    /// Returns packets sorted by PTS (oldest first).
    /// </summary>
    public List<EncodedPacket> ReadAll()
    {
        if (_disposed || _index.Count == 0) return new List<EncodedPacket>();

        var result = new List<EncodedPacket>(_index.Count);
        using var fs = new FileStream(_dataPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024);

        foreach (var entry in _index)
        {
            fs.Seek(entry.Offset, SeekOrigin.Begin);
            var buf = new byte[entry.Length];
            int read = 0;
            while (read < entry.Length)
            {
                int n = fs.Read(buf, read, entry.Length - read);
                if (n == 0) break;
                read += n;
            }

            if (entry.Type == MediaType.Audio)
            {
                int sampleCount = entry.Length / sizeof(float);
                var pcm = new float[sampleCount];
                SysCopyBlock(buf, 0, pcm, 0, entry.Length);
                result.Add(new EncodedPacket(pcm, entry.Type, entry.Pts, entry.Duration));
            }
            else
            {
                result.Add(new EncodedPacket(buf, entry.Type, entry.Pts, entry.Duration,
                    entry.IsKeyFrame, entry.Width, entry.Height));
            }
        }

        return result;
    }

    /// <summary>
    /// Read only the oldest N seconds of spilled packets (for merging with RAM).
    /// Returns the read packets and removes them from the index (FIFO eviction).
    /// </summary>
    public List<EncodedPacket> ReadOldest(TimeSpan maxAge)
    {
        if (_disposed || _index.Count == 0) return new List<EncodedPacket>();

        // Find the cutoff: keep packets where Pts >= cutoff
        var lastPts = _index[^1].Pts;
        var cutoff = lastPts - maxAge;
        if (cutoff < TimeSpan.Zero) cutoff = TimeSpan.Zero;

        int splitIdx = 0;
        for (int i = 0; i < _index.Count; i++)
        {
            if (_index[i].Pts >= cutoff)
            {
                splitIdx = i;
                break;
            }
            if (i == _index.Count - 1) splitIdx = _index.Count; // all below cutoff
        }

        if (splitIdx == 0) return new List<EncodedPacket>();

        var result = new List<EncodedPacket>(splitIdx);
        using var fs = new FileStream(_dataPath, FileMode.Open, FileAccess.Read, FileShare.Read, 64 * 1024);

        for (int i = 0; i < splitIdx; i++)
        {
            var entry = _index[i];
            fs.Seek(entry.Offset, SeekOrigin.Begin);
            var buf = new byte[entry.Length];
            int read = 0;
            while (read < entry.Length)
            {
                int n = fs.Read(buf, read, entry.Length - read);
                if (n == 0) break;
                read += n;
            }

            if (entry.Type == MediaType.Audio)
            {
                int sampleCount = entry.Length / sizeof(float);
                var pcm = new float[sampleCount];
                SysCopyBlock(buf, 0, pcm, 0, entry.Length);
                result.Add(new EncodedPacket(pcm, entry.Type, entry.Pts, entry.Duration));
            }
            else
            {
                result.Add(new EncodedPacket(buf, entry.Type, entry.Pts, entry.Duration,
                    entry.IsKeyFrame, entry.Width, entry.Height));
            }
        }

        // Remove evicted entries and compact the data file
        long removedBytes = 0;
        for (int i = 0; i < splitIdx; i++)
            removedBytes += _index[i].Length;

        _index.RemoveRange(0, splitIdx);
        _totalBytes -= removedBytes;
        RecomputeCounts();

        // Compact: rewrite file with remaining data
        CompactFile();

        return result;
    }

    /// <summary>
    /// Drop spilled packets older than <paramref name="maxAge"/> relative to the
    /// newest spilled packet (sliding time window, like ShadowPlay/Medal). The
    /// retained window is aligned to the oldest keyframe within it so the
    /// surviving stream starts at a decodable frame. The physical file is
    /// compacted lazily only once holes (removed prefix) dominate the file.
    /// Must be called under ReplayBuffer's write lock.
    /// </summary>
    /// <returns>The number of entries removed.</returns>
    public int TrimOldest(TimeSpan maxAge)
    {
        if (_disposed || _index.Count == 0) return 0;

        var lastPts = _index[^1].Pts;
        var cutoff = lastPts - maxAge;
        if (cutoff < TimeSpan.Zero) cutoff = TimeSpan.Zero;

        // Fast path: nothing is older than the window.
        if (_index[0].Pts >= cutoff) return 0;

        // Align the retained window to the oldest keyframe >= cutoff.
        int splitIdx = -1;
        for (int i = 0; i < _index.Count; i++)
        {
            if (_index[i].Pts < cutoff) continue;
            if (_index[i].Type == MediaType.Video && _index[i].IsKeyFrame)
            {
                splitIdx = i;
                break;
            }
        }

        if (splitIdx < 0)
        {
            // No keyframe inside the retained region — fall back to the PTS
            // cutoff (same window semantics as GetSegments).
            for (int i = 0; i < _index.Count; i++)
            {
                if (_index[i].Pts >= cutoff)
                {
                    splitIdx = i;
                    break;
                }
            }
            if (splitIdx < 0) splitIdx = _index.Count; // entire spill older than window
        }

        if (splitIdx == 0) return 0;

        long removedBytes = 0;
        for (int i = 0; i < splitIdx; i++)
            removedBytes += _index[i].Length;

        _index.RemoveRange(0, splitIdx);
        _totalBytes -= removedBytes;
        RecomputeCounts();

        if (_index.Count == 0)
        {
            // Everything removed — drop the physical file (no holes remain).
            try { if (File.Exists(_dataPath)) File.Delete(_dataPath); } catch { }
            _currentOffset = 0;
            return splitIdx;
        }

        // Lazy compaction: rewrite only when holes dominate (physical file
        // >= 2x retained). Bounds the file to ~2x the window size without
        // competing with the game for disk I/O on every eviction.
        if (_currentOffset >= _totalBytes * 2)
            CompactFile();

        return splitIdx;
    }

    /// <summary>
    /// Remove orphaned spill files (dinho-spill-*.bin / dinho-spill-*.idx)
    /// left behind by crashed sessions. Called once at engine startup.
    /// Only our own temp files are deleted — unrelated files and directories
    /// are never touched.
    /// </summary>
    /// <returns>The number of files removed.</returns>
    public static int CleanupOrphans(string? tempDir = null)
    {
        var dir = tempDir ?? Path.GetTempPath();
        int removed = 0;
        try
        {
            foreach (var file in Directory.EnumerateFiles(dir, "dinho-spill-*"))
            {
                var ext = Path.GetExtension(file);
                if (ext is not (".bin" or ".idx")) continue;
                try
                {
                    File.Delete(file);
                    removed++;
                }
                catch { /* best effort — a live spill may be in use (Windows locks) */ }
            }
        }
        catch { /* temp directory may not exist */ }
        return removed;
    }

    private void RecomputeCounts()
    {
        _videoCount = 0;
        _audioCount = 0;
        _totalVideoBytes = 0;
        _totalAudioBytes = 0;
        foreach (var e in _index)
        {
            if (e.Type == MediaType.Video) { _videoCount++; _totalVideoBytes += e.Length; }
            else { _audioCount++; _totalAudioBytes += e.Length; }
        }
    }

    /// <summary>
    /// Read all spilled packets and remove them from disk (full drain).
    /// Used when GetSegments needs the complete history.
    /// </summary>
    public List<EncodedPacket> DrainAll()
    {
        var result = ReadAll();
        Clear();
        return result;
    }

    /// <summary>
    /// Remove all spilled data and delete temp files.
    /// </summary>
    public void Clear()
    {
        _index.Clear();
        _currentOffset = 0;
        _totalBytes = 0;
        _totalVideoBytes = 0;
        _totalAudioBytes = 0;
        _videoCount = 0;
        _audioCount = 0;

        try { if (File.Exists(_dataPath)) File.Delete(_dataPath); } catch { }
        try { if (File.Exists(_indexPath)) File.Delete(_indexPath); } catch { }
    }

    private void CompactFile()
    {
        if (_index.Count == 0)
        {
            Clear();
            return;
        }

        // Save original offsets for rollback on failure
        var originalOffsets = new long[_index.Count];
        for (int i = 0; i < _index.Count; i++)
            originalOffsets[i] = _index[i].Offset;

        var tmpPath = _dataPath + ".compact";
        try
        {
            using var src = new FileStream(_dataPath, FileMode.Open, FileAccess.Read, FileShare.None, 64 * 1024);
            using var dst = new FileStream(tmpPath, FileMode.Create, FileAccess.Write, FileShare.None, 64 * 1024);

            long writePos = 0;
            for (int i = 0; i < _index.Count; i++)
            {
                var old = _index[i];
                src.Seek(old.Offset, SeekOrigin.Begin);

                var buf = new byte[old.Length];
                int read = 0;
                while (read < old.Length)
                {
                    int n = src.Read(buf, read, old.Length - read);
                    if (n == 0) break;
                    read += n;
                }

                dst.Write(buf, 0, read);
                _index[i] = old with { Offset = writePos };
                writePos += read;
            }

            src.Close();
            dst.Close();

            File.Delete(_dataPath);
            File.Move(tmpPath, _dataPath);
            _currentOffset = writePos;
        }
        catch
        {
            // Rollback index to original offsets on failure
            for (int i = 0; i < _index.Count; i++)
                _index[i] = _index[i] with { Offset = originalOffsets[i] };

            try { if (File.Exists(tmpPath)) File.Delete(tmpPath); } catch { }
        }
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        Clear();
    }

    // Avoid Buffer.BlockCopy — the "Buffer" namespace shadows System.Buffer
    private static void SysCopyBlock(float[] src, int srcOffset, byte[] dst, int dstOffset, int count)
    {
        var span = MemoryMarshal.AsBytes(src.AsSpan(srcOffset, count / sizeof(float)));
        span.CopyTo(dst.AsSpan(dstOffset, count));
    }

    private static void SysCopyBlock(byte[] src, int srcOffset, float[] dst, int dstOffset, int count)
    {
        var span = src.AsSpan(srcOffset, count);
        MemoryMarshal.Cast<byte, float>(span).CopyTo(dst.AsSpan(dstOffset, count / sizeof(float)));
    }
}
