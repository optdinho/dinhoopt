using System.Globalization;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Watchdog;

/// <summary>
/// Formata o tick periódico do feed (FeedTelemetry) com o diagnóstico do encoder: codec ativo,
/// divisor de escala do fallback e o atraso de SAÍDA do ffmpeg (speed/outLag). Mantém o formato
/// existente das métricas da janela e adiciona o bloco do encoder ao final.
///
/// <para>
/// <c>outLag</c> é <c>elapsed − time</c> do próprio ffmpeg: cresce com o uptime por relógio
/// (com <c>-r 60</c> nominal e feed marginalmente abaixo, o <c>time</c> fica atrás do
/// <c>elapsed</c> mesmo sem backlog — sessão 2026-10-02: ~173 s em 4 h, linear, e ZERA no
/// restart). NÃO é saúde do feed. A medida honesta é <c>feedLag</c>
/// (<see cref="CapacityGuardMath.FeedLagSeconds"/>: déficit de mídia/s de wall-clock), que
/// fica ~0 enquanto o feed entrega o fps alvo. Ver <c>CapacityGuardMath</c> para o histórico.
/// </para>
/// </summary>
internal static class FeedLogLine
{
    internal static string Build(
        FeedSummary summary,
        string codec,
        int scaleDivisor,
        double speedX,
        double outputLagSeconds,
        double nominalFps)
    {
        var feedLag = CapacityGuardMath.FeedLagSeconds(summary.FeedFps, nominalFps);
        var scale = scaleDivisor > 1 ? $"1/{scaleDivisor}" : "full";

        var i = CultureInfo.InvariantCulture;
        return string.Concat(
            $"fps={summary.FeedFps.ToString("F1", i)} good={summary.GoodFrames} fail={summary.FailFrames} enqNull={summary.EncodeNulls} | ",
            $"wait={summary.WaitMs.ToString("F1", i)}ms copy={summary.CopyMs.ToString("F1", i)}ms ",
            $"convert={summary.ConvertMs.ToString("F1", i)}ms total={summary.TotalMs.ToString("F1", i)}ms ",
            $"clean={summary.CleanFrames}/{summary.GoodFrames} totalAll={summary.TotalMsAll.ToString("F1", i)}ms ",
            $"diag={summary.DiagnosticsMs.ToString("F1", i)}ms ",
            $"pace=delay {summary.PacingDelayMs.ToString("F1", i)}ms + spin {summary.PacingSpinMs.ToString("F1", i)}ms ",
            $"iters={summary.PacingCount} | ",
            $"queue={summary.QueueDepthAvg.ToString("F1", i)} avg / {summary.QueueDepthMax} max | ",
            $"codec={codec} scale={scale} speed={speedX.ToString("F2", i)}x " +
            $"outLag={outputLagSeconds.ToString("F0", i)}s feedLag={(feedLag * 100).ToString("F0", i)}%/s");
    }
}