using DiNho.Capture.Poc.Encoders;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// T4 — o capacity guard degradava a escala por um gargalo que não era do encoder.
///
/// Incidente 2026-10-01: o feed entrega ~39-42 fps (o gargalo é a cadência de
/// entrega do WGC sob carga, confirmado por <c>wait</c> ~9-10 ms e
/// <c>queue</c> ≈ 0). O ffmpeg, com <c>-r 60</c>, via <c>time</c> de saída
/// atrasado em relação ao <c>elapsed</c> — <c>outputLagSeconds</c> cresce sem
/// limite e chega a valores absurdos (5936 s = 99 min numa sessão de 10,5 h).
///
/// O guard comparava esse lag contra 30 s e degradava a escala (1/1 → 1/2 →
/// 1/4). Mas se o FEED é que está devagar, reduzir a resolução do encoder não
/// aumenta o número de frames entregues: só piora a qualidade sem recuperar
/// o fps. A degradação só faz sentido quando o encoder é o gargalo — e isso é
/// medido pelo lag do FEED, não pelo <c>time</c> do ffmpeg.
///
/// Referência: <c>FeedTelemetry</c> já loga o breakdown por estágio
/// (<c>wait</c>/<c>copy</c>/<c>convert</c>) — <c>wait</c> alto com <c>queue</c>
/// zero significa que o encoder NUNCA engasgou.
/// </summary>
public sealed class CapacityGuardFeedLagTests
{
    // ── O que é lag de feed vs lag de saída ─────────────────────────────

    [Fact]
    public void FeedSlowerThanNominal_HasLargeFeedLag()
    {
        // Feed a 40 fps com alvo de 60: a cada segundo de wall clock o feed
        // entrega 40 frames de 1/60 s = 0,667 s de mídia. Déficit de 0,333 s/s.
        var feedLag = CapacityGuardMath.FeedLagSeconds(feedFps: 40, nominalFps: 60);
        Assert.True(feedLag > 0);
        Assert.Equal(0.3333, feedLag, precision: 3);
    }

    [Fact]
    public void FeedAtNominal_HasZeroFeedLag()
    {
        Assert.Equal(0, CapacityGuardMath.FeedLagSeconds(60, 60), precision: 6);
    }

    [Fact]
    public void FeedAboveNominal_HasNoLag()
    {
        // Feed acima do nominal não gera déficit — não há o que recuperar.
        Assert.Equal(0, CapacityGuardMath.FeedLagSeconds(90, 60), precision: 6);
    }

    [Fact]
    public void FeedAtZero_HasNoLag()
    {
        // Sem medição de feed (telemetria desligada) não inventa déficit.
        Assert.Equal(0, CapacityGuardMath.FeedLagSeconds(0, 60), precision: 6);
    }

    [Fact]
    public void NominalFpsNonPositive_HasNoLag()
    {
        // Sem alvo conhecido não dá para dizer que o feed está atrasado.
        Assert.Equal(0, CapacityGuardMath.FeedLagSeconds(40, 0), precision: 6);
    }

    [Fact]
    public void FeedLag_GrowsAsFeedSlows()
    {
        var fast = CapacityGuardMath.FeedLagSeconds(55, 60);
        var slow = CapacityGuardMath.FeedLagSeconds(40, 60);
        Assert.True(slow > fast);
    }

    // ── A decisão: só degrada se o ENCODER for o gargalo ────────────────

