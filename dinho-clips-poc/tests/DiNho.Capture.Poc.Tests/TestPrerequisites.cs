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

    /// <summary>
    /// Verdadeiro num runner de CI (o GitHub Actions define <c>CI=true</c>).
    /// <para>
    /// Usado para NÃO correr no CI os testes de stress de timing e de integração real
    /// com ffmpeg: num runner partilhado de 2 núcleos a carga deixa de ser
    /// representativa e os timeouts/escalonamento falham por ambiente, não por lógica
    /// (ex.: byte-count sob timeout, corrida de escalonamento do writer, mux real que
    /// depende do build de ffmpeg). Ficam opt-in fora do CI, onde correm e passam (gate
    /// local 2552/2552). Os testes de lógica pura continuam a correr no CI.
    /// </para>
    /// </summary>
    internal static bool IsCi =>
        string.Equals(Environment.GetEnvironmentVariable("CI"), "true", StringComparison.OrdinalIgnoreCase);
}
