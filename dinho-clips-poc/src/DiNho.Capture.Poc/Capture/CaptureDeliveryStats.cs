using System.Threading;

namespace DiNho.Capture.Poc.Capture;

/// <summary>
/// Contadores thread-safe do hand-off produtor (WGC, worker thread) / consumidor
/// (loop de captura) do <see cref="WgcCaptureSource"/>. São CUMULATIVOS: o loop tira
/// um <see cref="Snapshot"/> por janela e subtrai o anterior, expondo ONDE os frames
/// se perdem:
/// <list type="bullet">
/// <item><c>Arrived</c> — o WGC entregou (TryGetNextFrame não-nulo).</item>
/// <item><c>CapRejected</c> — barrado pelo cap local de fps (chegou antes do intervalo).</item>
/// <item><c>Delivered</c> — posto no slot de 1 posição. Vale Arrived = CapRejected + Delivered.</item>
/// <item><c>Overwritten</c> — um frame novo substituiu um ainda não consumido (perda silenciosa do slot único).</item>
/// <item><c>Consumed</c> — o loop retirou o frame do slot (virou frame bom ou morreu na extração de textura).</item>
/// <item><c>EmptyWakeup</c> — o consumidor acordou por sinal, mas o slot já estava vazio (corrida AutoResetEvent↔slot).</item>
/// <item><c>Timeout</c> — o WaitOne do consumidor expirou sem sinal.</item>
/// </list>
/// </summary>
internal sealed class CaptureDeliveryStats
{
    private long _arrived;
    private long _capRejected;
    private long _overwritten;
    private long _delivered;
    private long _consumed;
    private long _emptyWakeup;
    private long _timeout;

    public void RecordArrived() => Interlocked.Increment(ref _arrived);
    public void RecordCapRejected() => Interlocked.Increment(ref _capRejected);
    public void RecordOverwritten() => Interlocked.Increment(ref _overwritten);
    public void RecordDelivered() => Interlocked.Increment(ref _delivered);
    public void RecordConsumed() => Interlocked.Increment(ref _consumed);
    public void RecordEmptyWakeup() => Interlocked.Increment(ref _emptyWakeup);
    public void RecordTimeout() => Interlocked.Increment(ref _timeout);

    public DeliveryStatsSnapshot Snapshot() => new(
        Arrived: Interlocked.Read(ref _arrived),
        CapRejected: Interlocked.Read(ref _capRejected),
        Overwritten: Interlocked.Read(ref _overwritten),
        Delivered: Interlocked.Read(ref _delivered),
        Consumed: Interlocked.Read(ref _consumed),
        EmptyWakeup: Interlocked.Read(ref _emptyWakeup),
        Timeout: Interlocked.Read(ref _timeout));
}

/// <summary>
/// Snapshot cumulativo do hand-off WGC→loop. A subtração <c>later - earlier</c> isola
/// a janela observada (os contadores da fonte nunca são zerados no meio do run).
/// </summary>
internal readonly record struct DeliveryStatsSnapshot(
    long Arrived,
    long CapRejected,
    long Overwritten,
    long Delivered,
    long Consumed,
    long EmptyWakeup,
    long Timeout)
{
    public static DeliveryStatsSnapshot operator -(DeliveryStatsSnapshot later, DeliveryStatsSnapshot earlier) => new(
        later.Arrived - earlier.Arrived,
        later.CapRejected - earlier.CapRejected,
        later.Overwritten - earlier.Overwritten,
        later.Delivered - earlier.Delivered,
        later.Consumed - earlier.Consumed,
        later.EmptyWakeup - earlier.EmptyWakeup,
        later.Timeout - earlier.Timeout);
}
