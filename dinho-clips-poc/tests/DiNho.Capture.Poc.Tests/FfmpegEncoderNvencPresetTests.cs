using System.Reflection;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Trava de regressão do Item 5: a escada de preset NVENC é resolvida com o codec
/// <b>JÁ DETECTADO</b>, nunca com o codec configurado.
///
/// <para><b>O bug que estes testes existem para impedir.</b> A escada estava sendo chamada
/// em <c>EngineCoordinator.StartCapture</c> e no restart, sempre com
/// <c>_config.Config.Codec</c>. Esse valor é literalmente <c>"auto"</c> — o front força
/// <c>C.codec = 'auto'</c> em toda escrita de config (<c>clips.ipc.ts</c>) e é o default do
/// <c>AppConfig</c>. Como <c>ResolveEffectiveNvencPreset</c> faz early-return para codec
/// não-NVENC, a escada <b>nunca rodava em produção</b>: o preset efetivo era o <c>p5</c>
/// legado e o log de "preset adaptativo" nunca disparava, porque o valor devolvido era
/// igual ao configurado. Nenhum teste pegou porque os 10 testes da escada passavam sempre
/// codec <i>explícito</i> (<c>av1_nvenc</c>/<c>h264_nvenc</c>) e o <c>Theory</c> de
/// codecs não-NVENC não incluía <c>"auto"</c> — o único valor que o app envia.</para>
///
/// <para><b>Por que a classe fica no <c>FfmpegEncoder</c> e não no coordinator:</b> o
/// preset AMF já é resolvido em <c>Initialize</c>, logo depois de
/// <c>DetectBestCodec()</c> (<c>FfmpegEncoder.cs:530-537</c>). O NVENC estava na camada
/// errada — antes do codec existir. A correção usa o mesmo ponto do código, o que também
/// cobre o restart sem duplicar call site.</para>
/// </summary>
[Collection("FfmpegCodecCache")]
public sealed class FfmpegEncoderNvencPresetTests
{
    private const string LegacyPreset = "p5";

    private static (FfmpegEncoder Enc, Action<string?> SetPreset, Action SetResolvedCodec,
        Action<int, int> SetDims) CreateEncoder(string configuredPreset)
    {
        var enc = (FfmpegEncoder)System.Runtime.CompilerServices.RuntimeHelpers
            .GetUninitializedObject(typeof(FfmpegEncoder));
        var bf = BindingFlags.NonPublic | BindingFlags.Instance;
        void Set(string field, object? value) =>
            typeof(FfmpegEncoder).GetField(field, bf)!.SetValue(enc, value);

        Set("_nvencPreset", configuredPreset);
        Set("_width", 1920);
        Set("_height", 1080);
        Set("_frameRate", 60);
        // A escada mede a resolucao de SAIDA (o que o encoder realmente codifica), nao a
        // de captura - e o que a chamada no coordinator usava antes de morrer por "auto".
        Set("_outputWidth", 1920);
        Set("_outputHeight", 1080);
        return (enc,
            codec => Set("_codec", codec),
            () => enc.ResolveAdaptivePresetsAfterCodecDetection(),
            (w, h) => { Set("_outputWidth", w); Set("_outputHeight", h); });
    }

    [Fact]
    public void ResolveAdaptivePresets_LegacyDefaultOnResolvedNvencCodec_EngagesLadder()
    {
        var (enc, setCodec, resolve, _) = CreateEncoder(LegacyPreset);
        try
        {
            FfmpegEncoder.ResetEncoderCachesForTest();
            // O codec aqui é o DETECTADO, não o "auto" que o front manda.
            setCodec("h264_nvenc");
            resolve();

            var effective = Preset(enc);
            Assert.NotEqual(LegacyPreset, effective);
            Assert.StartsWith("p", effective);
        }
        finally { FfmpegEncoder.ResetEncoderCachesForTest(); }
    }

    [Theory]
    [InlineData("p1")]
    [InlineData("p3")]
    [InlineData("p7")]
    public void ResolveAdaptivePresets_ExplicitUserPreset_IsRespectedWithoutProbing(string configured)
    {
        var (enc, setCodec, resolve, _) = CreateEncoder(configured);
        try
        {
            FfmpegEncoder.ResetEncoderCachesForTest();
            setCodec("h264_nvenc");
            resolve();

            Assert.Equal(configured, Preset(enc));
        }
        finally { FfmpegEncoder.ResetEncoderCachesForTest(); }
    }

    [Theory]
    [InlineData("h264_amf")]
    [InlineData("hevc_qsv")]
    [InlineData("h264_d3d12va")]
    [InlineData("libx264")]
    [InlineData("auto")]
    [InlineData(null)]
    public void ResolveAdaptivePresets_NonNvencOrUnresolved_PassesThrough(string? codec)
    {
        var (enc, setCodec, resolve, _) = CreateEncoder(LegacyPreset);
        try
        {
            FfmpegEncoder.ResetEncoderCachesForTest();
            setCodec(codec);
            resolve();

            Assert.Equal(LegacyPreset, Preset(enc));
        }
        finally { FfmpegEncoder.ResetEncoderCachesForTest(); }
    }

