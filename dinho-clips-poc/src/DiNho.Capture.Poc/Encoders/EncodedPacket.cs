using System.Buffers;

namespace DiNho.Capture.Poc.Encoders;

public enum MediaType { Video, Audio }

public sealed class EncodedPacket
{
    public byte[] Data { get; private set; }
    public float[]? PcmSamples { get; private set; }
    public MediaType Type { get; }
    public TimeSpan Pts { get; internal set; }
    public TimeSpan Duration { get; }
    public bool IsKeyFrame { get; }
    public int Width { get; }
    public int Height { get; }
    public bool IsFavorite { get; set; }
    public bool IsPooled { get; }
    public int DataLength { get; private set; }
    public bool IsPooledPcm { get; }
    private int _retainCount;

    public void Retain()
    {
        Interlocked.Increment(ref _retainCount);
    }

    public EncodedPacket(
        byte[] data,
        MediaType type,
        TimeSpan pts,
        TimeSpan duration,
        bool isKeyFrame,
        int width = 0,
        int height = 0)
    {
        Data = data;
        DataLength = data.Length;
        Type = type;
        Pts = pts;
        Duration = duration;
        IsKeyFrame = isKeyFrame;
        Width = width;
        Height = height;
        IsPooled = false;
    }

    public EncodedPacket(
        byte[] data,
        MediaType type,
        TimeSpan pts,
        TimeSpan duration,
        bool isKeyFrame,
        bool isPooled,
        int width = 0,
        int height = 0,
        int dataLength = 0)
    {
        Data = data;
        DataLength = dataLength > 0 ? dataLength : data.Length;
        Type = type;
        Pts = pts;
        Duration = duration;
        IsKeyFrame = isKeyFrame;
        Width = width;
        Height = height;
        IsPooled = isPooled;
    }

    public EncodedPacket(
        float[] pcmSamples,
        MediaType type,
        TimeSpan pts,
        TimeSpan duration,
        bool isPooled = false)
    {
        PcmSamples = pcmSamples;
        Data = [];
        Type = type;
        Pts = pts;
        Duration = duration;
        IsKeyFrame = false;
        IsPooled = false;
        DataLength = 0;
        IsPooledPcm = isPooled;
    }

    public void Release()
    {
        if (Interlocked.Decrement(ref _retainCount) >= 0)
            return;

        if (IsPooled && DataLength > 0)
        {
            VideoPacketPool.Return(Data);
            Data = [];
            DataLength = 0;
        }
        if (IsPooledPcm && PcmSamples != null)
        {
            ArrayPool<float>.Shared.Return(PcmSamples);
            PcmSamples = null;
        }
    }
}
