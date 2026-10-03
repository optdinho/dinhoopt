using Xunit;

namespace DiNho.Capture.Poc.Tests;

// Janela de aquecimento: rebaixa os transientes de cold-start (drop/overflow/AAC) para
// Debug [startup] nos primeiros 2 s; fora dela, os mesmos eventos voltam a ser WARN.
public sealed class StartupWarmupTests
{
    [Theory]
    [InlineData(0, true)]
    [InlineData(1, true)]
    [InlineData(1999, true)]
    [InlineData(2000, false)]
    [InlineData(5000, false)]
    public void IsWarmup_DentroDaCarencia(int ms, bool expected)
        => Assert.Equal(expected, StartupWarmup.IsWarmup(TimeSpan.FromMilliseconds(ms)));

    [Fact]
    public void IsWarmup_ElapsedNegativo_NaoEhWarmup()
        => Assert.False(StartupWarmup.IsWarmup(TimeSpan.FromMilliseconds(-1)));

    [Fact]
    public void GraceMs_DoisSegundos()
        => Assert.Equal(2000, StartupWarmup.GraceMs);
}