    [Fact]
    public void ResolveAdaptivePresets_ZeroOutputDims_SkipsProbingAndPassesThrough()
    {
        var (enc, setCodec, resolve, setDims) = CreateEncoder(LegacyPreset);
        try
        {
            FfmpegEncoder.ResetEncoderCachesForTest();
            setDims(0, 0);
            setCodec("av1_nvenc");
            resolve();

            Assert.Equal(LegacyPreset, Preset(enc));
        }
        finally { FfmpegEncoder.ResetEncoderCachesForTest(); }
    }

    /// <summary>
    /// Caracterização da armadilha: <c>ResolveEffectiveNvencPreset</c> com <c>"auto"</c>
    /// devolve o preset configurado, e está <b>certo</b> fazer isso — <c>"auto"</c> não é um
    /// codec. É exatamente por isso que o chamador precisa passar o codec resolvido.
    /// </summary>
    [Fact]
    public void ResolveEffectiveNvencPreset_AutoCodec_IsNotAnNvencCodec_SoItPassesThrough()
    {
        Assert.Equal(LegacyPreset,
            EncoderManager.ResolveEffectiveNvencPreset(LegacyPreset, "auto", 1920, 1080, 60));
    }

    /// <summary>
    /// Trava de <b>WIRING</b> — que era o buraco real desta classe, e o comentário acima
    /// destes testes afirmava o contrário.
    ///
    /// <para>Todos os outros testes daqui chamam
    /// <see cref="FfmpegEncoder.ResolveAdaptivePresetsAfterCodecDetection"/> <b>direto</b>, e
    /// por isso seguiam verdes com a escada <b>desligada</b>: apagando a chamada em
    /// <c>Initialize</c> (o único call site de produção) a suíte inteira continuava verde. É
    /// o bug do Item 5 ressurgido — a mesma classe dos 4 defeitos de revisão anteriores
    /// (<c>main10</c>, <c>-rc vbr_peak</c>, escada morta, status desatualizado): código certo,
    /// testado, e sem ligação com a produção.</para>
    ///
    /// <para>Este é o único teste que passa por <see cref="FfmpegEncoder.Initialize"/>, que é
    /// onde a produção resolve o preset (logo depois de <c>DetectBestCodec()</c>). O codec já
    /// vem resolvido porque o caminho real do restart é esse: com <c>_codec</c> cheio,
    /// <c>Initialize</c> pula a detecção e vai direto à escada. Passa pelo
    /// <c>StartFfmpeg</c> de verdade (o ffmpeg embarcado existe nesta máquina) e por isso
    /// custa um spawn real — é o preço de provar o caminho em vez de reimplementá-lo.</para>
    ///
    /// <para><b>A ordem importa e este teste a fixa.</b> <c>SetOutputResolution</c> tem de vir
    /// ANTES de <c>Initialize</c>, porque é o <c>Initialize</c> que dispara a escada e ela lê
    /// a resolução de <b>saída</b>. A produção já faz nessa ordem
    /// (<c>EngineCoordinator.Capture.cs:299-313</c>: SetQualityParams → SetOutputResolution →
    /// Initialize), então o caminho está certo — mas se alguém inverter, a escada não engata e
    /// <b>não dá erro nenhum</b>: com dimensão 0 o probe é pulado e o preset legado
    /// (<c>p5</c>) sobrevive. É por isso que o teste chama <c>SetOutputResolution</c> pelo
    /// mesmo caminho público que o coordinator usa, em vez de escrever o campo por reflexão.</para>
    /// </summary>
    [Fact]
    public void Initialize_ResolvesTheNvencLadder_BecauseProductionCallsTheResolver()
    {
        var enc = new FfmpegEncoder();
        try
        {
            FfmpegEncoder.ResetEncoderCachesForTest();
            // O cache de preset do NVENC é estático e vive no EncoderManager: a coleção já
            // isola esta classe das demais (DisableParallelization), mas dentro dela o teste
            // ainda leria o resultado de um teste anterior se o cache não for limpo. Sem isto
            // o teste passa a depender da ordem de execução.
            EncoderManager.ResetNvencPresetCache();
            SetField(enc, "_nvencPreset", LegacyPreset);
            SetField(enc, "_codec", "h264_nvenc"); // já detectado: Initialize pula DetectBestCodec
            SetField(enc, "_frameRate", 60);
            enc.SetOutputResolution(1920, 1080); // como EngineCoordinator.Capture.cs:310
            enc.Initialize(1920, 1080, 60);

            var effective = Preset(enc);
            Assert.NotEqual(LegacyPreset, effective);
            Assert.StartsWith("p", effective);
        }
        finally
        {
            EncoderManager.ResetNvencPresetCache();
            FfmpegEncoder.ResetEncoderCachesForTest();
            enc.Dispose();
        }
    }

    private static void SetField(FfmpegEncoder enc, string field, object? value) =>
        typeof(FfmpegEncoder)
            .GetField(field, BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(enc, value);

    private static string Preset(FfmpegEncoder enc) =>
        (string)typeof(FfmpegEncoder)
            .GetField("_nvencPreset", BindingFlags.NonPublic | BindingFlags.Instance)!
            .GetValue(enc)!;
}
