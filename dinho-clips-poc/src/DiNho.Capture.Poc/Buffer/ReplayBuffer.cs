using System.Diagnostics;
using System.Threading;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Logging;

namespace DiNho.Capture.Poc.Buffer;

public sealed class ReplayBuffer : IDisposable
{
    private EncodedPacket?[] _videoPackets;
    private EncodedPacket?[] _audioPackets;
    private int _videoHead;
    private int _videoTail;
    private int _videoCount;
    private int _audioHead;
    private int _audioTail;
    private int _audioCount;
    private TimeSpan _maxDuration;
    private long _maxBytes;
    private long _maxVideoBytes;
    private long _maxAudioBytes;
    private readonly ReaderWriterLockSlim _lock = new(LockRecursionPolicy.NoRecursion);
    private TimeSpan _totalVideoDuration;
    private TimeSpan _totalAudioDuration;
    private long _totalVideoBytes;
    private long _totalAudioBytes;
    private DiskSpillBuffer? _spill;
    private bool _diskSpillEnabled;
    private static long _lastSegmentOffsetLogTick;
    private const double SegmentOffsetWarnMs = 100.0;
    private static readonly long SegmentOffsetLogThrottleTicks = Stopwatch.Frequency * 5;

    public ReplayBuffer(TimeSpan maxDuration, long maxBytes = 0)
    {
        _maxDuration = maxDuration;
        _maxBytes = maxBytes;
        RecalculateProportionalBudgets();
        _videoPackets = new EncodedPacket[4096];
        _audioPackets = new EncodedPacket[1024];
    }

    /// <summary>
    /// Enable disk spill: evicted frames are written to a temp file
    /// instead of being released, allowing GetSegments() to return
    /// durations longer than the RAM budget.
    /// </summary>
    public void EnableDiskSpill(string? tempDir = null)
    {
        _lock.EnterWriteLock();
        try
        {
            if (_diskSpillEnabled) return;
            _spill = new DiskSpillBuffer(tempDir);
            _diskSpillEnabled = true;
        }
        finally { _lock.ExitWriteLock(); }
    }

    public bool IsDiskSpillEnabled
    {
        get
        {
            _lock.EnterReadLock();
            try { return _diskSpillEnabled; }
            finally { _lock.ExitReadLock(); }
        }
    }

    public (int ramVideo, int ramAudio, int diskVideo, int diskAudio, long ramBytes, long diskBytes) SpillStats()
    {
        _lock.EnterReadLock();
        try
        {
            return (_videoCount, _audioCount,
                _spill?.VideoCount ?? 0, _spill?.AudioCount ?? 0,
                _totalVideoBytes + _totalAudioBytes,
                _spill?.TotalBytes ?? 0);
        }
        finally { _lock.ExitReadLock(); }
    }

    private void RecalculateProportionalBudgets()
    {
        // Video tipicamente consome ~90% do budget (frames H.264 grandes),
        // áudio ~10% (AAC compacto). Budgets separados evitam que um stream
        // trime excessivamente o outro, garantindo janelas de tempo balanceadas.
        if (_maxBytes <= 0)
        {
            _maxVideoBytes = _maxAudioBytes = 0;
            return;
        }
        // Proporção 90/10 com base na observação empírica de que AAC a 192kbps
        // é ~5% do bitrate total (NVENC ~15-40 Mbps + AAC 0.192 Mbps).
        // 10% dá folga para áudio sem comprometer vídeo.
        _maxVideoBytes = (long)(_maxBytes * 0.9);
        _maxAudioBytes = _maxBytes - _maxVideoBytes;
    }

    public TimeSpan MaxDuration
    {
        get
        {
            _lock.EnterReadLock();
            try { return _maxDuration; }
            finally { _lock.ExitReadLock(); }
        }
        set
        {
            List<EncodedPacket>? evicted;
            _lock.EnterWriteLock();
            try { _maxDuration = value; evicted = TrimExcess(); }
            finally { _lock.ExitWriteLock(); }
            FlushEvicted(evicted);
        }
    }

