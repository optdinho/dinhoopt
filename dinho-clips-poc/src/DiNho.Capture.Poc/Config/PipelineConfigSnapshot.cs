using System;
using System.Collections.Generic;

namespace DiNho.Capture.Poc.Config;

/// <summary>O que uma alteração de config exige do pipeline EM CURSO.</summary>
/// <remarks>
/// <see cref="EncoderParams"/> e <see cref="FrameRate"/> são reaplicáveis a quente
/// (basta reiniciar o encoder — a captura e o buffer de replay ficam).
/// <see cref="OutputFormat"/> NÃO é: o save usa <c>-c:v copy</c> e o mesmo ficheiro com
/// pacotes de duas resoluções sai corrompido, por isso entra no próximo arranque.
/// </remarks>
internal readonly record struct LiveConfigChange(bool EncoderParams, bool FrameRate, bool OutputFormat)
{
    internal static readonly LiveConfigChange None = new(false, false, false);

    /// <summary>Há algo que um reinício do encoder resolve agora.</summary>
    internal bool NeedsEncoderRestart => EncoderParams || FrameRate;

    internal bool IsEmpty => !EncoderParams && !FrameRate && !OutputFormat;

    public override string ToString()
    {
        if (IsEmpty)
            return "nenhuma alteração de pipeline";

        var parts = new List<string>(3);
        if (EncoderParams) parts.Add("qualidade");
        if (FrameRate) parts.Add("fps");
        if (OutputFormat) parts.Add("resolução/codec");
        return string.Join(", ", parts);
    }
}

/// <summary>
/// Retrato dos campos de config que o pipeline lê UMA vez, no arranque da captura.
/// Serve para comparar "o que está em vigor" com "o que o utilizador acabou de gravar"
/// e decidir o que dá para reaplicar a meio da gravação (2026-11-10).
/// </summary>
internal readonly record struct PipelineConfigSnapshot(
    int Fps,
    int Width,
    int Height,
    int Cq,
    int MaxrateKbps,
    int BufsizeKbps,
    int Bframes,
    int Lookahead,
    string EncoderPreset,
    string Codec,
    bool ForceSoftware,
    bool Multipass,
    string AmfUsage,
    bool StretchToFit,
    bool AdaptiveQualityEnabled)
{
    internal static PipelineConfigSnapshot From(AppConfig config) => new(
        Fps: config.Fps,
        Width: config.Width,
        Height: config.Height,
        Cq: config.Cq,
        MaxrateKbps: config.MaxrateKbps,
        BufsizeKbps: config.BufsizeKbps,
        Bframes: config.Bframes,
        Lookahead: config.Lookahead,
        EncoderPreset: config.EncoderPreset ?? "",
        Codec: config.Codec ?? "",
        ForceSoftware: config.ForceSoftware,
        Multipass: config.Multipass,
        AmfUsage: config.AmfUsage ?? "",
        StretchToFit: config.StretchToFit,
        AdaptiveQualityEnabled: config.AdaptiveQualityEnabled);

    /// <summary>
    /// Classifica a diferença entre o que está em vigor e o que foi gravado agora.
    /// <c>AdaptiveQualityEnabled</c> entra em <see cref="OutputFormat"/> de propósito:
    /// ele troca o perfil de RAM, que impõe um cap de resolução de saída — mexer nisso
    /// a quente podia reduzir a resolução escolhida na UI (invariante: resolução é
    /// sagrada). O mesmo para <c>ForceSoftware</c>, que troca a família de codec.
    /// </summary>
    internal LiveConfigChange DiffTo(PipelineConfigSnapshot next) => new(
        EncoderParams: Cq != next.Cq
            || MaxrateKbps != next.MaxrateKbps
            || BufsizeKbps != next.BufsizeKbps
            || Bframes != next.Bframes
            || Lookahead != next.Lookahead
            || Multipass != next.Multipass
            || StretchToFit != next.StretchToFit
            || !string.Equals(EncoderPreset, next.EncoderPreset, StringComparison.Ordinal)
            || !string.Equals(AmfUsage, next.AmfUsage, StringComparison.Ordinal),
        FrameRate: Fps != next.Fps,
        OutputFormat: Width != next.Width
            || Height != next.Height
            || ForceSoftware != next.ForceSoftware
            || AdaptiveQualityEnabled != next.AdaptiveQualityEnabled
            || !string.Equals(Codec, next.Codec, StringComparison.Ordinal));

    /// <summary>
    /// Mantém o formato (resolução/codec) que está REALMENTE em uso e adota o resto.
    /// Usado depois de reaplicar qualidade a quente com uma resolução nova pendente:
    /// sem isto, a resolução nova ficava marcada como aplicada e nunca entrava.
    /// </summary>
    internal PipelineConfigSnapshot KeepOutputFormatOf(PipelineConfigSnapshot applied) => this with
    {
        Width = applied.Width,
        Height = applied.Height,
        Codec = applied.Codec,
        ForceSoftware = applied.ForceSoftware,
        AdaptiveQualityEnabled = applied.AdaptiveQualityEnabled,
    };
}
