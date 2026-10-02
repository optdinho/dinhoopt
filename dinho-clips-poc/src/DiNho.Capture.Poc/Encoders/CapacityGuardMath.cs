namespace DiNho.Capture.Poc.Encoders;

/// <summary>
/// Estado do FEED para o capacity guard. São três estados, não dois: sem medição
/// não é a mesma coisa que feed saudável.
/// </summary>
public enum FeedState
{
    /// <summary>
    /// Sem medição: nenhum frame ainda, janela ainda enchendo ou contador zerado.
    /// <b>Nunca</b> ler como "o encoder é o gargalo".
    /// </summary>
    Unknown = 0,

    /// <summary>Feed no alvo (ou acima) — o encoder que sofre é o gargalo.</summary>
    Healthy = 1,

    /// <summary>Feed abaixo do alvo — reduzir escala não recupera nenhum frame.</summary>
    Deficient = 2,
}

/// <summary>
/// Aritmética do capacity guard, sem dependência do encoder (T4).
/// </summary>
public static class CapacityGuardMath
{
    /// <summary>
    /// Déficit do FEED em segundos de mídia por segundo de wall-clock.
    ///
    /// <para>
    /// O <c>outputLagSeconds</c> do ffmpeg (<c>elapsed − time</c>) não mede a
    /// saúde do encoder. Com <c>-r 60</c> e um feed de 40 fps, <c>time</c> fica
    /// para trás de <c>elapsed</c> mesmo com o encoder instantâneo e o backlog
    /// vazio — em 2026-10-01 isso rendeu <c>lag=5936s</c> (99 min) numa sessão de
    /// 10,5 h, e degradou a escala do encoder sem ganhar frame nenhum.
    /// </para>
    /// <para>
    /// O déficit do feed é a medida honesta: 40 fps contra alvo de 60 entrega
    /// 0,667 s de mídia por segundo de wall-clock, ou seja, 0,333 s/s de déficit.
    /// </para>
    /// <para>
    /// Usado só para diagnóstico no log; a decisão usa <see cref="ClassifyFeed"/>,
    /// porque 0 (sem medição) e 0 (feed no alvo) não podem ser o mesmo número.
    /// </para>
    /// </summary>
    public static double FeedLagSeconds(double feedFps, double nominalFps)
    {
        // Sem medição de feed (telemetria desligada) ou sem alvo conhecido, não
        // inventa déficit: quem decide é o ShouldDegrade com o flag explícito.
        if (feedFps <= 0 || nominalFps <= 0) return 0;
        if (feedFps >= nominalFps) return 0;
        return 1.0 - (feedFps / nominalFps);
    }

    /// <summary>
    /// Classifica o feed em <see cref="FeedState"/>.
    ///
    /// <para>
    /// <b>Regressão de runtime 2026-10-01 21:34:14.</b> Antes desta função o
    /// guard derivava o estado de um único número: <c>FeedFps == 0</c> virava
    /// "sem déficit" e portanto "o encoder é o gargalo". Mas
    /// <see cref="FfmpegEncoder.FeedFps"/> devolve 0 justamente quando NÃO há
    /// medição — nenhum frame ainda, janela de 3 s enchendo, contador zerado — e
    /// esses são os casos em que o WGC colapsou (5,8 fps com 183 falhas na
    /// janela). O guard degradeu para 1280×720 e reiniciou o ffmpeg no meio do
    /// colapso de captura, descartando backlog de saída e estado de PTS: a falha
    /// exata que o T4 existe para evitar.
    /// </para>
    /// <para>
    /// "Desconhecido" não é "saudável": degradar exige PROVA de que o encoder é o
    /// gargalo, e o preço de errar é alto (restart + 720p pelo resto da sessão).
    /// </para>
    /// </summary>
    public static FeedState ClassifyFeed(double feedFps, double nominalFps)
    {
        // Sem alvo conhecido não há como dizer que o feed está saudável.
        if (nominalFps <= 0) return FeedState.Unknown;
        // feedFps == 0 = sem medição, nunca "no alvo".
        if (feedFps <= 0) return FeedState.Unknown;
        return feedFps >= nominalFps ? FeedState.Healthy : FeedState.Deficient;
    }
}
