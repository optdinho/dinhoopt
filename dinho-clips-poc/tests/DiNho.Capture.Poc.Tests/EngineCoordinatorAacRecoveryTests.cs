using DiNho.Capture.Poc;
using Xunit;

namespace DiNho.Capture.Poc.Tests;

/// <summary>
/// Auto-recovery do encoder AAC (2026-09-29). Incidente real: um stall transitório
/// de ~2-5s (GPU overload / device busy) matou o ffmpeg AAC (`PCM write TIMEOUT`);
/// as 3 tentativas de recovery executaram TODAS dentro do stall e falharam; depois a
/// captura de áudio ficou MUDÍSSIMA pelo resto da sessão (3+ horas), com o DriftMonitor
/// acusando drift crescente porque o anel de áudio nunca mais recebeu pacotes.
///
/// A correção: as 3 primeiras tentativas continuam imediatas (stall é tipicamente o
/// estado atual), mas DEPOIS delas o recovery não desiste — vira retry throttled a cada
/// <see cref="EngineCoordinator"/>.AacRecoveryRetryInterval, de forma que um wedge que
/// termina em segundos NÃO silencia o áudio até o fim da sessão. A taxa de 1 tentativa
/// por intervalo evita restart-loop de processo quando a causa persiste.
/// </summary>
public class EngineCoordinatorAacRecoveryTests
{
    [Theory]
    [InlineData(0)]
    [InlineData(1)]
    [InlineData(2)]
    public void JanelaRapida_TentaImediato_AteAtingirCap(int attempts)
    {
        // Stall aconteceu AGORA (sinceLast = 0). As primeiras tentativas devem ser
        // imediatas — o encoder novo só precisa de aquecimento, não de espera.
        Assert.True(EngineCoordinator.ShouldAttemptAacRecovery(
            attempts, sinceLastAttempt: TimeSpan.Zero, EngineCoordinator.AacRecoveryRetryInterval));
    }

    [Fact]
    public void CapAtingido_TempoNaoDecorrido_NaoTenta()
    {
        // Esgotou a janela rápida e o stall ainda está em andamento: throttling.
        Assert.False(EngineCoordinator.ShouldAttemptAacRecovery(
            3, sinceLastAttempt: TimeSpan.FromSeconds(5), EngineCoordinator.AacRecoveryRetryInterval));
    }

    [Fact]
    public void CapAtingido_IntervaloDecorrido_TentaDeNovo()
    {
        // O stall terminou (passou o intervalo) — o encoder recriado TEM chance real
        // de escrever. É exatamente o caso "falha transitória não silencia pra sempre".
        Assert.True(EngineCoordinator.ShouldAttemptAacRecovery(
            3, sinceLastAttempt: EngineCoordinator.AacRecoveryRetryInterval, EngineCoordinator.AacRecoveryRetryInterval));
    }

    [Fact]
    public void MuitasTentativas_IntervaloDecorrido_NuncaDesisteEmDefinitivo()
    {
        // Mesmo com 10 tentativas acumuladas, decorrido o intervalo uma nova chance
        // existe. O bug de 2026-09-29 era o abandono PERMANENTE após a 3ª.
        Assert.True(EngineCoordinator.ShouldAttemptAacRecovery(
            10, sinceLastAttempt: EngineCoordinator.AacRecoveryRetryInterval * 2, EngineCoordinator.AacRecoveryRetryInterval));
    }

    [Fact]
    public void MuitasTentativas_SemTempo_NaoTenta()
    {
        // Causa raiz persiste (stall contínuo) — não permitir spawn de ffmpeg a cada
        // batch de PCM (seria restart-loop). Taxa máxima = 1 tentativa/intervalo.
        Assert.False(EngineCoordinator.ShouldAttemptAacRecovery(
            42, sinceLastAttempt: TimeSpan.FromMilliseconds(100), EngineCoordinator.AacRecoveryRetryInterval));
    }

    [Fact]
    public void IntervaloEJaLimiarSuperior_DecidePorFronteira()
    {
        // sinceLast == exatamente o intervalo → tenta (>=, não >).
        Assert.True(EngineCoordinator.ShouldAttemptAacRecovery(
            3, sinceLastAttempt: EngineCoordinator.AacRecoveryRetryInterval, EngineCoordinator.AacRecoveryRetryInterval));
        // um tick abaixo do intervalo → ainda dentro da janela de backoff. A função
        // compara por ticks, então um nanossegundo a menos NÃO tenta.
        Assert.False(EngineCoordinator.ShouldAttemptAacRecovery(
            3,
            sinceLastAttempt: EngineCoordinator.AacRecoveryRetryInterval - TimeSpan.FromTicks(1),
            EngineCoordinator.AacRecoveryRetryInterval));
    }
}