using System.Diagnostics;
using System.Threading;

namespace DiNho.Capture.Poc.Watchdog;

/// <summary>
/// Agente de medição do feed de vídeo: agrega por janela (default 5s) os tempos por
/// estágio de cada frame que atravessa o pipeline loop→stdio, mais contagens de falha e
/// profundidade da fila do writer. Consumido pelo loop de captura (EngineCoordinator.Capture)
/// para logar o breakdown wait / copy / convert / total — o que separa o gargalo
/// WGC/DWM (wait dominante) do gargalo de conversão/GPU (convert dominante).
/// Thread-safe: o lock protege leituras cross-thread (status/UI) e o reset do summary.
/// </summary>
internal sealed class FeedTelemetry
{
    private readonly double _windowSeconds;
    private readonly long _freq;
    private readonly long _windowTicks;

    private readonly object _sync = new();
    private long _windowStartTicks;
    private int _goodFrames;
    private int _encodeNulls;
    private int _failFrames;
    private readonly List<long> _waitSamples = new();
    private readonly List<long> _copySamples = new();
    private readonly List<long> _convertSamples = new();
    private readonly List<long> _totalSamples = new();
    private long _pacingDelaySum;
    private long _pacingSpinSum;
    private int _pacingCount;
    private long _diagnosticsSum;
    private int _diagnosticsCount;
    private long _queueDepthSum;
    private long _queueDepthCount;
    private int _queueDepthMax;
    private int _duplicateFrames;
    private int _consecutiveDups;
    private int _maxConsecutiveDups;
    private long _skippedFrames;
    private readonly List<long> _dupSamples = new();
    private readonly long _overrunTicks;

    /// <summary>
    /// Limite de outlier por estágio (ms). Frames com qualquer estágio acima disso —
    /// ou com valor negativo (jitter de QPC ao reiniciar o WGC) — são excluídos da média.
    /// </summary>
    private const int OutlierMs = 100;
    private readonly long _outlierTicks;

    /// <param name="freq">Ticks por segundo (default: <see cref="Stopwatch.Frequency"/>).</param>
    /// <param name="frameIntervalTicks">
    /// Período da grelha CFR em ticks. &lt;= 0 desliga a contagem de
    /// <see cref="FeedSummary.OverrunFrames"/> — sem ele, todo frame pareceria overrun.
    /// </param>
    internal FeedTelemetry(double windowSeconds = 5.0, long freq = 0, long frameIntervalTicks = 0)
    {
        _windowSeconds = Math.Max(0.1, windowSeconds);
        _freq = freq > 0 ? freq : Stopwatch.Frequency;
        _windowTicks = (long)(_freq * _windowSeconds);
        _outlierTicks = _freq * OutlierMs / 1000;
        _overrunTicks = frameIntervalTicks > 0 ? frameIntervalTicks : 0;
    }

    internal int GoodFrames
    {
        get { lock (_sync) return _goodFrames; }
    }

    internal int EncodeNulls
    {
        get { lock (_sync) return _encodeNulls; }
    }

    internal int FailFrames
    {
        get { lock (_sync) return _failFrames; }
    }

    internal void AddGoodFrame(long waitTicks, long copyTicks, long convertTicks, long totalTicks)
    {
        lock (_sync)
        {
            _goodFrames++;
            _consecutiveDups = 0;
            _waitSamples.Add(waitTicks);
            _copySamples.Add(copyTicks);
            _convertSamples.Add(convertTicks);
            _totalSamples.Add(totalTicks);
        }
    }

