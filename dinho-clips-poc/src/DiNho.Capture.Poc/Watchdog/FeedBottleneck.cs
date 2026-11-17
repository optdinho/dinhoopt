namespace DiNho.Capture.Poc.Watchdog;

/// <summary>
/// Quem está a impedir o feed de atingir o fps alvo. Três estados de falha mais
/// "saudável" e "sem medição" — sem esta distinção o log de 2026-11-16 dizia
/// <c>"o encoder não é o gargalo"</c> quando o problema era a conversão GPU do próprio
/// pipeline (o <c>FeedFps</c> mede frames que ENTRARAM no ffmpeg, ou seja a taxa do loop:
/// é circular).
/// </summary>
public enum FeedBottleneckVerdict
{
    /// <summary>Sem medição utilizável — nunca concluir nada.</summary>
    Unknown = 0,

    /// <summary>Feed no alvo (≥ 90%): não há défice a atribuir.</summary>
    Sustained = 1,

    /// <summary>A conversão GPU (blit + copy + map + pack) come o orçamento do slot.</summary>
    ConvertBound = 2,

    /// <summary>A fonte (captura) é que não entrega — degradar não recupera frames.</summary>
    SourceBound = 3,
}

/// <summary>
/// Atribuição do gargalo do feed, sem dependência do encoder nem de I/O (testável).
///
/// <para>
/// Entradas: <c>feedFps</c> (taxa efetiva da janela), <c>nominalFps</c> (alvo), e as duas
/// médias por estágio da <c>FeedTelemetry</c> — <c>wait</c> (espera pela fonte) e
/// <c>convert</c> (conversão para NV12 + enqueue). A regra vem dos números de 2026-11-16:
/// orçamento de 16,7 ms a 60 fps, <c>convert</c> 23,7–36,5 ms e <c>wait</c> 0,8–1,3 ms.
/// </para>
/// </summary>
public static class FeedBottleneck
{
    /// <summary>
    /// <c>convert</c> acima de 90% do orçamento já não cabe no período: a conversão
    /// sozinha come o slot. O valor vem das janelas de 2026-11-16 (559 janelas, 70 com
    /// <c>skip ≥ 10%</c>): nas saudáveis o <c>convert</c> máximo foi 14,6 ms, e as
    /// degradadas com <c>convert</c> 16–20 ms perdiam 11–36% dos slots com
    /// <c>wait &lt; 1,2 ms</c>. Um corte em 120% deixava 28 dessas janelas sem
    /// atribuição nenhuma.
    /// </summary>
    internal const double ConvertBoundRatio = 0.9;

    /// <summary><c>wait</c> abaixo de 50% do orçamento = a fonte está a entregar depressa.</summary>
    internal const double SourceWaitRatio = 0.5;

    /// <summary>
    /// Feed a partir de 95% do alvo não tem défice que valha a pena atribuir. Era 90%,
    /// mas a telemetria de 11-16 mostra as perdas a cair em degraus de 6 fps
    /// (30/36/42/48/54) e a janela saudável a 60,0 — o degrau de 54 fps ficava
    /// exatamente no limite e era declarado saudável com 13% dos slots perdidos.
    /// </summary>
    internal const double SustainedRatio = 0.95;

    /// <summary>Orçamento de wall-clock por frame, em ms.</summary>
    public static double SlotBudgetMs(double nominalFps) =>
        nominalFps > 0 ? 1000.0 / nominalFps : 0;

    public static FeedBottleneckVerdict Classify(
        double feedFps, double nominalFps, double waitMs, double convertMs)
    {
        if (nominalFps <= 0 || feedFps <= 0) return FeedBottleneckVerdict.Unknown;

        // 59,9 contra 60 é ruído, não défice. O ClassifyFeed do capacity guard exige
        // `feed >= nominal` e por isso chamava "deficiente" a um feed saudável.
        if (feedFps >= SustainedRatio * nominalFps) return FeedBottleneckVerdict.Sustained;

        var budget = SlotBudgetMs(nominalFps);
        if (convertMs > ConvertBoundRatio * budget && waitMs < SourceWaitRatio * budget)
            return FeedBottleneckVerdict.ConvertBound;

        if (waitMs >= SourceWaitRatio * budget)
            return FeedBottleneckVerdict.SourceBound;

        return FeedBottleneckVerdict.Unknown;
    }
}
