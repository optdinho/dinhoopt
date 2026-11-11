using DiNho.Capture.Poc.Capture;

namespace DiNho.Capture.Poc.Tests;

public sealed class DxgiCaptureSourceTests
{
    // ═══════════════════════════════════════════════════════════════
    //  Rótulo do backend / nível do Desktop Duplication (2026-11-10)
    //  O fallback DDA 1.1 → 1.0 era invisível: o log dizia
    //  "DXGI Desktop Duplication" e nada mais. Na máquina do cliente
    //  o DuplicateOutput1 falhou (DXGI_ERROR_UNSUPPORTED) e o motor
    //  ficou em DDA 1.0 — que força o desktop a sair do caminho de
    //  composição otimizado. O rótulo passa a carregar o nível, para
    //  o utilizador poder confirmar "DDA 1.0" na barra de estado.
    // ═══════════════════════════════════════════════════════════════

    [Theory]
    [InlineData(11, "DXGI (DDA 1.1)")]
    [InlineData(10, "DXGI (DDA 1.0)")]
    [InlineData(0, "DXGI")]
    public void FormatBackendLabel_MapsDuplicationLevel(int level, string expected)
    {
        Assert.Equal(expected, DxgiCaptureSource.FormatBackendLabel(level));
    }

    [Fact]
    public void DescribeDxgiBackend_WithoutFallback_NamesTheLevel()
    {
        Assert.Equal("DXGI Desktop Duplication 1.1", DxgiCaptureSource.DescribeDxgiBackend(11, null));
    }

    [Fact]
    public void DescribeDxgiBackend_WithFallback_KeepsTheCause()
    {
        var text = DxgiCaptureSource.DescribeDxgiBackend(
            10,
            "COMException 0x887A0022 (HRESULT desconhecido): DuplicateOutput1 não suportado");

        Assert.Contains("Desktop Duplication", text);
        Assert.Contains("1.0", text);
        Assert.Contains("0x887A0022", text);
    }

    [Fact]
    public void DescribeDxgiBackend_UnknownLevel_DoesNotPretendToKnow()
    {
        Assert.Equal("DXGI Desktop Duplication desconhecido", DxgiCaptureSource.DescribeDxgiBackend(0, null));
    }
}