    /// <summary>
    /// Slot preenchido com uma duplicata do último frame porque a WGC não entregou frame
    /// nova (conteúdo estático — Microsoft #142: "MinUpdateInterval is a throttling
    /// mechanism"). Não entra em <see cref="AddGoodFrame"/>: inflar <c>good</c> esconderia
    /// exatamente o que a telemetria existe para mostrar.
    /// <para>
    /// A run-length de duplicados é mantida aqui porque só o chamador sabe quando um frame
    /// bom interrompe a sequência — e <c>dupMax &gt; poolSize-1</c> é a regra de diagnóstico
    /// que diz "isto já não é padding, é mentira".
    /// </para>
    /// </summary>
    internal void AddDuplicateFrame(long totalTicks = 0)
    {
        lock (_sync)
        {
            _duplicateFrames++;
            _consecutiveDups++;
            if (_consecutiveDups > _maxConsecutiveDups) _maxConsecutiveDups = _consecutiveDups;
            _dupSamples.Add(totalTicks);
        }
    }

    /// <summary>
    /// Slots perdidos numa ressincronização da grelha (<c>FrameGrid.Resync</c>): nunca
    /// emitidos nem duplicados. Distingue "recuperei o slot" de "o slot sumiu".
    /// </summary>
    internal void AddSkippedFrame(long slots = 1)
    {
        lock (_sync) _skippedFrames += Math.Max(0, slots);
    }

    internal void AddEncodeNull()
    {
        lock (_sync) _encodeNulls++;
    }

    /// <summary>
    /// Tempo gasto no bloco de pacing do loop, separado nos dois lados: o <c>Task.Delay</c>
    /// (espera do bulk) e o spin residual. É o único trecho do loop que fica FORA de
    /// <c>AddGoodFrame</c>, então sem isto a conta do período não fecha e não dá para
    /// saber se o tempo perdido é o delay estourando ou o spin passando do alvo.
    /// </summary>
    internal void AddPacing(long delayTicks, long spinTicks)
    {
        lock (_sync)
        {
            _pacingDelaySum += delayTicks;
            _pacingSpinSum += spinTicks;
            _pacingCount++;
        }
    }

    internal void AddFailFrame()
    {
        lock (_sync) _failFrames++;
    }

    /// <summary>
    /// Tempo do bloco de diagnóstico por iteração — checagens de foreground/alvo/stall,
    /// atualização de status e drift. É tudo o que roda entre o fim do trabalho medido
    /// (<c>total</c>, que fecha no <c>AddVideo</c>) e o pacing, por isso fica FORA do
    /// <c>AddGoodFrame</c>. Sem medi-lo o período não fecha: <c>total + diag + pace ≈
    /// 1/fps</c>; era o tempo que sumia entre o fps observado e o período das iterações.
    /// </summary>
    internal void AddDiagnostics(long diagTicks)
    {
        lock (_sync)
        {
            _diagnosticsSum += diagTicks;
            _diagnosticsCount++;
        }
    }

    internal void AddQueueDepth(int depth)
    {
        lock (_sync)
        {
            _queueDepthSum += depth;
            _queueDepthCount++;
            if (depth > _queueDepthMax) _queueDepthMax = depth;
        }
    }

