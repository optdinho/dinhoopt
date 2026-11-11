using DiNho.Capture.Poc.Capture;
using System.Reflection;
using System.Runtime.InteropServices;

namespace DiNho.Capture.Poc.Tests;

public sealed class WgcCaptureSourceTests
{
    // ═══════════════════════════════════════════════════════════════
    //  CapturedFrame — constructor & properties
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void CapturedFrame_Success_HasCorrectDimensions()
    {
        var frame = new CapturedFrame(100, 200, 1920, 1080, success: true);
        Assert.Equal(1920, frame.Width);
        Assert.Equal(1080, frame.Height);
        Assert.True(frame.Success);
    }

    [Fact]
    public void CapturedFrame_Failure_HasZeroDimensions()
    {
        var frame = new CapturedFrame(100, 200, 0, 0, success: false);
        Assert.Equal(0, frame.Width);
        Assert.Equal(0, frame.Height);
        Assert.False(frame.Success);
    }

    [Fact]
    public void CapturedFrame_PreservesTicks()
    {
        var frame = new CapturedFrame(startTicks: 1000, endTicks: 2000, width: 100, height: 100, success: true);
        Assert.Equal(1000, frame.CaptureStartTicks);
        Assert.Equal(2000, frame.CaptureEndTicks);
    }

    [Fact]
    public void CapturedFrame_WaitEndTicks_DefaultsToZero()
    {
        var frame = new CapturedFrame(0, 0, 0, 0, success: false);
        Assert.Equal(0, frame.WaitEndTicks);
        Assert.Equal(0, frame.CopyEndTicks);
    }

