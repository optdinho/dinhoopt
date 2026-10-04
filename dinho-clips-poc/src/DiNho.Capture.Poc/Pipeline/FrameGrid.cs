using System.Diagnostics;

namespace DiNho.Capture.Poc.Pipeline;

/// <summary>
/// Grelha CFR absoluta do pipeline de captura. O PTS e o deadline de cada tick sao
/// <c>ancora + (slot+1) x intervalo</c> — NUNCA relativos ao inicio da iteracao corrente.
///
/// Porque: o pacer anterior calculava <c>deadline = beforeCapture + intervalo</c>, o que faz
/// qualquer iteracao que exceda os 16,667 ms <b>deslocar a grelha de PTS de forma permanente</b>.
/// Medido no clip `DiNho Optimizer 2026-10-03_06-46-04.mp4`: 542 intervalos >= 18,5 ms em
/// 305 s (+3,98 s de timeline). Com a grelha absoluta o excesso e absorvido pelo slot
/// seguinte em vez de furar a timeline.
///
/// Misses (a WGC nao entrega frame quando o conteudo nao muda — ver Microsoft #142,
/// "MinUpdateInterval is a throttling mechanism") sao preenchidos pelo chamador com uma
/// duplicata do ultimo frame. Nao se emite rajada: apos um atraso grande o
/// <see cref="Resync"/> reancora preservando a fase e conta os slots perdidos em
/// <see cref="Skipped"/>.
///
/// O "agora" entra sempre por parametro: a classe nao chama <see cref="Stopwatch"/>, o que
/// a torna deterministica e testavel sem sleeps.
/// </summary>
internal sealed class FrameGrid
{
    /// <summary>Slots de atraso a partir dos quais se ressincroniza (evita catch-up sem fim).</summary>
    internal const int MaxSlipSlots = 4;

    private readonly long _freq;
    private readonly long _intervalTicks;
    private readonly long _maxSlipTicks;
    private long _originTicks;
    private long _slot;
    private long _skipped;

    /// <param name="nowTicks">QPC da ancora (slot 0).</param>
    /// <param name="fps">Cadencia nominal. &lt;= 0 cai para 1.</param>
    /// <param name="freq">Ticks por segundo (0 = <see cref="Stopwatch.Frequency"/>).</param>
    internal FrameGrid(long nowTicks, int fps, long freq = 0)
    {
        _freq = freq > 0 ? freq : Stopwatch.Frequency;
        // Arredondado em ticks QPC. NUNCA 1_000_000L / fps em microssegundos: trunca 16667
        // para 16666 e faz o loop correr a 60,0024 fps (+2,4 us/s, ~0,7 ms em 300 s).
        _intervalTicks = (long)Math.Round(_freq / (double)Math.Max(1, fps));
        if (_intervalTicks < 1) _intervalTicks = 1;
        _maxSlipTicks = MaxSlipSlots * _intervalTicks;
        _originTicks = nowTicks;
    }

    /// <summary>Slot a processar nesta iteracao.</summary>
    internal long Slot => _slot;

    /// <summary>Slots perdidos em ressincronizacoes (nunca emitidos, nunca duplicados).</summary>
    internal long Skipped => _skipped;

    /// <summary>Periodo da grelha em ticks QPC.</summary>
    internal long IntervalTicks => _intervalTicks;

    /// <summary>PTS exacto do slot. Com uma ancora em <c>t0</c>, o slot 0 vale <c>t0</c>.</summary>
    internal long PtsTicksFor(long slot) => _originTicks + slot * _intervalTicks;

    /// <summary>
    /// Instante em que a iteracao deste slot deve TERMINAR (e a seguinte comecar).
    /// E o alvo do pacing no fim do loop.
    /// </summary>
    internal long DeadlineTicksFor(long slot) => PtsTicksFor(slot) + _intervalTicks;