    public long MaxBytes
    {
        get
        {
            _lock.EnterReadLock();
            try { return _maxBytes; }
            finally { _lock.ExitReadLock(); }
        }
        set
        {
            List<EncodedPacket>? evicted;
            _lock.EnterWriteLock();
            try
            {
                _maxBytes = value;
                RecalculateProportionalBudgets();
                evicted = TrimExcess();
            }
            finally { _lock.ExitWriteLock(); }
            FlushEvicted(evicted);
        }
    }

    public int VideoCount
    {
        get
        {
            _lock.EnterReadLock();
            try { return _videoCount; }
            finally { _lock.ExitReadLock(); }
        }
    }

    public void AddVideo(EncodedPacket packet)
    {
        List<EncodedPacket>? evicted;
        _lock.EnterWriteLock();
        try
        {
            GrowIfNeeded(ref _videoPackets, ref _videoHead, ref _videoTail, ref _videoCount);
            _videoPackets[_videoTail] = packet;
            _videoTail = (_videoTail + 1) % _videoPackets.Length;
            _videoCount++;
            _totalVideoDuration += packet.Duration;
            _totalVideoBytes += packet.DataLength;
            evicted = TrimExcessVideo();
        }
        finally { _lock.ExitWriteLock(); }
        FlushEvicted(evicted);
    }

    public void AddAudio(EncodedPacket packet)
    {
        List<EncodedPacket>? evicted;
        _lock.EnterWriteLock();
        try
        {
            GrowIfNeeded(ref _audioPackets, ref _audioHead, ref _audioTail, ref _audioCount);
            _audioPackets[_audioTail] = packet;
            _audioTail = (_audioTail + 1) % _audioPackets.Length;
            _audioCount++;
            _totalAudioDuration += packet.Duration;
            // Áudio no buffer é sempre AAC (PcmSamples == null) — contabilização
            // consistente via DataLength (B2: ramo PcmSamples era inalcançável).
            _totalAudioBytes += packet.DataLength;
            evicted = TrimExcessAudio();
        }
        finally { _lock.ExitWriteLock(); }
        FlushEvicted(evicted);
    }

    /// <summary>
    /// Trim both streams, returning the evicted packets. Eviction only removes
    /// packets from the ring under the lock — the actual spill write + release
    /// happens later in <see cref="FlushEvicted"/>, outside the write lock.
    /// </summary>
    private List<EncodedPacket>? TrimExcess()
    {
        var v = TrimExcessVideo();
        var a = TrimExcessAudio();
        if (v == null) return a;
        if (a == null) return v;
        v.AddRange(a);
        return v;
    }

    private List<EncodedPacket>? TrimExcessVideo()
    {
        List<EncodedPacket>? evicted = null;
        while (_videoCount > 0 && (_totalVideoDuration > _maxDuration || (_maxVideoBytes > 0 && _totalVideoBytes > _maxVideoBytes)))
        {
            var oldest = _videoPackets[_videoHead]!;
            _videoPackets[_videoHead] = null;
            _videoHead = (_videoHead + 1) % _videoPackets.Length;
            _videoCount--;
            _totalVideoDuration -= oldest.Duration;
            _totalVideoBytes -= oldest.DataLength;
            (evicted ??= new List<EncodedPacket>(4)).Add(oldest);
        }
        return evicted;
    }

    private List<EncodedPacket>? TrimExcessAudio()
    {
        List<EncodedPacket>? evicted = null;
        while (_audioCount > 0 && (_totalAudioDuration > _maxDuration || (_maxAudioBytes > 0 && _totalAudioBytes > _maxAudioBytes)))
        {
            var oldest = _audioPackets[_audioHead]!;
            _audioPackets[_audioHead] = null;
            _audioHead = (_audioHead + 1) % _audioPackets.Length;
            _audioCount--;
            _totalAudioDuration -= oldest.Duration;
            _totalAudioBytes -= oldest.DataLength;
            (evicted ??= new List<EncodedPacket>(4)).Add(oldest);
        }
        return evicted;
    }

