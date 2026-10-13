using System.Text.RegularExpressions;
using DiNho.Capture.Poc;

namespace DiNho.Capture.Poc.Tests;

public sealed class EngineCoordinatorScreenshotTests
{
    [Fact]
    public void BuildScreenshotFileName_FormatsTimestamp()
    {
        var name = EngineCoordinator.BuildScreenshotFileName(new DateTime(2026, 10, 11, 13, 5, 9, 42));
        Assert.Equal("screenshot-20261011-130509-042.png", name);
    }

    [Fact]
    public void BuildScreenshotFileName_IsSortablePattern()
    {
        var name = EngineCoordinator.BuildScreenshotFileName(DateTime.Now);
        Assert.Matches(new Regex(@"^screenshot-\d{8}-\d{6}-\d{3}\.png$"), name);
    }

    [Fact]
    public void BuildScreenshotFfmpegArgs_EncodesRawBgraToPng()
    {
        var args = EngineCoordinator.BuildScreenshotFfmpegArgs(1920, 1080, @"C:\out\shot.png");
        Assert.Contains("-f rawvideo", args);
        Assert.Contains("-pix_fmt bgra", args);
        Assert.Contains("-s 1920x1080", args);
        Assert.Contains("-i pipe:0", args);
        Assert.Contains("-frames:v 1", args);
        Assert.Contains("\"C:\\out\\shot.png\"", args);
    }

    [Fact]
    public void PackBgraRows_RemovesRowPadding()
    {
        int width = 2, height = 2, stride = width * 4, rowPitch = stride + 4;
        var source = new byte[rowPitch * height];
        for (int i = 0; i < source.Length; i++) source[i] = (byte)i;

        var packed = EngineCoordinator.PackBgraRows(source, rowPitch, width, height);

        Assert.Equal(stride * height, packed.Length);
        for (int y = 0; y < height; y++)
            for (int x = 0; x < stride; x++)
                Assert.Equal(source[y * rowPitch + x], packed[y * stride + x]);
    }

    [Fact]
    public void PackBgraRows_TightPitch_ReturnsSameBytes()
    {
        int width = 4, height = 3, stride = width * 4;
        var source = new byte[stride * height];
        for (int i = 0; i < source.Length; i++) source[i] = (byte)(i * 7);

        var packed = EngineCoordinator.PackBgraRows(source, stride, width, height);

        Assert.Equal(source, packed);
    }
}
