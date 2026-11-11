using DiNho.Capture.Poc.Config;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Classificação do que uma alteração de config exige do pipeline EM CURSO
/// (2026-11-10). Qualidade/fps podem ser reaplicados reiniciando só o encoder;
/// resolução/codec não — o buffer de replay passaria a ter pacotes de dois formatos
/// e o save usa <c>-c:v copy</c>.
/// </summary>
public sealed class PipelineConfigSnapshotTests
{
    private static AppConfig Baseline() => new()
    {
        Fps = 60,
        Width = 1920,
        Height = 1080,
        Cq = 20,
        MaxrateKbps = 20000,
        BufsizeKbps = 40000,
        Bframes = 2,
        Lookahead = 4,
        EncoderPreset = "p5",
        Codec = "auto",
        ForceSoftware = false,
        Multipass = false,
        AmfUsage = "balanced",
        StretchToFit = false,
        AdaptiveQualityEnabled = false,
    };

    private static PipelineConfigSnapshot From(AppConfig config) => PipelineConfigSnapshot.From(config);

    // ── From ───────────────────────────────────────────────────────

    [Fact]
    public void From_MapsTheFieldsThePipelineReadsAtStart()
    {
        var snap = From(Baseline());

        Assert.Equal(60, snap.Fps);
        Assert.Equal(1920, snap.Width);
        Assert.Equal(1080, snap.Height);
        Assert.Equal(20, snap.Cq);
        Assert.Equal(20000, snap.MaxrateKbps);
        Assert.Equal(40000, snap.BufsizeKbps);
        Assert.Equal(2, snap.Bframes);
        Assert.Equal(4, snap.Lookahead);
        Assert.Equal("p5", snap.EncoderPreset);
        Assert.Equal("auto", snap.Codec);
        Assert.False(snap.ForceSoftware);
        Assert.False(snap.Multipass);
        Assert.Equal("balanced", snap.AmfUsage);
        Assert.False(snap.StretchToFit);
        Assert.False(snap.AdaptiveQualityEnabled);
    }

    [Fact]
    public void From_NullStrings_DoNotThrow()
    {
        var config = Baseline();
        config.EncoderPreset = null!;
        config.Codec = null!;
        config.AmfUsage = null!;

        var snap = From(config);

        Assert.Equal("", snap.EncoderPreset);
        Assert.Equal("", snap.Codec);
        Assert.Equal("", snap.AmfUsage);
    }

    // ── DiffTo: nada mudou ─────────────────────────────────────────

    [Fact]
    public void DiffTo_Identical_IsEmptyAndNeedsNoRestart()
    {
        var change = From(Baseline()).DiffTo(From(Baseline()));

        Assert.True(change.IsEmpty);
        Assert.False(change.NeedsEncoderRestart);
        Assert.Equal("nenhuma alteração de pipeline", change.ToString());
    }

    // ── DiffTo: qualidade (aplica a quente) ────────────────────────

    public static TheoryData<string, Action<AppConfig>> QualityFields => new()
    {
        { "Cq", c => c.Cq = 16 },
        { "MaxrateKbps", c => c.MaxrateKbps = 30000 },
        { "BufsizeKbps", c => c.BufsizeKbps = 60000 },
        { "Bframes", c => c.Bframes = 0 },
        { "Lookahead", c => c.Lookahead = 16 },
        { "Multipass", c => c.Multipass = true },
        { "StretchToFit", c => c.StretchToFit = true },
        { "EncoderPreset", c => c.EncoderPreset = "p7" },
        { "AmfUsage", c => c.AmfUsage = "speed" },
    };

    [Theory]
    [MemberData(nameof(QualityFields))]
    public void DiffTo_QualityField_NeedsOnlyAnEncoderRestart(string field, Action<AppConfig> mutate)
    {
        var next = Baseline();
        mutate(next);

        var change = From(Baseline()).DiffTo(From(next));

        Assert.True(change.EncoderParams, $"{field} devia ser reaplicável a quente");
        Assert.False(change.FrameRate);
        Assert.False(change.OutputFormat);
        Assert.True(change.NeedsEncoderRestart);
    }