    /// <summary>
    /// Write evicted packets to the disk spill and release them, OUTSIDE the
    /// ReplayBuffer write lock. Both the spill write and the sliding-window
    /// trim (which only deletes fully-consumed segment files — no compaction)
    /// are long I/O; running them under the write lock froze the whole capture
    /// pipeline for 76s (2026-08-01 incident).
    /// </summary>
    private void FlushEvicted(List<EncodedPacket>? evicted)
    {
        if (evicted == null || evicted.Count == 0) return;

        var spill = _spill;
        var spillEnabled = _diskSpillEnabled;
        if (spillEnabled && spill != null)
        {
            foreach (var oldest in evicted)
                spill.Write(oldest);
            spill.TrimOldest(_maxDuration);
        }

        foreach (var oldest in evicted)
            oldest.Release();
    }

    private static void GrowIfNeeded(ref EncodedPacket?[] buffer, ref int head, ref int tail, ref int count)
    {
        if (count < buffer.Length) return;

        int newCapacity = buffer.Length * 2;
        var newBuf = new EncodedPacket[newCapacity];
        if (count > 0)
        {
            if (head < tail)
            {
                System.Array.Copy(buffer, head, newBuf, 0, count);
            }
            else
            {
                int rightLen = buffer.Length - head;
                System.Array.Copy(buffer, head, newBuf, 0, rightLen);
                System.Array.Copy(buffer, 0, newBuf, rightLen, tail);
            }
        }
        buffer = newBuf;
        head = 0;
        tail = count;
    }

    public (List<EncodedPacket> video, List<EncodedPacket> audio) GetSegments(TimeSpan? duration = null, TimeSpan? endOffset = null)
    {
        _lock.EnterReadLock();
        try
        {
            var video = CopyRing(_videoPackets, _videoHead, _videoCount);
            var audio = CopyRing(_audioPackets, _audioHead, _audioCount);

            // Merge disk-spilled packets (oldest first, already sorted by PTS)
            if (_diskSpillEnabled && _spill is { Count: > 0 })
            {
                var diskPkts = _spill.ReadAll();
                var diskVideo = new List<EncodedPacket>();
                var diskAudio = new List<EncodedPacket>();
                foreach (var pkt in diskPkts)
                {
                    if (pkt.Type == MediaType.Video) diskVideo.Add(pkt);
                    else diskAudio.Add(pkt);
                }
                // Disk packets are older than RAM packets — prepend then sort
                diskVideo.AddRange(video);
                diskVideo.Sort((a, b) => a.Pts.CompareTo(b.Pts));
                diskAudio.AddRange(audio);
                diskAudio.Sort((a, b) => a.Pts.CompareTo(b.Pts));
                video = diskVideo;
                audio = diskAudio;
            }

            // Diagnostic: mede offset entre último PTS de video/audio (throttled 5s)
            if (video.Count > 0 && audio.Count > 0)
            {
                var offsetMs = (audio[^1].Pts - video[^1].Pts).TotalMilliseconds;
                if (Math.Abs(offsetMs) > SegmentOffsetWarnMs)
                {
                    var now = Stopwatch.GetTimestamp();
                    if (now - _lastSegmentOffsetLogTick >= SegmentOffsetLogThrottleTicks)
                    {
                        _lastSegmentOffsetLogTick = now;
                        Log.D("ReplayBuffer", $"GetSegments: offset entre último PTS de video/audio = {offsetMs:F0}ms " +
                            $"(video={video[^1].Pts.TotalSeconds:F2}s audio={audio[^1].Pts.TotalSeconds:F2}s)");
                    }
                }
            }

            if (duration == null && endOffset == null)
                return (video, audio);

            var cutoff = endOffset ?? TimeSpan.Zero;
            var maxAge = duration ?? _maxDuration;

            var videoStart = video.Count > 0 ? video[^1].Pts - maxAge + cutoff : TimeSpan.Zero;
            if (videoStart < TimeSpan.Zero) videoStart = TimeSpan.Zero;
            var audioStart = audio.Count > 0 ? audio[^1].Pts - maxAge + cutoff : TimeSpan.Zero;
            if (audioStart < TimeSpan.Zero) audioStart = TimeSpan.Zero;

            var trimmedVideo = new List<EncodedPacket>(video.Count);
            for (int i = 0; i < video.Count; i++)
                if (video[i].Pts >= videoStart)
                    trimmedVideo.Add(video[i]);
            video = trimmedVideo;

            var trimmedAudio = new List<EncodedPacket>(audio.Count);
            for (int i = 0; i < audio.Count; i++)
                if (audio[i].Pts >= audioStart)
                    trimmedAudio.Add(audio[i]);
            audio = trimmedAudio;

            return (video, audio);
        }
        finally { _lock.ExitReadLock(); }
    }

