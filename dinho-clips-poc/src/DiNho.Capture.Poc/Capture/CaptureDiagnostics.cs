namespace DiNho.Capture.Poc.Capture;

/// <summary>
/// Formatação partilhada de diagnósticos de captura. Existe porque o motor engolia a
/// CAUSA de as coisas falharem: o latch do WGC dizia "indisponível" sem o porquê e o
/// fallback do DXGI dizia "DuplicateOutput1 not supported" só em Debug, sem HRESULT.
/// Sem código de erro e sem o build do Windows, um log de campo não distingue serviço
/// desligado de build antigo, de driver, de sessão remota — e o diagnóstico vira
/// adivinhação (log do cliente de 2026-11-10, RTX 3060, WGC → DXGI sem motivo).
/// </summary>
internal static class CaptureDiagnostics
{
    private const string UnknownHResult = "HRESULT desconhecido";

    /// <summary>HRESULT → causa legível. Códigos fora da lista ficam anónimos de
    /// propósito: inventar uma causa é o que já nos custou um gate AV1 errado.</summary>
    public static string DescribeHResult(int hresult) => unchecked((uint)hresult) switch
    {
        0x80070422U => "ERROR_SERVICE_DISABLED — serviço de captura desligado",
        0x80070005U => "E_ACCESSDENIED — sem consentimento/permissão",
        0x80070032U => "ERROR_NOT_SUPPORTED — build/edição do Windows sem suporte",
        0x80004002U => "E_NOINTERFACE — WGC/WinRT indisponível neste sistema",
        0x80070490U => "ERROR_NOT_FOUND — captura/monitor não encontrado",
        0x80070057U => "E_INVALIDARG — parâmetro inválido",
        0x80004005U => "E_FAIL",
        0x8000FFFFU => "E_UNEXPECTED",
        _ => UnknownHResult,
    };

    /// <summary>
    /// Exception → tipo + HRESULT (hex e nome) + mensagem, seguindo a cadeia
    /// InnerException (o WinRT embrulha o COMException, e é no HRESULT que está a
    /// informação accionável). Máximo 3 níveis para o log não explodir.
    /// </summary>
    public static string DescribeFailure(Exception? ex)
    {
        if (ex is null) return "motivo desconhecido";

        var parts = new List<string>(3);
        for (var e = ex; e is not null && parts.Count < 3; e = e.InnerException)
            parts.Add(DescribeOne(e));

        return string.Join(" ← ", parts);
    }

    private static string DescribeOne(Exception e)
    {
        var label = DescribeHResult(e.HResult);
        // Excepções geridas sem HRESULT relevante (ex.: InvalidOperationException,
        // 0x80131509) só poluiriam a linha com um "desconhecido" inútil.
        var head = label == UnknownHResult
            ? e.GetType().Name
            : $"{e.GetType().Name} 0x{unchecked((uint)e.HResult):X8} ({label})";
        return $"{head}: {e.Message}";
    }

    /// <summary>Build do Windows + tipo de sessão, para acompanhar o latch do WGC.</summary>
    public static string DescribeEnvironment() =>
        DescribeEnvironment(Environment.OSVersion.Version, Environment.GetEnvironmentVariable("SESSIONNAME"));

    /// <summary>Forma testável de <see cref="DescribeEnvironment()"/>.</summary>
    internal static string DescribeEnvironment(Version version, string? sessionName)
    {
        // Em sessão remota a captura degrada por desenho (DWM/RDP não tem o mesmo
        // caminho de composição); sem isto escrito, "WGC indisponível" num log
        // remoto parece defeito de código.
        var session = sessionName is not null
                      && sessionName.StartsWith("RDP-", StringComparison.OrdinalIgnoreCase)
            ? "sessão remota (RDP)"
            : "sessão local";
        return $"Windows {version.Major}.{version.Minor}.{version.Build} · {session}";
    }

    /// <summary>11 = IDXGIOutput5.DuplicateOutput1 (Win10 1703+), 10 = fallback
    /// IDXGIOutput1.DuplicateOutput (Win8+), 0 = ainda não criado.</summary>
    public static string DescribeDesktopDuplicationLevel(int level) => level switch
    {
        11 => "1.1",
        10 => "1.0",
        _ => "desconhecido",
    };
}