    /// <summary>
    /// Se a janela expirou desde o último summary, computa o resumo atual e zera os
    /// acumuladores. Retorna false (e <paramref name="summary"/> = default) dentro da janela.
    /// <paramref name="nowTicks"/> deve usar a mesma base de <see cref="Stopwatch"/>.
    /// </summary>
    internal bool TryTakeSummary(long nowTicks, out FeedSummary summary)
    {
        lock (_sync)
        {
            if (nowTicks - _windowStartTicks < _windowTicks)
            {
                summary = default;
                return false;
            }

            // 6.12: média dos frames limpos — exclui outliers por estágio (>100ms ou <0).
            (var waitMs, var copyMs, var convertMs, var totalMs, var cleanFrames) = ComputeCleanMeans();

            summary = new FeedSummary(
                GoodFrames: _goodFrames,
                EncodeNulls: _encodeNulls,
                FailFrames: _failFrames,
                WaitMs: waitMs,
                CopyMs: copyMs,
                ConvertMs: convertMs,
                TotalMs: totalMs,
                CleanFrames: cleanFrames,
                TotalMsAll: ComputeTotalMeanAll(),
                PacingDelayMs: _pacingCount > 0 ? Ms(TicksToMs(_pacingDelaySum) / _pacingCount) : 0,
                PacingSpinMs: _pacingCount > 0 ? Ms(TicksToMs(_pacingSpinSum) / _pacingCount) : 0,
                PacingCount: _pacingCount,
                FeedFps: _goodFrames / _windowSeconds,
                QueueDepthAvg: _queueDepthCount > 0 ? _queueDepthSum / (double)_queueDepthCount : 0,
                QueueDepthMax: _queueDepthMax,
                DiagnosticsMs: _diagnosticsCount > 0 ? Ms(TicksToMs(_diagnosticsSum) / _diagnosticsCount) : 0,
                TotalMsMax: Ms(ComputeTotalMaxMs()),
                OverrunFrames: CountOverruns(),
                DuplicateFrames: _duplicateFrames,
                MaxConsecutiveDup: _maxConsecutiveDups,
                SkippedFrames: (int)Math.Min(int.MaxValue, _skippedFrames));

            _windowStartTicks = nowTicks;
            _goodFrames = 0;
            _encodeNulls = 0;
            _failFrames = 0;
            _waitSamples.Clear();
            _copySamples.Clear();
            _convertSamples.Clear();
            _totalSamples.Clear();
            _dupSamples.Clear();
            _pacingDelaySum = 0;
            _pacingSpinSum = 0;
            _pacingCount = 0;
            _diagnosticsSum = 0;
            _diagnosticsCount = 0;
            _queueDepthSum = 0;
            _queueDepthCount = 0;
            _queueDepthMax = 0;
            _duplicateFrames = 0;
            _maxConsecutiveDups = 0;
            _skippedFrames = 0;
            // _consecutiveDups NÃO é zerado: uma run de duplicados que atravessa a fronteira
            // da janela é uma run só. Zerar aqui faria o `dupMax` da janela seguinte reportar
            // 1 em vez de 3 — e um ecrã estático longo apareceria como duplicações isoladas.
            return true;
        }
    }

    /// <summary>
    /// PIOR iteração da janela, frames bons e duplicatas juntos. A média escondia o defeito:
    /// duas iterações de 40 ms entre trezentas de 10 ms dão média ~10,5 ms e não denunciam
    /// nada — era o que escondia os deltas de 38–46 ms do clip de 2026-10-03.
    /// </summary>
    private double ComputeTotalMaxMs()
    {
        var max = 0L;
        for (var i = 0; i < _totalSamples.Count; i++)
            if (_totalSamples[i] > max) max = _totalSamples[i];
        for (var i = 0; i < _dupSamples.Count; i++)
            if (_dupSamples[i] > max) max = _dupSamples[i];
        return TicksToMs(max);
    }

    /// <summary>
    /// Ticks cujo <c>total</c> excedeu o período da grelha. Um outlier de métrica (&gt;100 ms)
    /// é excluído da média mas é um overrun real para o relógio, e tem de aparecer.
    /// </summary>
    private int CountOverruns()
    {
        if (_overrunTicks <= 0) return 0;
        var n = 0;
        for (var i = 0; i < _totalSamples.Count; i++)
            if (_totalSamples[i] > _overrunTicks) n++;
        for (var i = 0; i < _dupSamples.Count; i++)
            if (_dupSamples[i] > _overrunTicks) n++;
        return n;
    }

