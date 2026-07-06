using System.Threading;
using DiNho.Capture.Poc.Encoders;

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

    public ReplayBuffer(TimeSpan maxDuration, long maxBytes = 0)
    {
        _maxDuration = maxDuration;
        _maxBytes = maxBytes;
        RecalculateProportionalBudgets();
        _videoPackets = new EncodedPacket[4096];
        _audioPackets = new EncodedPacket[1024];
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
            _lock.EnterWriteLock();
            try { _maxDuration = value; TrimExcess(); }
            finally { _lock.ExitWriteLock(); }
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
            _lock.EnterWriteLock();
            try
            {
                _maxBytes = value;
                RecalculateProportionalBudgets();
                TrimExcess();
            }
            finally { _lock.ExitWriteLock(); }
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
        _lock.EnterWriteLock();
        try
        {
            GrowIfNeeded(ref _videoPackets, ref _videoHead, ref _videoTail, ref _videoCount);
            _videoPackets[_videoTail] = packet;
            _videoTail = (_videoTail + 1) % _videoPackets.Length;
            _videoCount++;
            _totalVideoDuration += packet.Duration;
            _totalVideoBytes += packet.DataLength;
            TrimExcessVideo();
        }
        finally { _lock.ExitWriteLock(); }
    }

    public void AddAudio(EncodedPacket packet)
    {
        _lock.EnterWriteLock();
        try
        {
            GrowIfNeeded(ref _audioPackets, ref _audioHead, ref _audioTail, ref _audioCount);
            _audioPackets[_audioTail] = packet;
            _audioTail = (_audioTail + 1) % _audioPackets.Length;
            _audioCount++;
            _totalAudioDuration += packet.Duration;
            _totalAudioBytes += packet.PcmSamples is { } pcm ? pcm.Length * 4L : packet.DataLength;
            TrimExcessAudio();
        }
        finally { _lock.ExitWriteLock(); }
    }

    private void TrimExcess()
    {
        TrimExcessVideo();
        TrimExcessAudio();
    }

    private void TrimExcessVideo()
    {
        while (_videoCount > 0 && (_totalVideoDuration > _maxDuration || (_maxVideoBytes > 0 && _totalVideoBytes > _maxVideoBytes)))
        {
            var oldest = _videoPackets[_videoHead]!;
            _videoPackets[_videoHead] = null;
            _videoHead = (_videoHead + 1) % _videoPackets.Length;
            _videoCount--;
            _totalVideoDuration -= oldest.Duration;
            _totalVideoBytes -= oldest.DataLength;
            oldest.Release();
        }
    }

    private void TrimExcessAudio()
    {
        while (_audioCount > 0 && (_totalAudioDuration > _maxDuration || (_maxAudioBytes > 0 && _totalAudioBytes > _maxAudioBytes)))
        {
            var oldest = _audioPackets[_audioHead]!;
            _audioPackets[_audioHead] = null;
            _audioHead = (_audioHead + 1) % _audioPackets.Length;
            _audioCount--;
            _totalAudioDuration -= oldest.Duration;
            _totalAudioBytes -= oldest.PcmSamples is { } pcm ? pcm.Length * 4L : oldest.DataLength;
            oldest.Release();
        }
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

            if (duration == null && endOffset == null)
                return (video, audio);

            var cutoff = endOffset ?? TimeSpan.Zero;
            var maxAge = duration ?? _maxDuration;

            // Use each stream's own last PTS as reference point, so both video and audio
            // produce a window of exactly 'maxAge' seconds from their respective end.
            // Using video[^1].Pts as the single reference (previous approach) caused the audio
            // window to be larger than the video window when encoder speed <1.0x — because
            // video PTS lags behind real-time audio PTS, creating a wider audio segment.
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
        _lock.Dispose();
    }
}
