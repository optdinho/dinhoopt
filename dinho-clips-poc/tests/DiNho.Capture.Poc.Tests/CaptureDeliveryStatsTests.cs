using DiNho.Capture.Poc.Capture;

namespace DiNho.Capture.Poc.Tests;

public sealed class CaptureDeliveryStatsTests
{
    [Fact]
    public void Snapshot_Inicial_ZeraContadores()
    {
        var stats = new CaptureDeliveryStats();
        var s = stats.Snapshot();
        Assert.Equal(0, s.Arrived);
        Assert.Equal(0, s.CapRejected);
        Assert.Equal(0, s.Overwritten);
        Assert.Equal(0, s.Delivered);
        Assert.Equal(0, s.Consumed);
        Assert.Equal(0, s.EmptyWakeup);
        Assert.Equal(0, s.Timeout);
    }

    [Fact]
    public void Snapshot_RefleteCadaContador()
    {
        var stats = new CaptureDeliveryStats();
        stats.RecordArrived();
        stats.RecordArrived();
        stats.RecordCapRejected();
        stats.RecordOverwritten();
        stats.RecordDelivered();
        stats.RecordConsumed();
        stats.RecordEmptyWakeup();
        stats.RecordTimeout();

        var s = stats.Snapshot();
        Assert.Equal(2, s.Arrived);
        Assert.Equal(1, s.CapRejected);
        Assert.Equal(1, s.Overwritten);
        Assert.Equal(1, s.Delivered);
        Assert.Equal(1, s.Consumed);
        Assert.Equal(1, s.EmptyWakeup);
        Assert.Equal(1, s.Timeout);
    }

    // A identidade contábil que a instrumentação precisa provar: todo frame que o WGC
    // entrega ou é barrado pelo cap local ou entra no slot (delivered). Nada some no cap.
    [Fact]
    public void Contabilidade_Arrived_Igual_CapRejected_Mais_Delivered()
    {
        var stats = new CaptureDeliveryStats();
        for (int i = 0; i < 7; i++) stats.RecordArrived();
        for (int i = 0; i < 2; i++) stats.RecordCapRejected();
        for (int i = 0; i < 5; i++) stats.RecordDelivered();

        var s = stats.Snapshot();
        Assert.Equal(s.Arrived, s.CapRejected + s.Delivered);
    }

    // A subtração entre dois snapshots dá a janela — é assim que o loop difa os
    // cumulativos para logar "quantos frames se perderam nos últimos N segundos".
    [Fact]
    public void Subtracao_DeSnapshots_ProduzDeltaPorJanela()
    {
        var stats = new CaptureDeliveryStats();
        stats.RecordArrived();
        stats.RecordArrived();
        stats.RecordDelivered();
        var earlier = stats.Snapshot();

        stats.RecordArrived();
        stats.RecordCapRejected();
        stats.RecordOverwritten();
        stats.RecordDelivered();
        stats.RecordConsumed();
        stats.RecordConsumed();
        stats.RecordEmptyWakeup();
        stats.RecordTimeout();
        var later = stats.Snapshot();

        var d = later - earlier;
        Assert.Equal(1, d.Arrived);
        Assert.Equal(1, d.CapRejected);
        Assert.Equal(1, d.Overwritten);
        Assert.Equal(1, d.Delivered);
        Assert.Equal(2, d.Consumed);
        Assert.Equal(1, d.EmptyWakeup);
        Assert.Equal(1, d.Timeout);
    }

    // Produtor (thread WGC) e consumidor (loop) incrementam de threads diferentes.
    // Interlocked garante que nenhum incremento se perca.
    [Fact]
    public void IncrementosParalelos_NaoPerdemContagem()
    {
        var stats = new CaptureDeliveryStats();
        const int perThread = 10_000;
        Parallel.For(0, 4, _ =>
        {
            for (int i = 0; i < perThread; i++)
            {
                stats.RecordArrived();
                stats.RecordDelivered();
            }
        });

        var s = stats.Snapshot();
        Assert.Equal(4 * perThread, s.Arrived);
        Assert.Equal(4 * perThread, s.Delivered);
    }
}
