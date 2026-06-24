using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Buffer;

public sealed class ReplayBuffer : IDisposable
{
    private readonly LinkedList<EncodedPacket> _videoPackets = new();
    private readonly LinkedList<EncodedPacket> _audioPackets = new();
    private TimeSpan _maxDuration;
    private readonly object _lock = new();
    private TimeSpan _totalVideoDuration;
    private TimeSpan _totalAudioDuration;
    private long _totalVideoBytes;
    private long _totalAudioBytes;

    public ReplayBuffer(TimeSpan maxDuration)
    {
        _maxDuration = maxDuration;
    }

    public TimeSpan MaxDuration
    {
        get { lock (_lock) { return _maxDuration; } }
        set { lock (_lock) { _maxDuration = value; TrimExcess(_videoPackets, ref _totalVideoDuration, ref _totalVideoBytes); TrimExcess(_audioPackets, ref _totalAudioDuration, ref _totalAudioBytes); } }
    }

    public void AddVideo(EncodedPacket packet)
    {
        lock (_lock)
        {
            _videoPackets.AddLast(packet);
            _totalVideoDuration += packet.Duration;
            _totalVideoBytes += packet.Data.Length;
            TrimExcess(_videoPackets, ref _totalVideoDuration, ref _totalVideoBytes);
        }
    }

    public void AddAudio(EncodedPacket packet)
    {
        lock (_lock)
        {
            _audioPackets.AddLast(packet);
            _totalAudioDuration += packet.Duration;
            _totalAudioBytes += packet.Data.Length;
            TrimExcess(_audioPackets, ref _totalAudioDuration, ref _totalAudioBytes);
        }
    }

    private void TrimExcess(LinkedList<EncodedPacket> list, ref TimeSpan totalDuration, ref long totalBytes)
    {
        while (totalDuration > _maxDuration && list.First != null)
        {
            var oldest = list.First.Value;
            list.RemoveFirst();
            totalDuration -= oldest.Duration;
            totalBytes -= oldest.Data.Length;
        }
    }

    public (List<EncodedPacket> video, List<EncodedPacket> audio) GetSegments(TimeSpan? duration = null, TimeSpan? endOffset = null)
    {
        lock (_lock)
        {
            var video = new List<EncodedPacket>(_videoPackets.Count);
            for (var n = _videoPackets.First; n != null; n = n.Next)
                video.Add(n.Value);

            var audio = new List<EncodedPacket>(_audioPackets.Count);
            for (var n = _audioPackets.First; n != null; n = n.Next)
                audio.Add(n.Value);

            if (duration == null && endOffset == null)
                return (video, audio);

            var cutoff = endOffset ?? TimeSpan.Zero;
            var maxAge = duration ?? _maxDuration;

            var videoStart = (video.Count > 0) ? video[^1].Pts - maxAge + cutoff : TimeSpan.Zero;
            var trimmedVideo = new List<EncodedPacket>(video.Count);
            for (int i = 0; i < video.Count; i++)
                if (video[i].Pts >= videoStart)
                    trimmedVideo.Add(video[i]);
            video = trimmedVideo;

            var audioStart = (audio.Count > 0) ? audio[^1].Pts - maxAge + cutoff : TimeSpan.Zero;
            var trimmedAudio = new List<EncodedPacket>(audio.Count);
            for (int i = 0; i < audio.Count; i++)
                if (audio[i].Pts >= audioStart)
                    trimmedAudio.Add(audio[i]);
            audio = trimmedAudio;

            return (video, audio);
        }
    }

    public (int videoCount, int audioCount, TimeSpan duration, long bytes) Stats()
    {
        lock (_lock)
        {
            var maxDuration = _totalVideoDuration > _totalAudioDuration
                ? _totalVideoDuration : _totalAudioDuration;
            return (_videoPackets.Count, _audioPackets.Count, maxDuration, _totalVideoBytes + _totalAudioBytes);
        }
    }

    public void Clear()
    {
        lock (_lock)
        {
            _videoPackets.Clear();
            _audioPackets.Clear();
            _totalVideoDuration = TimeSpan.Zero;
            _totalAudioDuration = TimeSpan.Zero;
            _totalVideoBytes = 0;
            _totalAudioBytes = 0;
        }
    }

    public void Dispose()
    {
        Clear();
    }
}
