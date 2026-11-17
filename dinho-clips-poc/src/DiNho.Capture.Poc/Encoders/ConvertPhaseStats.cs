namespace DiNho.Capture.Poc.Encoders;

/// <summary>
/// Médias por sub-fase do convert GPU, acumuladas entre leituras.
///
/// <para>
/// O <c>FeedTelemetry</c> mede o <c>convert</c> inteiro (blit + copy + map + pack) e em
/// 2026-11-16 ele custou 23,7–36,5 ms contra um orçamento de 16,7 ms — mas o log não dizia
/// QUAL das quatro fases come o tempo, e as quatro têm correções opostas: <c>map</c>
/// bloqueante pede não bloquear (perder o frame é melhor que atrasar o loop); <c>blit</c>
/// ou <c>copy</c> caros pedem aliviar a GPU (usage/vbaq do AMF) ou baixar o fps.
/// </para>
/// <para>
/// Sem dependências de D3D/relógio: o chamador passa os deltas em ms. <see cref="Take"/>
/// devolve a média da janela e reinicia — o mesmo ritmo do resumo do feed (~2,5 s).
/// </para>
/// </summary>
internal sealed class ConvertPhaseStats
{
    /// <summary>Média de uma janela. <see cref="Frames"/> é a amostra que a sustenta.</summary>
    internal readonly record struct Average(
        double BlitMs, double CopyMs, double MapMs, double PackMs, int Frames);

    private readonly object _sync = new();
    private double _blitMs;
    private double _copyMs;
    private double _mapMs;
    private double _packMs;
    private int _frames;

    /// <summary>Acumula UMA conversão completa. Frames que não chegam ao pack não entram.</summary>
    internal void Record(double blitMs, double copyMs, double mapMs, double packMs)
    {
        // `Record` corre na thread do pipeline e `Take` na do coordenador (resumo do
        // feed). O lock é trivial a 60 frames/s e evita perder/duplicar uma amostra na
        // fronteira da janela.
        lock (_sync)
        {
            _blitMs += blitMs;
            _copyMs += copyMs;
            _mapMs += mapMs;
            _packMs += packMs;
            _frames++;
        }
    }

    /// <summary>
    /// Média da janela desde o último <see cref="Take"/> e reinício. <c>null</c> quando não
    /// houve nenhuma conversão completa — nunca devolver 0 para "sem medição".
    /// </summary>
    internal Average? Take()
    {
        lock (_sync)
        {
            if (_frames == 0) return null;

            int n = _frames;
            var avg = new Average(_blitMs / n, _copyMs / n, _mapMs / n, _packMs / n, n);
            _blitMs = 0;
            _copyMs = 0;
            _mapMs = 0;
            _packMs = 0;
            _frames = 0;
            return avg;
        }
    }
}
