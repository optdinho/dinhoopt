using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class VideoPacketPoolTests : IDisposable
{
    private const long DefaultMaxIdleBytes = 256L * 1024 * 1024;

    public VideoPacketPoolTests()
    {
        VideoPacketPool.MaxIdleBytes = DefaultMaxIdleBytes;
        VideoPacketPool.ResetForTest();
    }

    public void Dispose()
    {
        VideoPacketPool.MaxIdleBytes = DefaultMaxIdleBytes;
    }

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

    [Fact]
    public void Return_AboveCap_IsDroppedToGc_NotReused()
    {
        // Array único maior que o cap idle: não deve ser retido — o próximo
        // Rent aloca novo em vez de reutilizar. Impede retenção ilimitada.
        VideoPacketPool.MaxIdleBytes = 1 * 1024 * 1024;
        var big = VideoPacketPool.Rent(2 * 1024 * 1024);
        VideoPacketPool.Return(big);

        var reRent = VideoPacketPool.Rent(2 * 1024 * 1024);
        Assert.NotSame(big, reRent);
        VideoPacketPool.Return(reRent);
    }

    [Fact]
    public void Return_OverflowOfCap_OnlyFirstBatchRetained()
    {
        // Cap é por bytes acumulados, não por contagem: primeiro return cabe,
        // segundo estoura o cap e é descartado ao GC.
        VideoPacketPool.MaxIdleBytes = 1024 * 1024; // 1MB
        var a = VideoPacketPool.Rent(700 * 1024);
        var b = VideoPacketPool.Rent(700 * 1024);
        VideoPacketPool.Return(a); // 700KB → retido
        VideoPacketPool.Return(b); // 1.4MB > 1MB cap → descartado

        var reA = VideoPacketPool.Rent(700 * 1024);
        var reB = VideoPacketPool.Rent(700 * 1024);
        Assert.Same(a, reA);
        Assert.NotSame(b, reB);
        VideoPacketPool.Return(reA);
        VideoPacketPool.Return(reB);
    }

    [Fact]
    public void Return_TooSmallForRent_IsDropped()
    {
        // Array pequeno no pool não serve para um Rent maior — é descartado
        // e um novo é alocado.
        var small = VideoPacketPool.Rent(100);
        VideoPacketPool.Return(small);

        var big = VideoPacketPool.Rent(10 * 1024);
        Assert.NotSame(small, big);
        VideoPacketPool.Return(big);
    }
}
