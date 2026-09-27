using System.Diagnostics;
using System.Reflection;
using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

[Collection("FfmpegCodecCache")]
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

    /// <summary>
    /// O degrau 1/2 → 1/4 em 1080p e' <b>inutil</b>: o piso absoluto 1280x720 (Item 1) faz os
    /// dois divisores produzirem a MESMA resolucao. Sem esta trava o guard reiniciava o
    /// ffmpeg (descartando o backlog de output e o estado de PTS) sem mudar um unico byte
    /// dos argumentos — e o log dizia "1/2 → 1/4" como se fosse uma mudanca real.
    /// </summary>
    [Fact]
    public void CapacityStep_QuarterAfterHalfOn1080p_ChangesNothing_SoTheGuardMustNotRestart()
    {
        Assert.False(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 1920, inputH: 1080, outW: 0, outH: 0, oldDivisor: 2, newDivisor: 4));
    }

    [Fact]
    public void CapacityStep_HalfFromFullOn1080p_ChangesResolution_SoTheGuardProceeds()
    {
        Assert.True(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 1920, inputH: 1080, outW: 0, outH: 0, oldDivisor: 1, newDivisor: 2));
    }

    [Fact]
    public void CapacityStep_BelowTheFloor_ChangesNothing()
    {
        // Captura 1280x720: o piso efetivo e' a propria entrada, entao o divisor nao tem
        // para onde ir e qualquer degrau e' inutil.
        Assert.False(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 1280, inputH: 720, outW: 0, outH: 0, oldDivisor: 1, newDivisor: 2));
    }

    [Fact]
    public void CapacityStep_4K_HalfChangesResolution()
    {
        Assert.True(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 3840, inputH: 2160, outW: 0, outH: 0, oldDivisor: 1, newDivisor: 2));
    }

    [Fact]
    public void CapacityStep_SameDivisor_ChangesNothing()
    {
        Assert.False(FfmpegEncoder.CapacityStepChangesResolution(
            inputW: 1920, inputH: 1080, outW: 0, outH: 0, oldDivisor: 2, newDivisor: 2));
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
        string codec, int divisor, int fallbackIndex, bool processFailed = false,
        int width = 1920, int height = 1080)
    {
        var enc = CreateEncoder();
        SetField(enc, "_initialized", true);
        SetField(enc, "_fallbackChain", Chain);
        SetField(enc, "_currentFallbackIndex", fallbackIndex);
        SetField(enc, "_scaleDivisor", divisor);
        SetField(enc, "_codec", codec);
        SetField(enc, "_processFailed", processFailed);
        // Captura real: o guard decide o degrau util comparando a resolucao ANTES e DEPOIS
        // (piso absoluto do Item 1), entao sem dims o encoder ficaria 0x0 e todo degrau seria
        // "inutil" - o que os testes antigos nao percebiam porque a resolucao nunca participou.
        SetField(enc, "_width", width);
        SetField(enc, "_height", height);
        // Sem restart real (sem ffmpeg no teste) - seam de teste retorna true.
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

    /// <summary>
    /// O caso de produção que o guard Now ignora: em 1080p, já degradado para 1/2 (720p), o
    /// próximo degrau da cadeia é 1/4 — mas o piso do Item 1 faz 1/4 produzir os mesmos
    /// 1280x720. Reiniciar ali descartaria o backlog de output e o estado de PTS sem mudar
    /// os argumentos, o log ainda por cima anunciaria "1/2 → 1/4". Antes desta trava o
    /// guard fazia exatamente esse restart inútil a cada cooldown.
    /// </summary>
    [Fact]
    public void TryDegrade_AtHalfOn1080p_SkipsTheUselessQuarterStep_AndKeepsTheState()
    {
        var enc = CreateDegradableEncoder("av1_amf", 2, 1);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(2, enc.ScaleDivisor);
        Assert.Equal("av1_amf", enc.CurrentCodec);
    }

    /// <summary>
    /// E o mesmo guard numa captura abaixo do piso: nenhum degrau muda a resolução, então
    /// reiniciar o ffmpeg nunca reduziria o backlog. Não há o que re-tentar.
    /// </summary>
    [Fact]
    public void TryDegrade_BelowFloorCapture_DoesNotRestartBecauseNoStepChangesResolution()
    {
        var enc = CreateDegradableEncoder("av1_amf", 1, 0, width: 1280, height: 720);
        FfmpegEncoder.SetLastProgressForTest(enc, 0.62, 255);

        Assert.False(enc.TryDegradeScaleForCapacity());
        Assert.Equal(1, enc.ScaleDivisor);
    }
}