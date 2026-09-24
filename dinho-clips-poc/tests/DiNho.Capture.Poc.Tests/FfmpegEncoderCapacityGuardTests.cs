using System.Diagnostics;
using System.Reflection;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

public sealed class FfmpegEncoderCapacityGuardTests
{
    // ── ShouldDegradeForCapacity (decisão pura, sem HW) ──────────────

    [Fact]
    public void ShouldDegrade_ReturnsTrue_WhenLagHighAndSpeedLow()
    {
        // Speed 0.62x + lag de ~26min (assinatura da sessão AMD real) → degradar escala.
        Assert.True(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 1564));
        Assert.True(FfmpegEncoder.ShouldDegradeForCapacity(0.5, 255));
    }

    [Fact]
    public void ShouldDegrade_ReturnsFalse_WhenLagBelowThreshold()
    {
        // Lag pequeno (preroll/arranque) — não degradar.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 10));
    }

    [Fact]
    public void ShouldDegrade_ReturnsFalse_WhenSpeedNearOrAboveOne()
    {
        // Encoder acompanhando (speed>=0.95) mesmo com lag residual — o lag vai zerar sozinho.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.95, 1564));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(1.02, 1564));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(2.5, 100));
    }

    [Fact]
    public void ShouldDegrade_ReturnsFalse_WhenSpeedInvalid()
    {
        // Sem progress ainda (speed 0) ou negativo — não degradar.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0, 1564));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(-1, 1564));
    }

    [Fact]
    public void ShouldDegrade_ReturnsFalse_WhenSpeedTooLowMachineStalled()
    {
        // speed extremamente baixo sugere stall real, não lentidão de encoder — não degradar
        // à toa (é caso para o watchdog/reinit, não para troca de escala).
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.05, 1564));
    }

    // ── NextScaleStepFor (escolha do próximo degrau, pura, sem HW) ───

    private static readonly List<EncoderManager.FallbackEntry> Chain = new()
    {
        new() { Codec = "av1_amf", Label = "HW native (av1_amf)" },
        new() { Codec = "av1_amf", ScaleDivisor = 2, Label = "HW 1/2 (av1_amf)" },
        new() { Codec = "av1_amf", ScaleDivisor = 4, Label = "HW 1/4 (av1_amf)" },
        new() { Codec = "h264_amf", Label = "HW native (h264_amf)" },
        new() { Codec = "libx264", Label = "CPU (libx264)" },
        new() { Codec = "libx264", ScaleDivisor = 2, Label = "CPU 1/2 (libx264)" },
    };

    [Fact]
    public void NextScaleStep_ReturnsSameCodecNextDivisor()
    {
        var next = FfmpegEncoder.NextScaleStepFor(Chain, "av1_amf", 1);
        Assert.NotNull(next);
        Assert.Equal("av1_amf", next!.Codec);
        Assert.Equal(2, next.ScaleDivisor);
    }

    [Fact]
    public void NextScaleStep_FromHalf_ReturnsQuarter()
    {
        var next = FfmpegEncoder.NextScaleStepFor(Chain, "av1_amf", 2);
        Assert.NotNull(next);
        Assert.Equal(4, next!.ScaleDivisor);
    }

    [Fact]
    public void NextScaleStep_ReturnsNull_WhenAtMaxDivisor()
    {
        Assert.Null(FfmpegEncoder.NextScaleStepFor(Chain, "av1_amf", 4));
    }

    [Fact]
    public void NextScaleStep_ReturnsNull_WhenCodecNotInChain()
    {
        Assert.Null(FfmpegEncoder.NextScaleStepFor(Chain, "hevc_nvenc", 1));
    }

    [Fact]
    public void NextScaleStep_ReturnsNull_ForEmptyChain()
    {
        Assert.Null(FfmpegEncoder.NextScaleStepFor([], "av1_amf", 1));
    }

    [Fact]
    public void NextScaleStep_CpuNative_StepsToCpuHalf()
    {
        // Sessão AMD: fallback já caiu em libx264 full-res com lag crescente → próximo degrau = CPU 1/2.
        var next = FfmpegEncoder.NextScaleStepFor(Chain, "libx264", 1);
        Assert.NotNull(next);
        Assert.Equal(2, next!.ScaleDivisor);
        Assert.Equal("libx264", next.Codec);
    }

    // ── TryDegradeScaleForCapacity (decisão + aplicação, sem ffmpeg) ─

    private static FfmpegEncoder CreateEncoder()
    {
        // Ctor real (só cria o _outputChannel), sem Initialize() — não spawna ffmpeg.
        // Não pode usar GetUninitializedObject: os field-initializers (ex.: _progressSync)
        // não rodam e o guard trava no lock.
        FfmpegEncoder.ResetEncoderCachesForTest();
        return new FfmpegEncoder();
    }

    private static void SetField(FfmpegEncoder encoder, string name, object? value)
    {
        var field = typeof(FfmpegEncoder).GetField(name,
            BindingFlags.NonPublic | BindingFlags.Instance);
        Assert.NotNull(field);
        field!.SetValue(encoder, value);
    }

    private static FfmpegEncoder CreateDegradableEncoder(
        string codec, int divisor, int fallbackIndex, bool processFailed = false)
    {
        var enc = CreateEncoder();
        SetField(enc, "_initialized", true);
        SetField(enc, "_fallbackChain", Chain);
        SetField(enc, "_currentFallbackIndex", fallbackIndex);
        SetField(enc, "_scaleDivisor", divisor);
        SetField(enc, "_codec", codec);
        SetField(enc, "_processFailed", processFailed);
        // Sem restart real (sem ffmpeg no teste) — seam de teste retorna true.
        SetField(enc, "_restartOverrideForCapacity", (Func<bool>)(() => true));
        return enc;
    }

    [Fact]
    public void TryDegrade_ReturnsTrue_AndAdvancesScaleDivisor()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.True(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
        Assert.Equal("av1_amf", enc.CurrentCodec);
    }

    [Fact]
    public void TryDegrade_ReturnsTrue_OnCpuFallback_RoutesToHalf()
    {
        var enc = CreateDegradableEncoder("libx264", 1, 4); // CPU (libx264) full-res
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 600);

        Assert.True(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
        Assert.Equal("libx264", enc.CurrentCodec);
    }

    [Fact]
    public void TryDegrade_ReturnsFalse_WhenProcessFailed()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, processFailed: true);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        // Processo em falha já está no caminho de restart do watchdog — guard não interfere.
        Assert.False(enc.TryDegradeScaleForCapacity());
    }

    [Fact]
    public void TryDegrade_ReturnsFalse_WhenScaleAlreadyAtMax()
    {
        var enc = CreateDegradableEncoder("av1_amf", 4, 2);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 1000);

        Assert.False(enc.TryDegradeScaleForCapacity());
    }

    [Fact]
    public void TryDegrade_ReturnsFalse_WhenRecentlyDegraded()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);
        // Degradação recente (há <60s) — cooldown impede restart-loop.
        SetField(enc, "_lastCapacityDegradeTicks",
            Stopwatch.GetTimestamp() - (long)(30 * Stopwatch.Frequency));

        Assert.False(enc.TryDegradeScaleForCapacity());
    }

    [Fact]
    public void TryDegrade_WhenRestartFails_ReturnsFalseButAppliesState()
    {
        // O guard aplica a degradação (escala) ANTES do restart; se o restart real falhar,
        // o retorno é false mas o estado avançou (próxima chamada continuaria com 1/2).
        var enc = CreateDegradableEncoder("av1_amf", 1, 0);
        SetField(enc, "_restartOverrideForCapacity", (Func<bool>)(() => false));
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
    }
}