    /// <summary>
    /// Quanto tempo ha a esperar por uma frame nova, em ms, com o <paramref name="capMs"/> como
    /// tecto. A janela de captura do slot e <c>[PtsTicksFor(slot), +capMs]</c>.
    ///
    /// A regra que mata o "timeout composto": se a janela <b>ja fechou</b> (o loop acordou
    /// atrasado) devolvemos 1 ms em vez de 22. Esperar os 22 ms de novo era o que produzia os
    /// deltas de 38-46 ms (22 ms do timeout desta iteracao + 22 ms do timeout da seguinte).
    ///
    /// Nunca devolve 0: <c>TryCaptureFrame(0)</c> bloquearia o pipeline a espera do proximo
    /// <c>FrameArrived</c> em vez de continuar o relogio.
    /// </summary>
    internal int CaptureWaitMs(long nowTicks, int capMs)
    {
        var cap = Math.Max(1, capMs);
        var deadlineTicks = PtsTicksFor(_slot) + cap * _freq / 1000;
        var remainingTicks = deadlineTicks - nowTicks;
        if (remainingTicks <= 0) return 1;
        var ms = (int)((remainingTicks + _freq / 1000 - 1) / (_freq / 1000));
        return Math.Clamp(ms, 1, cap);
    }

    /// <summary>Verdadeiro quando o loop se atrasou mais do que <see cref="MaxSlipSlots"/> periodos.</summary>
    internal bool ShouldResync(long nowTicks)
        => nowTicks - PtsTicksFor(_slot) > _maxSlipTicks;

    /// <summary>
    /// Reancora no "agora": o PTS do slot corrente passa a valer <paramref name="nowTicks"/>
    /// e a fase da grelha mantem-se (o slot <b>NÃO</b> salta — o índice e a origem mexem-se
    /// juntos). Os slots perdidos ficam contados em <see cref="Skipped"/>.
    ///
    /// <para>
    /// <b>Objectivo:</b> so entra aqui quem atrasou mais de <see cref="MaxSlipSlots"/>
    /// periodos (reinit, stall de GPU, alt-tab), e nesse cenario a alternativa - apanhar o
    /// atraso slot a slot - e pior, porque o orcamento de duplicatas (<c>poolSize - 1</c>)
    /// esgota-se ao 3.o miss e cada slot seguinte fura <b>um</b> intervalo.
    /// </para>
    /// <para>
    /// <b>A afirmação original deste comentário ("insere um buraco de lost × intervalo ms
    /// no ficheiro") foi REMOVIDA por não estar provada.</b> O salto theorico e de
    /// <c>(lost + 1) × intervalo</c>, medido em
    /// <c>CfrPacerSimulationTests.SaltoDoResync_ValeraoSlotsContados</c> - o resync ancora o
    /// slot <i>actual</i> em <paramref name="nowTicks"/> e o pacote anterior foi emitido no
    /// slot anterior.
    /// </para>
    /// <para>
    /// <b>O que a medição diz (soak CFR 6/6, 6 clips, 1817 s):</b> 36 resyncs a somar 1030 slots
    /// perdidos (com ressyncs de 142 e de 272 slots) e mesmo assim o excesso total foi
    /// <b>0,168 s</b>, com DMax <= 50 ms. <b>Resync e ΔPTS nao tem correlacao 1:1
    /// observada</b>: um clip com 2 resyncs de 87 slots deu D18=4 e outro com 2 resyncs de
    /// 84 slots deu D18=0.
    /// </para>
    /// <para>
    /// <b>Porquê, exactamente, continua por explicar.</b> O PTS que vai para o ficheiro nao e
    /// lido directamente da grelha: <c>FfmpegEncoder.NalParsing</c> substitui o PTS de cada
    /// pacote AV1 a partir de <c>_inputPtsQueue</c> (dequeue real / extrapolacao), e o
    /// reancoramento parece ser absorvido por essa camada. Isto e <b>inferencia, nao facto
    /// medido</b> - nao tratar como mecanismo confirmado.
    /// </para>
    /// <para>
    /// <b>Regra de diagnostico:</b> nunca atribuir um ΔPTS grande a um resync sem o confrontar
    /// com o <c>skip=</c> da mesma janela (ver AGENTS.md). As 9 anomalias residuais do soak
    /// (0,008% dos frames) continuam sem causa identificada.
    /// </para>
    /// </summary>
    internal void Resync(long nowTicks)
    {
        var lost = (nowTicks - PtsTicksFor(_slot)) / _intervalTicks;
        if (lost > 0) _skipped += lost;
        _originTicks = nowTicks - _slot * _intervalTicks;
    }

    /// <summary>Avanca para o proximo slot. Chamar exactamente uma vez por tick.</summary>
    internal void Advance() => _slot++;
}