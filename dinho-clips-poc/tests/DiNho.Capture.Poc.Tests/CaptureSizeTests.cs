using System.Reflection;

namespace DiNho.Capture.Poc.Tests;

public sealed class CaptureSizeTests
{
    private static readonly MethodInfo IsDegenerate = typeof(EngineCoordinator)
        .GetMethod("IsDegenerateCaptureSize", BindingFlags.Static | BindingFlags.NonPublic)
        ?? throw new InvalidOperationException("IsDegenerateCaptureSize not found");

    private static bool Call(int w, int h) => (bool)IsDegenerate.Invoke(null, [w, h])!;

    [Fact]
    public void IsDegenerateCaptureSize_FullHd_IsNotDegenerate()
    {
        Assert.False(Call(1920, 1080));
        Assert.False(Call(2560, 1440));
        Assert.False(Call(1280, 720));
    }

    [Fact]
    public void IsDegenerateCaptureSize_ExactlyAtFloor_IsNotDegenerate()
    {
        Assert.False(Call(320, 240));
        Assert.False(Call(321, 241));
    }

    [Fact]
    public void IsDegenerateCaptureSize_MedalWindowHeight_IsDegenerate()
    {
        // Incidente 2026-09-28: a janela do Medal reportou 1920x240 no item,
        // com a textura WGC REAL em 1920x40 (altura < floor). O Math.Max(_,240)
        // mascara a degradação e o encoder inicializa com o tamanho errado.
        Assert.True(Call(1920, 40));
        Assert.True(Call(1920, 0));
    }

    [Fact]
    public void IsDegenerateCaptureSize_SubFloorWidth_IsDegenerate()
    {
        Assert.True(Call(0, 1080));
        Assert.True(Call(100, 1080));
        Assert.True(Call(319, 240));
    }
}