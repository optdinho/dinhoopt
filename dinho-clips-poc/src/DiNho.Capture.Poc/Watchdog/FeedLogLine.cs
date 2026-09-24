using System.Globalization;

namespace DiNho.Capture.Poc.Watchdog;

/// <summary>
/// Formata o tick periódico do feed (FeedTelemetry) com o diagnóstico do encoder: codec ativo,
/// divisor de escala do fallback e backlog de saída (speed/lag do ffmpeg). Mantém o formato
/// existente das métricas da janela e adiciona o bloco do encoder ao final.
/// </summary>
internal static class FeedLogLine
{
    internal static string Build(
        FeedSummary summary,
        string codec,
        int scaleDivisor,
        double speedX,
        double outputLagSeconds)
    {
        var scale = scaleDivisor > 1 ? $"1/{scaleDivisor}" : "full";

        var i = CultureInfo.InvariantCulture;
        return string.Concat(
            $"fps={summary.FeedFps.ToString("F1", i)} good={summary.GoodFrames} fail={summary.FailFrames} enqNull={summary.EncodeNulls} | ",
            $"wait={summary.WaitMs.ToString("F1", i)}ms copy={summary.CopyMs.ToString("F1", i)}ms ",
            $"convert={summary.ConvertMs.ToString("F1", i)}ms total={summary.TotalMs.ToString("F1", i)}ms | ",
            $"queue={summary.QueueDepthAvg.ToString("F1", i)} avg / {summary.QueueDepthMax} max | ",
            $"codec={codec} scale={scale} speed={speedX.ToString("F2", i)}x lag={outputLagSeconds.ToString("F0", i)}s");
    }
}