    private static List<EncodedPacket> CopyRing(EncodedPacket?[] buffer, int head, int count)
    {
        var result = new List<EncodedPacket>(count);
        for (int i = 0; i < count; i++)
        {
            int idx = (head + i) % buffer.Length;
            var pkt = buffer[idx]!;
            pkt.Retain();
            result.Add(pkt);
        }
        return result;
    }

    public (TimeSpan firstPts, TimeSpan lastPts, TimeSpan span) PeekVideoPtsRange()
    {
        _lock.EnterReadLock();
        try
        {
            if (_videoCount == 0) return (TimeSpan.Zero, TimeSpan.Zero, TimeSpan.Zero);
            var first = _videoPackets[_videoHead]!.Pts;
            var last = _videoPackets[(_videoHead + _videoCount - 1) % _videoPackets.Length]!.Pts;
            return (first, last, last - first);
        }
        finally { _lock.ExitReadLock(); }
    }

    public (int videoCount, int audioCount, TimeSpan duration, long bytes) Stats()
    {
        _lock.EnterReadLock();
        try
        {
            var maxDuration = _totalVideoDuration > _totalAudioDuration
                ? _totalVideoDuration : _totalAudioDuration;
            return (_videoCount, _audioCount, maxDuration, _totalVideoBytes + _totalAudioBytes);
        }
        finally { _lock.ExitReadLock(); }
    }

    public (TimeSpan videoLastPts, TimeSpan audioLastPts) StatsPtsRange()
    {
        _lock.EnterReadLock();
        try
        {
            var vLast = _videoCount > 0
                ? _videoPackets[(_videoHead + _videoCount - 1) % _videoPackets.Length]!.Pts
                : TimeSpan.Zero;
            var aLast = _audioCount > 0
                ? _audioPackets[(_audioHead + _audioCount - 1) % _audioPackets.Length]!.Pts
                : TimeSpan.Zero;
            return (vLast, aLast);
        }
        finally { _lock.ExitReadLock(); }
    }

    public (int videoCount, int audioCount, long videoBytes, long audioBytes, TimeSpan videoDuration, TimeSpan audioDuration) StatsDetailed()
    {
        _lock.EnterReadLock();
        try
        {
            return (_videoCount, _audioCount, _totalVideoBytes, _totalAudioBytes, _totalVideoDuration, _totalAudioDuration);
        }
        finally { _lock.ExitReadLock(); }
    }

    public void Clear()
    {
        _lock.EnterWriteLock();
        try
        {
            ReleaseAll(_videoPackets, _videoHead, _videoCount);
            ReleaseAll(_audioPackets, _audioHead, _audioCount);
            System.Array.Clear(_videoPackets, 0, _videoPackets.Length);
            System.Array.Clear(_audioPackets, 0, _audioPackets.Length);
            _videoHead = _videoTail = _videoCount = 0;
            _audioHead = _audioTail = _audioCount = 0;
            _totalVideoDuration = TimeSpan.Zero;
            _totalAudioDuration = TimeSpan.Zero;
            _totalVideoBytes = 0;
            _totalAudioBytes = 0;
            _spill?.Clear();
        }
        finally { _lock.ExitWriteLock(); }
    }

    private static void ReleaseAll(EncodedPacket?[] buffer, int head, int count)
    {
        for (int i = 0; i < count; i++)
        {
            int idx = (head + i) % buffer.Length;
            buffer[idx]?.Release();
        }
    }

    public void Dispose()
    {
        Clear();
        _spill?.Dispose();
        _lock.Dispose();
    }
}
