using DiNho.Capture.Poc.Capture;
using System.Runtime.InteropServices;

namespace DiNho.Capture.Poc.Tests;

public sealed class CaptureDiagnosticsTests
{
    // ── DescribeHResult ─────────────────────────────────────────────

    [Theory]
    [InlineData(unchecked((int)0x80070422), "ERROR_SERVICE_DISABLED")]
    [InlineData(unchecked((int)0x80070005), "E_ACCESSDENIED")]
    [InlineData(unchecked((int)0x80070032), "ERROR_NOT_SUPPORTED")]
    [InlineData(unchecked((int)0x80004002), "E_NOINTERFACE")]
    [InlineData(unchecked((int)0x80070490), "ERROR_NOT_FOUND")]
    [InlineData(unchecked((int)0x80004005), "E_FAIL")]
    public void DescribeHResult_KnownCodes_ReturnSymbolicName(int hr, string expectedFragment)
    {
        Assert.Contains(expectedFragment, CaptureDiagnostics.DescribeHResult(hr));
    }

    [Fact]
    public void DescribeHResult_Unknown_DoesNotInventACause()
    {
        // Um código desconhecido tem de dizer que é desconhecido — adivinhar uma
        // causa foi exactamente o defeito do gate AV1 (perguntava ao ffmpeg).
        Assert.Equal("HRESULT desconhecido", CaptureDiagnostics.DescribeHResult(unchecked((int)0x81234567)));
    }

    // ── DescribeFailure ─────────────────────────────────────────────

    [Fact]
    public void DescribeFailure_ComException_IncludesHexAndSymbolicName()
    {
        var text = CaptureDiagnostics.DescribeFailure(
            new COMException("serviço de captura desligado", unchecked((int)0x80070422)));

        Assert.Contains("0x80070422", text);
        Assert.Contains("ERROR_SERVICE_DISABLED", text);
        Assert.Contains("serviço de captura desligado", text);
    }

    [Fact]
    public void DescribeFailure_UnwrapsInnerComException()
    {
        // WinRT embrulha o COMException: sem seguir a cadeia, o HRESULT — a única
        // coisa accionável do log — perdia-se.
        var ex = new InvalidOperationException(
            "WGC não criou o item",
            new COMException("sem consentimento", unchecked((int)0x80070005)));

        var text = CaptureDiagnostics.DescribeFailure(ex);

        Assert.Contains("InvalidOperationException", text);
        Assert.Contains("E_ACCESSDENIED", text);
        Assert.Contains("sem consentimento", text);
    }

    [Fact]
    public void DescribeFailure_PlainException_OmitsUnknownHresultNoise()
    {
        var text = CaptureDiagnostics.DescribeFailure(new InvalidOperationException("qualquer coisa"));
        Assert.Equal("InvalidOperationException: qualquer coisa", text);
    }

    [Fact]
    public void DescribeFailure_Null_ReturnsUnknown()
    {
        Assert.Equal("motivo desconhecido", CaptureDiagnostics.DescribeFailure(null));
    }

    // ── DescribeEnvironment ─────────────────────────────────────────

    [Fact]
    public void DescribeEnvironment_LocalSession_ReportsBuildAndLocal()
    {
        var text = CaptureDiagnostics.DescribeEnvironment(new Version(10, 0, 19045, 0), "Console");

        Assert.Contains("10.0.19045", text);
        Assert.Contains("local", text);
    }

    [Fact]
    public void DescribeEnvironment_RdpSession_IsCalledOut()
    {
        // Em sessão remota a captura degrada por desenho; sem isto no log, um
        // "WGC indisponível" parece defeito de código.
        var text = CaptureDiagnostics.DescribeEnvironment(new Version(10, 0, 22631, 0), "RDP-Tcp#2");

        Assert.Contains("remota", text);
    }

    [Fact]
    public void DescribeEnvironment_NoSessionName_DoesNotThrow()
    {
        var text = CaptureDiagnostics.DescribeEnvironment(new Version(10, 0, 26100, 0), null);
        Assert.Contains("26100", text);
    }

    // ── Nível do Desktop Duplication ────────────────────────────────

    [Theory]
    [InlineData(11, "1.1")]
    [InlineData(10, "1.0")]
    [InlineData(0, "desconhecido")]
    public void DescribeDesktopDuplicationLevel_MapsLevelToLabel(int level, string expected)
    {
        Assert.Equal(expected, CaptureDiagnostics.DescribeDesktopDuplicationLevel(level));
    }
}
