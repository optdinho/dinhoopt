namespace DiNho.Capture.Poc.Encoders;

public enum MediaType { Video, Audio }

public sealed class EncodedPacket
{
    public byte[] Data { get; }
    public MediaType Type { get; }
    public TimeSpan Pts { get; }
    public TimeSpan Duration { get; }
    public bool IsKeyFrame { get; }
    public int Width { get; }
    public int Height { get; }
    public bool IsFavorite { get; set; }

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
        Type = type;
        Pts = pts;
        Duration = duration;
        IsKeyFrame = isKeyFrame;
        Width = width;
        Height = height;
    }
}
