using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class VideoPacketPoolTests
{
    [Fact]
    public void Rent_ReturnsArray_AtLeastRequestedSize()
    {
        var arr = VideoPacketPool.Rent(1024);
        Assert.True(arr.Length >= 1024);
        VideoPacketPool.Return(arr);
    }

    [Fact]
    public void ReturnThenRent_ReusesArray()
    {
        var arr = VideoPacketPool.Rent(1024);
        VideoPacketPool.Return(arr);

        var arr2 = VideoPacketPool.Rent(1024);
        Assert.Same(arr, arr2);
        VideoPacketPool.Return(arr2);
    }

    [Fact]
    public void ReturnMany_ThenRent_ReusesArrays_BeyondSharedBucketLimit()
    {
        // ArrayPool.Shared retém apenas ~16-20 arrays por bucket. Este teste
        // garante que o VideoPacketPool reutiliza muito além desse limite —
        // essencial para evitar churn de LOH quando o ReplayBuffer evicta
        // frames em capturas longas (300s).
        const int count = 512;
        var returned = new byte[count][];
        for (int i = 0; i < count; i++)
        {
            returned[i] = VideoPacketPool.Rent(128 * 1024);
            Assert.True(returned[i].Length >= 128 * 1024);
        }

        foreach (var arr in returned)
            VideoPacketPool.Return(arr);

        var reUsed = 0;
        for (int i = 0; i < count; i++)
        {
            var arr = VideoPacketPool.Rent(128 * 1024);
            if (returned.Contains(arr)) reUsed++;
            VideoPacketPool.Return(arr);
        }

        Assert.Equal(count, reUsed);
    }
}