    [Fact]
    public void CapturedFrame_WaitEndTicks_CanBeSet()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true, waitEndTicks: 500, copyEndTicks: 600);
        Assert.Equal(500, frame.WaitEndTicks);
        Assert.Equal(600, frame.CopyEndTicks);
    }

    [Fact]
    public void CapturedFrame_TextureDefaultsToNull()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true);
        Assert.Null(frame.Texture);
        Assert.Null(frame.Device);
    }

    [Fact]
    public void CapturedFrame_OwnsTexture_DefaultsTrue()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true);
        Assert.True(frame.OwnsTexture);
    }

    [Fact]
    public void CapturedFrame_OwnsTexture_CanBeSetFalse()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true, ownsTexture: false);
        Assert.False(frame.OwnsTexture);
    }

    // ── Dispose behavior ────────────────────────────────────────────

    [Fact]
    public void CapturedFrame_Dispose_WithNullTexture_DoesNotThrow()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true);
        frame.Dispose(); // no exception
    }

    [Fact]
    public void CapturedFrame_Dispose_CanBeCalledMultipleTimes()
    {
        var frame = new CapturedFrame(0, 0, 100, 100, success: true);
        frame.Dispose();
        frame.Dispose(); // no exception
    }

    // ── Failure frame scenarios ─────────────────────────────────────

    [Fact]
    public void CapturedFrame_Timeout_HasZeroSize()
    {
        // Simulates timeout from TryCaptureFrame
        var frame = new CapturedFrame(100, 300, 0, 0, success: false, waitEndTicks: 300);
        Assert.False(frame.Success);
        Assert.Equal(0, frame.Width);
        Assert.Equal(0, frame.Height);
        Assert.Equal(300, frame.WaitEndTicks);
    }

    [Fact]
    public void CapturedFrame_DisposedSignal_HasZeroSize()
    {
        // Simulates ObjectDisposedException from TryCaptureFrame
        var frame = new CapturedFrame(100, 400, 0, 0, success: false, waitEndTicks: 400);
        Assert.False(frame.Success);
        Assert.Equal(400, frame.WaitEndTicks);
    }

    // ═══════════════════════════════════════════════════════════════
    //  WgcCaptureSource — Name property (comparable without GPU init)
    // ═══════════════════════════════════════════════════════════════

    // Note: WgcCaptureSource cannot be constructed without D3D11/WGC APIs.
    // These tests verify the Name via the ICaptureSource interface contract.
    // The actual name is "Windows Graphics Capture" (hardcoded).

    [Fact]
    public void CapturedFrame_LargeDimensions_Preserved()
    {
        var frame = new CapturedFrame(0, 0, 3840, 2160, success: true);
        Assert.Equal(3840, frame.Width);
        Assert.Equal(2160, frame.Height);
    }

    [Fact]
    public void CapturedFrame_ZeroTicks_IsValid()
    {
        var frame = new CapturedFrame(0, 0, 1920, 1080, success: true);
        Assert.Equal(0, frame.CaptureStartTicks);
        Assert.Equal(0, frame.CaptureEndTicks);
    }

    // ═══════════════════════════════════════════════════════════════
    //  CapturedFrame — timing sequence invariant
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void CapturedFrame_TimingSequence_StartLessThanWaitLessThanCopy()
    {
        // Typical timing: start < waitEnd < copyEnd
        var frame = new CapturedFrame(
            startTicks: 100,
            endTicks: 300,
            width: 1920,
            height: 1080,
            success: true,
            waitEndTicks: 200,
            copyEndTicks: 300);

        Assert.True(frame.CaptureStartTicks <= frame.WaitEndTicks);
        Assert.True(frame.WaitEndTicks <= frame.CaptureEndTicks);
    }

    [Fact]
    public void CapturedFrame_TimingSequence_AllZero_ForFailure()
    {
        var frame = new CapturedFrame(0, 0, 0, 0, success: false);
        Assert.Equal(0, frame.CaptureStartTicks);
        Assert.Equal(0, frame.CaptureEndTicks);
        Assert.Equal(0, frame.WaitEndTicks);
        Assert.Equal(0, frame.CopyEndTicks);
    }

    // ═══════════════════════════════════════════════════════════════
    //  TryExtractTextureFromNativePtr — extração de textura D3D11
    //  (seam testável do caminho WGC; o leak do GetRef()/Release é
    //  gerenciado pelo caller via try/finally — ver TryCaptureFrame)
    // ═══════════════════════════════════════════════════════════════

    private static string[] RunExtraction(IntPtr ptr)
    {
        var logs = new List<string>();
        var result = WgcCaptureSource.TryExtractTextureFromNativePtr(
            ptr,
            (source, message) => logs.Add($"{source}: {message}"));
        Assert.Null(result); // ponteiro de teste nunca produz textura válida
        return logs.ToArray();
    }

    [Fact]
    public void TryExtractTexture_NullPointer_ReturnsNull_WithoutLogging()
    {
        var logs = RunExtraction(IntPtr.Zero);
        Assert.Empty(logs);
    }

    [Fact]
    public void TryExtractTexture_UnsupportedPointer_ReturnsNull_AndLogsBothStrategiesFailed()
    {
        var logs = RunExtraction(Marshal.GetIUnknownForObject(new object()));
        Assert.NotEmpty(logs);
        Assert.Contains(logs, l => l.Contains("Ambas estratégias falharam"));
    }

    // ═══════════════════════════════════════════════════════════════
    //  CreateNullTextureFrame — frame com textura ausente é FALHA
    //  (o watchdog conta como drop real NoFrame; antes era success:true
    //   com textura nula — invisível ao watchdog, stall silencioso)
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void CreateNullTextureFrame_ReportsFailure()
    {
        var frame = WgcCaptureSource.CreateNullTextureFrame(1, 2, 1920, 1080, 3, 4);
        Assert.False(frame.Success);
        Assert.Null(frame.Texture);
        Assert.Equal(1920, frame.Width);
        Assert.Equal(1080, frame.Height);
    }

    // ═══════════════════════════════════════════════════════════════
    //  ComputeCapIntervalTicks — intervalo mínimo entre frames (cap)
    //  (seam puro: 1e7 ticks = 1s; 10_000_000L / fps)
    // ═══════════════════════════════════════════════════════════════

    [Theory]
    [InlineData(30, 333333)]
    [InlineData(60, 166666)]
    [InlineData(75, 133333)]
    [InlineData(120, 83333)]
    [InlineData(144, 69444)]
    public void ComputeCapIntervalTicks_ValidFps_ReturnsExpected(int fps, long expectedTicks)
    {
        Assert.Equal(expectedTicks, WgcCaptureSource.ComputeCapIntervalTicks(fps));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(-120)]
    public void ComputeCapIntervalTicks_ZeroOrNegative_ReturnsZero(int fps)
    {
        Assert.Equal(0, WgcCaptureSource.ComputeCapIntervalTicks(fps));
    }

    // ═══════════════════════════════════════════════════════════════
    //  ShouldAcceptFrame — fallback manual do cap (pré-24H2)
    //  (seam puro: aceita quando agora - último >= intervalo)
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void ShouldAcceptFrame_NoCap_AlwaysAccepts()
    {
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(1000, 0, capIntervalTicks: 0));
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(1000, 500, capIntervalTicks: 0));
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(1000, 999, capIntervalTicks: -1));
    }

    [Fact]
    public void ShouldAcceptFrame_WithinInterval_Rejects()
    {
        // intervalo 166666 ticks (60fps): frame 100_000 ticks após o último → rejeita
        Assert.False(WgcCaptureSource.ShouldAcceptFrame(500_000, 400_000, 166_666));
    }

    [Fact]
    public void ShouldAcceptFrame_ExactlyAtInterval_Accepts()
    {
        // agora - último == intervalo exato → aceita (boundary inclusiva)
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(566_666, 400_000, 166_666));
    }

    [Fact]
    public void ShouldAcceptFrame_AfterInterval_Accepts()
    {
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(600_000, 400_000, 166_666));
    }

    [Fact]
    public void ShouldAcceptFrame_FirstFrame_Accepts()
    {
        // último = 0 (inicial): primeiro frame sempre aceito
        Assert.True(WgcCaptureSource.ShouldAcceptFrame(100_000, 0, 166_666));
    }

    // ═══════════════════════════════════════════════════════════════
    //  ResolveCapTimestamp — o cap decide pelo timestamp de apresentação
    //  do frame (SystemRelativeTime, 100 ns), não pelo callback (rajada)
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void ResolveCapTimestamp_SystemRelativePositive_UsesIt()
    {
        Assert.Equal(1_234_567L, WgcCaptureSource.ResolveCapTimestamp(1_234_567, 9_999_999));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public void ResolveCapTimestamp_NonPositive_FallsBackToCallback(long systemRelativeTicks)
    {
        Assert.Equal(9_999_999L, WgcCaptureSource.ResolveCapTimestamp(systemRelativeTicks, 9_999_999));
    }

    [Fact]
    public void CapWithPresentationTicks_AcceptsExact60FpsSequence_EvenWhenCallbackJitters()
    {
        // Cenário real medido (2026-10-02): DWM entrega 60 fps (intervalo exato 166666),
        // mas o callback chega com jitter/rajada. Com timestamps de callback, o cap
        // rejeitava ~35% dos frames; com o timestamp de apresentação, aceita todos.
        var interval = WgcCaptureSource.ComputeCapIntervalTicks(60); // 166666

        long[] presentation = { 1_000_000, 1_166_666, 1_333_332, 1_499_998, 1_666_664 };
        long[] callback = { 1_000_000, 1_166_200, 1_333_000, 1_499_500, 1_666_664 };

        long lastPresentation = 0;
        long lastCallback = 0;
        var acceptedPresentation = 0;
        var acceptedCallback = 0;

        for (var i = 0; i < presentation.Length; i++)
        {
            var capTicks = WgcCaptureSource.ResolveCapTimestamp(presentation[i], callback[i]);
            if (WgcCaptureSource.ShouldAcceptFrame(capTicks, lastPresentation, interval))
            {
                lastPresentation = capTicks;
                acceptedPresentation++;
            }

            if (WgcCaptureSource.ShouldAcceptFrame(callback[i], lastCallback, interval))
            {
                lastCallback = callback[i];
                acceptedCallback++;
            }
        }

        Assert.Equal(presentation.Length, acceptedPresentation);
        Assert.True(acceptedCallback < presentation.Length,
            $"callback jitter deveria rejeitar (bug), mas aceitou {acceptedCallback}/{presentation.Length}");
    }

    [Fact]
    public void TryExtractTexture_UnsupportedPointer_DoesNotOverReleaseCallersPointer()
    {
        var managed = new object();
        var ptr = Marshal.GetIUnknownForObject(managed);
        try
        {
            RunExtraction(ptr);

            // Se o helper desse Release indevido no ponteiro do caller,
            // o RCW seria desconectado e o QI a seguir falharia com
            // RPC_E_DISCONNECTED (0x80010108) ou retornaria erro.
            var iidIUnknown = Guid.Parse("00000000-0000-0000-C000-000000000046");
            var hr = Marshal.QueryInterface(ptr, in iidIUnknown, out var ppv);
            try
            {
                Assert.Equal(0, hr);
            }
            finally
            {
                if (hr == 0) Marshal.Release(ppv);
            }
        }
        finally
        {
            Marshal.Release(ptr);
        }
    }

    // ═══════════════════════════════════════════════════════════════
    //  WgcCaptureSource — lifecycle (G2): o construtor NÃO exige HW
    //  (só Initialize() cria device/sessão). Cobre:
    //   - self-heal exige _session (HW) → coberto analiticamente no código;
    //     aqui fixamos a semântica do campo _capIntervalTicks.
    //   - Dispose idempotente (antes relançava ObjectDisposedException).
    //   - TryCaptureFrame pós-dispose → falha limpa.
    //   - StartFramePump sem init/dispose → exceção clara.
    // ═══════════════════════════════════════════════════════════════

    private static long ReadCapIntervalTicks(WgcCaptureSource source)
    {
        var field = typeof(WgcCaptureSource).GetField("_capIntervalTicks", BindingFlags.NonPublic | BindingFlags.Instance)!;
        return (long)field.GetValue(source)!;
    }

    [Fact]
    public void SetCaptureFrameRate_SetsCapIntervalTicks()
    {
        using var source = new WgcCaptureSource();
        source.SetCaptureFrameRate(30);
        Assert.Equal(WgcCaptureSource.ComputeCapIntervalTicks(30), ReadCapIntervalTicks(source));
    }

    [Fact]
    public void SetCaptureFrameRate_ZeroOrNegative_DisablesCap()
    {
        using var source = new WgcCaptureSource();
        source.SetCaptureFrameRate(0);
        Assert.Equal(0, ReadCapIntervalTicks(source));
        source.SetCaptureFrameRate(-1);
        Assert.Equal(0, ReadCapIntervalTicks(source));
    }

    [Fact]
    public void Dispose_IsIdempotent_SecondCallDoesNotThrow()
    {
        var source = new WgcCaptureSource();
        source.Dispose();
        source.Dispose();
    }

    [Fact]
    public void TryCaptureFrame_AfterDispose_ReturnsFailure()
    {
        var source = new WgcCaptureSource();
        source.Dispose();
        var frame = source.TryCaptureFrame(5);
        Assert.False(frame.Success);
        Assert.Equal(0, frame.Width);
        Assert.Equal(0, frame.Height);
    }

    [Fact]
    public void StartFramePump_NotInitialized_Throws()
    {
        using var source = new WgcCaptureSource();
        Assert.Throws<InvalidOperationException>(() => source.StartFramePump());
    }

    [Fact]
    public void StartFramePump_AfterDispose_ThrowsObjectDisposed()
    {
        var source = new WgcCaptureSource();
        source.Dispose();
        Assert.Throws<ObjectDisposedException>(() => source.StartFramePump());
    }

    // ═══════════════════════════════════════════════════════════════
    //  Width/Height — cache de tamanho, SEM tocar no GraphicsCaptureItem
    //  (bug de campo 2026-10-13 v2.0.9: o EngineCoordinator lê Width/Height
    //   na thread do pipe; o GraphicsCaptureItem, criado por interop na STA
    //   do pump, não é agile → .Size lança RPC_E_WRONG_THREAD. Por isso o
    //   getter não pode voltar a ler _captureItem.Size fora do pump.)
    // ═══════════════════════════════════════════════════════════════

    private static void SetInstanceField(object target, string name, object value)
    {
        var field = target.GetType().GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!;
        field.SetValue(target, value);
    }

    [Fact]
    public void WidthHeight_ReturnCachedPoolSize_WithoutTouchingCaptureItem()
    {
        using var source = new WgcCaptureSource();
        // _poolW/_poolH são fixados na STA do pump durante Initialize; aqui não
        // há Initialize (sem GPU), logo _captureItem é null e lê-lo devolveria 0.
        SetInstanceField(source, "_poolW", 1920);
        SetInstanceField(source, "_poolH", 1080);

        Assert.Equal(1920, source.Width);
        Assert.Equal(1080, source.Height);
    }

    [Fact]
    public void WidthHeight_BeforeInitialize_AreZero()
    {
        using var source = new WgcCaptureSource();
        Assert.Equal(0, source.Width);
        Assert.Equal(0, source.Height);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Latch de disponibilidade WGC por sessão (2026-10-08)
    //  IsWgcAvailableForSession gate por injecção — sem WinRT real.
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void IsWgcAvailableForSession_FirstCallEvaluatesGate()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            var called = 0;
            bool gate()
            {
                called++;
                return true;
            }

            Assert.True(WgcCaptureSource.IsWgcAvailableForSession(gate, WgcCaptureSource.IsSupportedApiBuild));
            Assert.Equal(1, called);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void IsWgcAvailableForSession_Latches_SecondCallDoesNotReEvaluateGate()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            var called = 0;
            bool gate()
            {
                called++;
                return false;
            }

            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(gate, WgcCaptureSource.IsSupportedApiBuild));
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(gate, WgcCaptureSource.IsSupportedApiBuild));
            // O latch garante que o gate (WinRT caro/real) só corre UMA vez por sessão.
            Assert.Equal(1, called);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void IsWgcAvailableForSession_WhenGateThrows_ReturnsFalseAndLatches()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            var called = 0;
            bool gate()
            {
                called++;
                throw new InvalidOperationException("serviço de captura indisponível");
            }

            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(gate, WgcCaptureSource.IsSupportedApiBuild));
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(gate, WgcCaptureSource.IsSupportedApiBuild));
            Assert.Equal(1, called);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void MarkWgcUnavailableForSession_Latches_EvenIfGateWouldReturnTrue()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            // Caminho do catch dos CreateFor*: o IsSupported devolveu true mas o
            // CreateFor* falhou com 0x80070422 — o latch tem de disparar à mesma.
            WgcCaptureSource.MarkWgcUnavailableForSession();
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(() => true, WgcCaptureSource.IsSupportedApiBuild));
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void ResetWgcAvailabilityForTests_ClearsLatch()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        WgcCaptureSource.MarkWgcUnavailableForSession();
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        Assert.True(WgcCaptureSource.IsWgcAvailableForSession(() => true, WgcCaptureSource.IsSupportedApiBuild));
        WgcCaptureSource.ResetWgcAvailabilityForTests();
    }

    [Theory]
    [InlineData(unchecked((int)0x80070422), true)] // ERROR_SERVICE_DISABLED — serviço mesmo desligado
    [InlineData(unchecked((int)0x80070005), false)] // E_ACCESSDENIED — falha da JANELA, não da sessão
    [InlineData(unchecked((int)0x80070057), false)] // E_INVALIDARG — janela inválida/transitório
    public void IsSessionLevelFailure_ClassifiesByHResult(int hr, bool expected)
    {
        var ex = new COMException("falha", hr);
        Assert.Equal(expected, WgcCaptureSource.IsSessionLevelFailure(ex));
    }

    [Fact]
    public void IsSessionLevelFailure_AccessDenied_DoesNotLatchWholeSession()
    {
        // Bug latente até 2026-11-10: uma janela protegida devolvia E_ACCESSDENIED e
        // latchetava o WGC para o processo inteiro — todos os jogos caíam em DXGI até
        // reiniciar a app. Só o serviço desligado é que é falha de sessão.
        Assert.False(WgcCaptureSource.IsSessionLevelFailure(
            new COMException("janela protegida", unchecked((int)0x80070005))));
    }

    [Fact]
    public void IsSessionLevelFailure_NonComException_IsFalse()
    {
        Assert.False(WgcCaptureSource.IsSessionLevelFailure(new InvalidOperationException("qualquer")));
    }

    // ═══════════════════════════════════════════════════════════════
    //  Diagnóstico do latch (2026-11-10)
    //  O latch existia desde 2026-10-08 mas ENGOLIA a causa: o log de
    //  campo só dizia "WGC indisponível", sem HRESULT nem build do
    //  Windows. Sem isso não se distingue serviço desligado de build
    //  antigo, de driver, de sessão remota — e o lag fica sem resposta.
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void GetWgcAvailabilityDiagnostics_BeforeEvaluation_IsNotEvaluated()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();

        var diag = WgcCaptureSource.GetWgcAvailabilityDiagnostics();

        Assert.False(diag.Evaluated);
        Assert.False(diag.Available);
        Assert.Null(diag.Reason);
    }

    [Fact]
    public void IsWgcAvailableForSession_GateThrows_RecordsHresultAsReason()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(
                () => throw new COMException("serviço de captura desligado", unchecked((int)0x80070422))));

            var diag = WgcCaptureSource.GetWgcAvailabilityDiagnostics();

            Assert.True(diag.Evaluated);
            Assert.False(diag.Available);
            Assert.NotNull(diag.Reason);
            Assert.Contains("IsSupported", diag.Reason);
            Assert.Contains("0x80070422", diag.Reason);
            Assert.Contains("ERROR_SERVICE_DISABLED", diag.Reason);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void IsWgcAvailableForSession_GateReturnsFalse_RecordsCapabilityReason()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(() => false, WgcCaptureSource.IsSupportedApiBuild));

            var diag = WgcCaptureSource.GetWgcAvailabilityDiagnostics();

            Assert.Contains("IsSupported()", diag.Reason);
            Assert.Contains("false", diag.Reason);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void IsWgcAvailableForSession_Available_HasNoReason()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            Assert.True(WgcCaptureSource.IsWgcAvailableForSession(() => true, WgcCaptureSource.IsSupportedApiBuild));

            var diag = WgcCaptureSource.GetWgcAvailabilityDiagnostics();

            Assert.True(diag.Evaluated);
            Assert.True(diag.Available);
            Assert.Null(diag.Reason);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void IsWgcAvailableForSession_Latch_KeepsReasonFromFirstEvaluation()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(() => false, WgcCaptureSource.IsSupportedApiBuild));
            var first = WgcCaptureSource.GetWgcAvailabilityDiagnostics().Reason;

            // Segunda chamada não reavalia: o motivo tem de ser o mesmo, não lixo novo.
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(() => true, WgcCaptureSource.IsSupportedApiBuild));
            Assert.Equal(first, WgcCaptureSource.GetWgcAvailabilityDiagnostics().Reason);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void MarkWgcUnavailableForSession_KeepsContextAndHresult()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            // Caminho real: IsSupported()==true mas CreateForMonitor falhou com
            // ERROR_NOT_SUPPORTED — é ESTA a linha que o suporte precisa de ver.
            WgcCaptureSource.MarkWgcUnavailableForSession(
                new COMException("CreateForMonitor falhou", unchecked((int)0x80070032)),
                "CreateForMonitor");

            var diag = WgcCaptureSource.GetWgcAvailabilityDiagnostics();

            Assert.False(diag.Available);
            Assert.Contains("CreateForMonitor", diag.Reason);
            Assert.Contains("0x80070032", diag.Reason);
            Assert.Contains("ERROR_NOT_SUPPORTED", diag.Reason);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void ResetWgcAvailabilityForTests_ClearsReason()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        WgcCaptureSource.MarkWgcUnavailableForSession(new InvalidOperationException("x"), "contexto");
        Assert.NotNull(WgcCaptureSource.GetWgcAvailabilityDiagnostics().Reason);

        WgcCaptureSource.ResetWgcAvailabilityForTests();

        Assert.Null(WgcCaptureSource.GetWgcAvailabilityDiagnostics().Reason);
        Assert.False(WgcCaptureSource.GetWgcAvailabilityDiagnostics().Evaluated);
    }

    // ═══════════════════════════════════════════════════════════════
    //  Gate por build + cooldown do latch (2026-11-10)
    //  O veto antigo era GraphicsCaptureSession.IsSupported(), API que só
    //  existe a partir da 2004 (19041). Em Windows 10 1809-1909 o WGC
    //  per-window funciona e a máquina ia para DXGI para sempre.
    // ═══════════════════════════════════════════════════════════════

    [Fact]
    public void EvaluateWgcGate_BuildBelow1809_IsPermanentlyUnavailable()
    {
        var isSupportedCalled = false;

        var available = WgcCaptureSource.EvaluateWgcGate(
            WgcCaptureSource.MinimumWgcBuild - 1,
            () => { isSupportedCalled = true; return true; },
            out var reason,
            out var permanent);

        Assert.False(available);
        Assert.True(permanent);
        Assert.False(isSupportedCalled); // nem vale a pena perguntar
        Assert.Contains("17763", reason);
    }

    [Theory]
    [InlineData(17763)] // 1809 — primeiro build com WGC per-window
    [InlineData(18362)] // 1903
    [InlineData(18363)] // 1909
    public void EvaluateWgcGate_1809To1909_IsAvailableAndDoesNotCallIsSupported(int build)
    {
        var isSupportedCalled = false;

        var available = WgcCaptureSource.EvaluateWgcGate(
            build,
            () => { isSupportedCalled = true; return false; },
            out var reason,
            out var permanent);

        Assert.True(available);
        Assert.False(permanent);
        Assert.Null(reason);
        // O ponto do fix: abaixo da 2004 o método não existe no runtime — chamá-lo
        // lançava MissingMethodException e matava o WGC.
        Assert.False(isSupportedCalled);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void EvaluateWgcGate_From2004_UsesIsSupported(bool isSupported)
    {
        var available = WgcCaptureSource.EvaluateWgcGate(
            WgcCaptureSource.IsSupportedApiBuild,
            () => isSupported,
            out var reason,
            out var permanent);

        Assert.Equal(isSupported, available);
        Assert.False(permanent);
        if (isSupported)
            Assert.Null(reason);
        else
            Assert.Contains("IsSupported()", reason);
    }

    [Fact]
    public void IsWgcAvailableForSession_SessionFailure_RetriesAfterCooldown()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            var now = 1_000L;
            WgcCaptureSource.Clock = () => now;
            WgcCaptureSource.UnavailableCooldownMs = 500;

            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(
                () => false, WgcCaptureSource.IsSupportedApiBuild));
            Assert.Equal<long?>(500, WgcCaptureSource.GetWgcAvailabilityDiagnostics().RetryInMs);

            var calls = 0;
            now += 499;
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(
                () => { calls++; return true; }, WgcCaptureSource.IsSupportedApiBuild));
            Assert.Equal(0, calls); // dentro do cooldown nem se tenta

            now += 1;
            Assert.True(WgcCaptureSource.IsWgcAvailableForSession(
                () => { calls++; return true; }, WgcCaptureSource.IsSupportedApiBuild));
            Assert.Equal(1, calls);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void IsWgcAvailableForSession_BuildTooOld_IsNeverRetried()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            var now = 0L;
            WgcCaptureSource.Clock = () => now;
            WgcCaptureSource.UnavailableCooldownMs = 1;

            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(
                () => true, WgcCaptureSource.MinimumWgcBuild - 1));

            now += 1_000_000;
            Assert.False(WgcCaptureSource.IsWgcAvailableForSession(
                () => true, WgcCaptureSource.MinimumWgcBuild - 1));

            var diag = WgcCaptureSource.GetWgcAvailabilityDiagnostics();
            Assert.Contains("17763", diag.Reason);
            Assert.Null(diag.RetryInMs); // permanente: sem nova tentativa
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void MarkWgcUnavailableForSession_IsRetryableByDefault()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            WgcCaptureSource.UnavailableCooldownMs = 7_000;
            WgcCaptureSource.Clock = () => 42_000L;

            WgcCaptureSource.MarkWgcUnavailableForSession(
                new COMException("serviço desligado", unchecked((int)0x80070422)),
                "CreateForMonitor");

            Assert.Equal<long?>(7_000, WgcCaptureSource.GetWgcAvailabilityDiagnostics().RetryInMs);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }

    [Fact]
    public void MarkWgcUnavailableForSession_Permanent_HasNoRetry()
    {
        WgcCaptureSource.ResetWgcAvailabilityForTests();
        try
        {
            WgcCaptureSource.MarkWgcUnavailableForSession(permanent: true);

            Assert.Null(WgcCaptureSource.GetWgcAvailabilityDiagnostics().RetryInMs);
        }
        finally { WgcCaptureSource.ResetWgcAvailabilityForTests(); }
    }
}
