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

    /// <summary>
    /// Limite de outlier por estágio (ms). Frames com qualquer estágio acima disso —
    /// ou com valor negativo (jitter de QPC ao reiniciar o WGC) — são excluídos da média.
    /// </summary>
    private const int OutlierMs = 100;
    private readonly long _outlierTicks;

    /// <param name="freq">Ticks por segundo (default: <see cref="Stopwatch.Frequency"/>).</param>
    internal FeedTelemetry(double windowSeconds = 5.0, long freq = 0)
    {
        _windowSeconds = Math.Max(0.1, windowSeconds);
        _freq = freq > 0 ? freq : Stopwatch.Frequency;
        _windowTicks = (long)(_freq * _windowSeconds);
        _outlierTicks = _freq * OutlierMs / 1000;
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
            _waitSamples.Add(waitTicks);
            _copySamples.Add(copyTicks);
            _convertSamples.Add(convertTicks);
            _totalSamples.Add(totalTicks);
        }
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
                DiagnosticsMs: _diagnosticsCount > 0 ? Ms(TicksToMs(_diagnosticsSum) / _diagnosticsCount) : 0);

            _windowStartTicks = nowTicks;
            _goodFrames = 0;
            _encodeNulls = 0;
            _failFrames = 0;
            _waitSamples.Clear();
            _copySamples.Clear();
            _convertSamples.Clear();
            _totalSamples.Clear();
            _pacingDelaySum = 0;
            _pacingSpinSum = 0;
            _pacingCount = 0;
            _diagnosticsSum = 0;
            _diagnosticsCount = 0;
            _queueDepthSum = 0;
            _queueDepthCount = 0;
            _queueDepthMax = 0;
            return true;
        }
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
    double DiagnosticsMs = 0);