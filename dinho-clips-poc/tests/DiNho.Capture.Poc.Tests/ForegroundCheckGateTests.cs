namespace DiNho.Capture.Poc.Tests;

// Item 2 do Tier 1: tirar as checagens de foreground/alvo do hot loop (rodavam por
// frame, a 60Hz) com debounce, sem mudar a semântica de supressão de alt-tab de
// 2026-09-28. Estes testes fixam as duas metades puras: a decisão e o gate de tempo.
public sealed class ForegroundCheckGateTests
{
    // ── ShouldRefreshForegroundChecks ───────────────────────────────

    [Fact]
    public void Refresh_NuncaAvaliado_RetornaTrue()
    {
        Assert.True(EngineCoordinator.ShouldRefreshForegroundChecks(nowTicks: 5_000_000, lastTicks: 0, intervalTicks: 2_500_000));
    }

    [Fact]
    public void Refresh_DentroDoIntervalo_RetornaFalse()
    {
        // 2.5M ticks (250ms @ 10MHz) de intervalo; decorreu 1M → não reavalia.
        Assert.False(EngineCoordinator.ShouldRefreshForegroundChecks(nowTicks: 2_000_000, lastTicks: 1_000_000, intervalTicks: 2_500_000));
    }

    [Fact]
    public void Refresh_NoLimiteExato_RetornaTrue()
    {
        Assert.True(EngineCoordinator.ShouldRefreshForegroundChecks(nowTicks: 3_500_000, lastTicks: 1_000_000, intervalTicks: 2_500_000));
    }

    [Fact]
    public void Refresh_AcimaDoIntervalo_RetornaTrue()
    {
        Assert.True(EngineCoordinator.ShouldRefreshForegroundChecks(nowTicks: 9_000_000, lastTicks: 1_000_000, intervalTicks: 2_500_000));
    }

    // ── ShouldSuppressAsBackground ──────────────────────────────────

    // Cláusula 1: WGC + alvo jogo conhecido + vivo + NÃO em foreground = alt-tab real.
    [Fact]
    public void Suppress_WgcJogoConhecidoVivoForaDoForeground_True()
    {
        Assert.True(EngineCoordinator.ShouldSuppressAsBackground(
            isWgc: true, targetIsKnownGame: true, targetAlive: true, targetForeground: false,
            fgIsNonGame: false, targetValid: true));
    }

    // Mesma situação, mas o alvo ESTÁ em foreground → stall, não alt-tab: não suprime.
    [Fact]
    public void Suppress_WgcJogoConhecidoEmForeground_False()
    {
        Assert.False(EngineCoordinator.ShouldSuppressAsBackground(
            isWgc: true, targetIsKnownGame: true, targetAlive: true, targetForeground: true,
            fgIsNonGame: false, targetValid: true));
    }

    // Alvo morto: não é alt-tab — o ramo de escalação precisa poder reiniciar.
    [Fact]
    public void Suppress_AlvoMorto_NaoSuprime()
    {
        Assert.False(EngineCoordinator.ShouldSuppressAsBackground(
            isWgc: true, targetIsKnownGame: true, targetAlive: false, targetForeground: false,
            fgIsNonGame: false, targetValid: true));
    }

    // Cláusula 2: foreground não-jogo e alvo inválido = pipeline preso no alvo errado.
    [Fact]
    public void Suppress_ForegroundNaoJogoAlvoInvalido_True()
    {
        Assert.True(EngineCoordinator.ShouldSuppressAsBackground(
            isWgc: false, targetIsKnownGame: false, targetAlive: false, targetForeground: false,
            fgIsNonGame: true, targetValid: false));
    }

    // Cláusula 3: foreground não-jogo com alvo = jogo conhecido = usuário fora do jogo.
    [Fact]
    public void Suppress_ForegroundNaoJogoComAlvoJogo_True()
    {
        Assert.True(EngineCoordinator.ShouldSuppressAsBackground(
            isWgc: false, targetIsKnownGame: true, targetAlive: false, targetForeground: false,
            fgIsNonGame: true, targetValid: true));
    }

    // Foreground não-jogo, alvo válido mas NÃO-jogo (Medal): cláusula 2 e 3 não pegam.
    // Esse é EXATAMENTE o incidente 2026-09-28 — tinha que poder reiniciar, não suprimir.
    [Fact]
    public void Suppress_ForegroundNaoJogoComAlvoNaoJogoValido_NaoSuprime()
    {
        Assert.False(EngineCoordinator.ShouldSuppressAsBackground(
            isWgc: false, targetIsKnownGame: false, targetAlive: false, targetForeground: false,
            fgIsNonGame: true, targetValid: true));
    }

    // Backend não-WGC (DXGI/hybrid): a cláusula 1 não se aplica.
    [Fact]
    public void Suppress_BackendNaoWgc_NaoUsaClausula1()
    {
        Assert.False(EngineCoordinator.ShouldSuppressAsBackground(
            isWgc: false, targetIsKnownGame: true, targetAlive: true, targetForeground: false,
            fgIsNonGame: false, targetValid: true));
    }
}