    private (double WaitMs, double CopyMs, double ConvertMs, double TotalMs, int CleanFrames) ComputeCleanMeans()
    {
        long waitSum = 0, copySum = 0, convertSum = 0, totalSum = 0;
        int clean = 0;

        for (int i = 0; i < _waitSamples.Count; i++)
        {
            var w = _waitSamples[i];
            var c = _copySamples[i];
            var cv = _convertSamples[i];
            var t = _totalSamples[i];
            if (IsOutlier(w) || IsOutlier(c) || IsOutlier(cv) || IsOutlier(t))
                continue;
            waitSum += w;
            copySum += c;
            convertSum += cv;
            totalSum += t;
            clean++;
        }

        if (clean == 0)
            return (0, 0, 0, 0, 0);

        return (
            Ms(TicksToMs(waitSum) / clean),
            Ms(TicksToMs(copySum) / clean),
            Ms(TicksToMs(convertSum) / clean),
            Ms(TicksToMs(totalSum) / clean),
            clean);
    }

    /// <summary>
    /// Média do <c>total</c> sobre TODOS os frames bons da janela, outliers inclusive — a
    /// população é exatamente <see cref="_goodFrames"/>, o mesmo denominador do
    /// <c>FeedFps</c>. É o número que fecha a conta com o log: <c>GoodFrames ×
    /// TotalMsAll</c> é o trabalho real da janela. A média de <c>TotalMs</c> não fecha,
    /// porque ela exclui os outliers que o fps continua contando.
    /// </summary>
    private double ComputeTotalMeanAll()
    {
        if (_totalSamples.Count == 0)
            return 0;

        long sum = 0;
        foreach (var t in _totalSamples)
            sum += t;

        return Ms(TicksToMs(sum) / _totalSamples.Count);
    }

    private bool IsOutlier(long ticks) => ticks < 0 || ticks > _outlierTicks;

    private double TicksToMs(double ticks) => ticks * 1000.0 / _freq;
    private static double Ms(double ms) => Math.Round(ms, 2);
}

/// <summary>
/// Snapshot de uma janela do feed. Tempos em ms.
/// <para>
/// <b>Duas populações, de propósito.</b> <see cref="WaitMs"/>/<see cref="CopyMs"/>/
/// <see cref="ConvertMs"/>/<see cref="TotalMs"/> são médias dos frames <i>limpos</i>
/// (outlier por estágio &gt;100ms ou &lt;0 é excluído) — preservam a leitura do frame
/// saudável, que é o que interessa quando se diagnostica gargalo por estágio.
/// <see cref="FeedFps"/> e <see cref="TotalMsAll"/>, ao contrário, usam <i>todos</i> os
/// frames bons, porque o fps é uma taxa de parede. Misturar as duas conta é o que
/// impedia o log de fechar: <c>TotalMs × GoodFrames</c> subestima o trabalho real na
/// proporção dos outliers.
/// </para>
/// <para>
/// <b>Bloco CFR (2026-10-03).</b> <see cref="TotalMsMax"/>, <see cref="OverrunFrames"/>,
/// <see cref="DuplicateFrames"/>, <see cref="MaxConsecutiveDup"/> e <see cref="SkippedFrames"/>
/// só existem depois da grelha absoluta + padding. Sem eles o log de 5 s não distingue
/// "60 fps reais" de "57,8 fps com 542 buracos" — as duas coisas imprimem <c>fps≈58</c>.
/// <c>MaxConsecutiveDup &gt; poolSize−1</c> é a regra de diagnóstico que separa padding
/// honesto (conteúdo parado) de mentira (a captura está a perder frames).
/// </para>
/// </summary>
internal readonly record struct FeedSummary(
    int GoodFrames,
    int EncodeNulls,
    int FailFrames,
    double WaitMs,
    double CopyMs,
    double ConvertMs,
    double TotalMs,
    int CleanFrames,
    double TotalMsAll,
    double PacingDelayMs,
    double PacingSpinMs,
    int PacingCount,
    double FeedFps,
    double QueueDepthAvg,
    int QueueDepthMax,
    double DiagnosticsMs = 0,
    double TotalMsMax = 0,
    int OverrunFrames = 0,
    int DuplicateFrames = 0,
    int MaxConsecutiveDup = 0,
    int SkippedFrames = 0);