    // ── DiffTo: fps (aplica a quente) ──────────────────────────────

    [Fact]
    public void DiffTo_FpsChange_IsFrameRateOnly()
    {
        var next = Baseline();
        next.Fps = 30;

        var change = From(Baseline()).DiffTo(From(next));

        Assert.False(change.EncoderParams);
        Assert.True(change.FrameRate);
        Assert.False(change.OutputFormat);
        Assert.True(change.NeedsEncoderRestart);
        Assert.Equal("fps", change.ToString());
    }

    // ── DiffTo: formato de saída (fica para o próximo arranque) ────

    public static TheoryData<string, Action<AppConfig>> OutputFormatFields => new()
    {
        { "Width", c => c.Width = 1280 },
        { "Height", c => c.Height = 720 },
        { "Codec", c => c.Codec = "hevc" },
        { "ForceSoftware", c => c.ForceSoftware = true },
        // Pode impor cap de resolução via perfil de RAM — a resolução é invariante.
        { "AdaptiveQualityEnabled", c => c.AdaptiveQualityEnabled = true },
    };

    [Theory]
    [MemberData(nameof(OutputFormatFields))]
    public void DiffTo_OutputFormatField_DoesNotRestartTheEncoderNow(string field, Action<AppConfig> mutate)
    {
        var next = Baseline();
        mutate(next);

        var change = From(Baseline()).DiffTo(From(next));

        Assert.False(change.EncoderParams, $"{field} não é qualidade");
        Assert.False(change.FrameRate);
        Assert.True(change.OutputFormat, $"{field} devia ficar para o próximo arranque");
        Assert.False(change.NeedsEncoderRestart);
    }

    [Fact]
    public void DiffTo_MixedChange_ReportsBothBuckets()
    {
        var next = Baseline();
        next.Cq = 16;
        next.Fps = 30;
        next.Width = 1280;
        next.Height = 720;

        var change = From(Baseline()).DiffTo(From(next));

        Assert.True(change.EncoderParams);
        Assert.True(change.FrameRate);
        Assert.True(change.OutputFormat);
        Assert.True(change.NeedsEncoderRestart);
        Assert.Equal("qualidade, fps, resolução/codec", change.ToString());
    }

    // ── KeepOutputFormatOf ────────────────────────────────────────

    [Fact]
    public void KeepOutputFormatOf_AdoptsQualityButKeepsTheFormatInUse()
    {
        var applied = From(Baseline());

        var next = Baseline();
        next.Cq = 16;
        next.Fps = 30;
        next.Width = 1280;
        next.Height = 720;
        next.Codec = "hevc";
        next.ForceSoftware = true;
        next.AdaptiveQualityEnabled = true;

        var kept = From(next).KeepOutputFormatOf(applied);

        // Qualidade/fps novos entram…
        Assert.Equal(16, kept.Cq);
        Assert.Equal(30, kept.Fps);
        // …e o formato continua o que está mesmo em uso, logo a alteração
        // pendente volta a aparecer no próximo diff (não é marcada como aplicada).
        Assert.Equal(1920, kept.Width);
        Assert.Equal(1080, kept.Height);
        Assert.Equal("auto", kept.Codec);
        Assert.False(kept.ForceSoftware);
        Assert.False(kept.AdaptiveQualityEnabled);
        Assert.True(kept.DiffTo(From(next)).OutputFormat);
    }

    [Fact]
    public void KeepOutputFormatOf_WhenOnlyFormatChanged_LeavesEverythingPending()
    {
        var applied = From(Baseline());

        var next = Baseline();
        next.Width = 1280;
        next.Height = 720;

        var kept = From(next).KeepOutputFormatOf(applied);

        Assert.True(kept.DiffTo(From(next)).OutputFormat);
        Assert.False(kept.DiffTo(From(next)).NeedsEncoderRestart);
    }
}
