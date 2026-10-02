using System.Diagnostics;
using DiNho.Capture.Poc.Capture;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// T3 — o pool do WGC nunca era recriado quando o tamanho da janela mudava.
///
/// Incidente 2026-10-01 (E4): a janela do jogo passou de 1932x1052 para 1933x1052.
/// O <c>Direct3D11CaptureFramePool</c> continuava com o tamanho antigo, e o encoder via
/// <c>ConvertGpuNv12</c> caía no fallback CPU porque a largura da textura não batia
/// exatamente com <c>_width</c> — <c>convert</c> saltou de ~2,2 ms para 70-75 ms,
/// o encoder virava o gargalo e o save saía truncado (152,82 s de 305,01 s
/// esperados).
///
/// Referência: a WebRTC recria o pool em <c>WgcCaptureSession::OnContentSizeChanged</c>
/// (modules/desktop_capture/win/wgc_capture_session.cc).
/// </summary>
public sealed class WgcResizeTests
{
    // ── ShouldRecreatePool ─────────────────────────────────────────────

    [Fact]
    public void FirstPool_AlwaysRecreates()
    {
        // poolW/poolH = 0 = pool ainda não criado.
        Assert.True(WgcCaptureSource.ShouldRecreatePool(1920, 1080, 0, 0));
    }

    [Fact]
    public void SameSize_DoesNotRecreate()
    {
        Assert.False(WgcCaptureSource.ShouldRecreatePool(1920, 1080, 1920, 1080));
    }

    [Fact]
    public void WidthChangedByOne_Recreates()
    {
        // 1932 -> 1933: um pixel. O bug real.
        Assert.True(WgcCaptureSource.ShouldRecreatePool(1933, 1052, 1932, 1052));
    }

    [Fact]
    public void HeightChangedByOne_Recreates()
    {
        Assert.True(WgcCaptureSource.ShouldRecreatePool(1932, 1053, 1932, 1052));
    }

    [Fact]
    public void BigResize_Recreates()
    {
        Assert.True(WgcCaptureSource.ShouldRecreatePool(1280, 720, 1920, 1080));
    }

    [Fact]
    public void OnlyWidthChanged_IsStillAResize()
    {
        // Height igual nao pode "mascarar" a mudanca de largura.
        Assert.True(WgcCaptureSource.ShouldRecreatePool(3840, 1080, 1920, 1080));
    }

    [Fact]
    public void OnlyHeightChanged_IsStillAResize()
    {
        Assert.True(WgcCaptureSource.ShouldRecreatePool(1920, 2160, 1920, 1080));
    }

    [Fact]
    public void DegenerateFrameSize_DoesNotRecreate()
    {
        // Frame degenerado (0x0) durante minimize/alt-tab: recriar o pool aqui
        // derrubaria a sessao. O frame e descartado, nao propagado.
        Assert.False(WgcCaptureSource.ShouldRecreatePool(0, 0, 1920, 1080));
        Assert.False(WgcCaptureSource.ShouldRecreatePool(1920, 0, 1920, 1080));
        Assert.False(WgcCaptureSource.ShouldRecreatePool(0, 1080, 1920, 1080));
    }

    [Fact]
    public void DegeneratePoolSize_Recreates()
    {
        Assert.True(WgcCaptureSource.ShouldRecreatePool(1920, 1080, 0, 0));
    }

    [Fact]
    public void ShouldRecreatePool_IsPureFunctionOfArguments()
    {
        // Duas avaliacoes com os mesmos argumentos tem que concordar — o resize
        // nao pode depender de estado escondido.
        for (var i = 0; i < 5; i++)
            Assert.True(WgcCaptureSource.ShouldRecreatePool(1280, 720, 1920, 1080));
    }

    // ── Debounce do LOG (nao da decisao) ───────────────────────────────

    [Fact]
    public void ResizeLog_FirstResize_AlwaysLogs()
    {
        // lastResizeTicks == 0 = ainda nao logou nada nesta sessao.
        var now = Stopwatch.GetTimestamp();
        Assert.True(WgcCaptureSource.ShouldLogResize(now, lastResizeTicks: 0));
    }

    [Fact]
    public void ResizeLog_RapidResize_IsThrottled()
    {
        // Rajada de resize: 40 frames em 200 ms -> 1 log so.
        var now = Stopwatch.GetTimestamp();
        var justLogged = now - (Stopwatch.Frequency / 20); // 50 ms atras
        Assert.False(WgcCaptureSource.ShouldLogResize(now, justLogged));
    }

    [Fact]
    public void ResizeLog_AfterDebounceWindow_LogsAgain()
    {
        // Passados 250 ms desde o ultimo log, um novo resize aparece.
        var now = Stopwatch.GetTimestamp();
        var longAgo = now - WgcCaptureSource.ResizeDebounceTicks - (Stopwatch.Frequency / 100);
        Assert.True(WgcCaptureSource.ShouldLogResize(now, longAgo));
    }

    [Fact]
    public void ResizeLog_ZeroDebounce_AlwaysLogs()
    {
        var now = Stopwatch.GetTimestamp();
        Assert.True(WgcCaptureSource.ShouldLogResize(now, now, debounceTicks: 0));
    }

    [Fact]
    public void ResizeDebounce_IsAboutAQuarterSecond()
    {
        // O valor nao pode ser 0 (log a cada frame) nem de segundos (perde o resize).
        Assert.InRange(WgcCaptureSource.ResizeDebounceTicks, Stopwatch.Frequency / 8, Stopwatch.Frequency);
    }

    // ── Texturas ───────────────────────────────────────────────────────
    //
    // Nao ha teste unitario para TexturePool aqui de proposito: Rent() ja
    // descarta as texturas quando a dimensao muda (TexturePool.cs:34-44) e
    // prova-lo exigiria um ID3D11Device real, ou seja, GPU presente no runner.
    // O que precisa de teste e a DECISAO de recriar o frame pool — que e o bug.
}
