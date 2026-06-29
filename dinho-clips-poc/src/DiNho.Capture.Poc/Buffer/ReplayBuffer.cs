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
    private readonly ReaderWriterLockSlim _lock = new(LockRecursionPolicy.NoRecursion);
    private TimeSpan _totalVideoDuration;
    private TimeSpan _totalAudioDuration;
    private long _totalVideoBytes;
    private long _totalAudioBytes;

    public ReplayBuffer(TimeSpan maxDuration, long maxBytes = 0)
    {
        _maxDuration = maxDuration;
        _maxBytes = maxBytes;
        _videoPackets = new EncodedPacket[4096];
        _audioPackets = new EncodedPacket[1024];
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
            try { _maxBytes = value; TrimExcess(); }
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
        while (_videoCount > 0 && (_totalVideoDuration > _maxDuration || (_maxBytes > 0 && _totalVideoBytes > _maxBytes)))
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
        while (_audioCount > 0 && (_totalAudioDuration > _maxDuration || (_maxBytes > 0 && _totalAudioBytes > _maxBytes)))
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

            // Use video's last PTS as the single reference point for both streams.
            // This ensures the same window is applied to video and audio — without this,
            // audio evicted by TrimExcessAudio has an earlier last PTS, creating a shorter
            // window and amplifying the duration mismatch.
            var refPts = video.Count > 0 ? video[^1].Pts : audio.Count > 0 ? audio[^1].Pts : TimeSpan.Zero;
            var segmentStart = refPts - maxAge + cutoff;

            var trimmedVideo = new List<EncodedPacket>(video.Count);
            for (int i = 0; i < video.Count; i++)
                if (video[i].Pts >= segmentStart)
                    trimmedVideo.Add(video[i]);
            video = trimmedVideo;

            var audioStart = segmentStart;
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