    [Fact]
    public void SlowFeed_LargeOutputLag_DoesNotDegrade()
    {
        // O caso de 2026-10-01: saída muito atrasada, mas o feed é que não entrega.
        // Degradar a escala aqui só pioraria a imagem sem recuperar nada.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(
            speedX: 0.92,
            outputLagSeconds: 5936,
            CapacityGuardMath.ClassifyFeed(40, 60)));
    }

    [Fact]
    public void FeedAtNominal_EncoderSlow_Degrades()
    {
        // Feed ok E encoder lento de verdade: aqui a degradação ajuda.
        Assert.True(FfmpegEncoder.ShouldDegradeForCapacity(
            speedX: 0.62,
            outputLagSeconds: 255,
            CapacityGuardMath.ClassifyFeed(60, 60)));
    }

    /// <summary>
    /// Inversão deliberada do teste <c>SlowFeed_ButEncoderBehindToo_Degrades</c> que existia
    /// antes. A versão antiga afirmava que, com feed a 42 fps E encoder a 0,30x, o encoder
    /// ainda seria "o gargalo relativo" e a degradação deveria agir.
    ///
    /// <para>
    /// Isso não é mensurável com estes sinais. Com <c>-r 60</c> e feed abaixo do nominal,
    /// o <c>speed</c> do ffmpeg é contaminado pelo próprio feed: um encoder INSTANTÂNEO a
    /// 39 fps reporta <c>speed≈0,65x</c>, e o <c>outputLag</c> cresce por relógio, não por
    /// lentidão. Ou seja, <c>speed</c> e <c>outputLag</c> ficam indistinguíveis entre
    /// "encoder lento" e "feed lento" — justamente a condição que o guard precisa separar.
    /// </para>
    /// <para>
    /// Sem feed no alvo não há como provar que o encoder seja o gargalo, e o preço de errar
    /// é restart do ffmpeg + 720p pelo resto da sessão. O guard segura.
    /// </para>
    /// </summary>
    [Fact]
    public void SlowFeed_CannotProveEncoderIsBehind_SoNoDegrade()
    {
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(
            speedX: 0.30,
            outputLagSeconds: 900,
            CapacityGuardMath.ClassifyFeed(42, 60)));
    }

    [Fact]
    public void EncoderStalled_StillDoesNotDegrade()
    {
        // speedX < min é STALL, não lentidão. O watchdog/reinit trata — o guard de
        // capacidade não deve mascarar um stall com degradação de escala.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.05, 500, FeedState.Healthy));
    }

    [Fact]
    public void EncoderKeepingUp_DoesNotDegrade()
    {
        // speedX >= max: o encoder acompanha e o lag drena sozinho.
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.99, 500, FeedState.Healthy));
    }

    [Fact]
    public void LowOutputLag_DoesNotDegrade()
    {
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.50, 10, FeedState.Healthy));
    }

    /// <summary>
    /// Inversão deliberada de <c>UnknownBottleneck_KeepsLegacyBehaviour</c>.
    ///
    /// <para>
    /// A versão antiga afirmava que, sem telemetria de feed, o guard tinha de continuar
    /// degradando "senão a proteção de 2026-09-18 morre". Não morre: em 2026-09-18 (libx264
    /// 1080p a ~0,62x com lag crescendo) o FEED estava no alvo de 60 fps — era o encoder
    /// que não acompanhava. Esse cenário medido continua degradando, coberto por
    /// <c>FeedAtNominal_EncoderSlow_Degrades</c>.
    /// </para>
    /// <para>
    /// O que se perde é só o caso sem prova. E é exatamente aí que o guard causava dano:
    /// <c>FeedFps</c> devolve 0 (sem medição) nos colapsos do WGC, e o guard lia esse 0
    /// como "sem déficit" e degradava — regressão de 2026-10-01 21:34:14.
    /// </para>
    /// </summary>
    [Fact]
    public void UnknownFeed_DoesNotDegrade_RegressionOf2026_10_01()
    {
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 255, FeedState.Unknown));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.55, 35, FeedState.Unknown));
    }

    [Fact]
    public void TwoArgOverload_IsBackwardsCompatible()
    {
        // A chamada de 2 args (usada por testes e caminhos antigos) continua
        // decidindo como antes: sem dado de feed, trata como encoder-gargalo.
        Assert.True(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 255));
        Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 5));
    }

    [Fact]
    public void Decision_IsPure()
    {
        for (var i = 0; i < 5; i++)
        {
            Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.92, 5936, FeedState.Deficient));
            Assert.False(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 255, FeedState.Unknown));
            Assert.True(FfmpegEncoder.ShouldDegradeForCapacity(0.62, 255, FeedState.Healthy));
        }
    }
}
