using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Guardas de disponibilidade do ambiente para testes que exigem ffmpeg no PATH
/// ou uma GPU NVIDIA real.
///
/// <para>
/// xUnit 2.9.3 não tem <c>Assert.Skip</c> (e o projeto não traz
/// <c>Xunit.SkippableFact</c>), por isso o padrão aqui é <b>pass-and-skip</b>:
/// devolver cedo quando o recurso não existe, como já se faz nos
/// <c>WasapiSourceTests</c> para máquinas sem endpoint de áudio. Sem isto a suíte
/// fica vermelha em runners sem ffmpeg embarcado ou sem GPU — embora o código
/// esteja correcto.
/// </para>
/// <para>
/// ⚠️ Estas guardas <b>não</b> substituem o ffmpeg no CI: o job <c>dotnet</c>
/// instala-o para que estes testes corram de facto lá. A guarda é só a rede de
/// segurança para máquinas de desenvolvimento sem ffmpeg no PATH.
/// </para>
/// <para>Os resultados são cacheados — cada sonda arranca um processo ffmpeg.</para>
/// </summary>
internal static class TestPrerequisites
{
    private static readonly Lazy<bool> _ffmpegAvailable = new(
        () => EncoderManager.CheckFfmpegAvailable());

    private static readonly Lazy<bool> _nvencAvailable = new(
        () => _ffmpegAvailable.Value && EncoderManager.ProbeEncoder("h264_nvenc").Success);

    /// <summary>true se o ffmpeg resolve e responde a <c>-version</c>.</summary>
    internal static bool FfmpegAvailable() => _ffmpegAvailable.Value;

    /// <summary>
    /// true se existe ffmpeg E ele consegue inicializar um encoder NVENC nesta
    /// máquina (exige GPU NVIDIA). Falso em runners sem GPU.
    /// </summary>
    internal static bool NvencAvailable() => _nvencAvailable.Value;
}
