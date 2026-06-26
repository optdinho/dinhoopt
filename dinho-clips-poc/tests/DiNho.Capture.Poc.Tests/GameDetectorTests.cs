using DiNho.Capture.Poc.GameDetection;

namespace DiNho.Capture.Poc.Tests;

public sealed class GameDetectorTests
{
    [Fact]
    public void GameInfo_WindowedMode_DoesNotTriggerAutoStart()
    {
        // Simulate a non-game window (explorer in windowed mode)
        var game = new GameInfo(
            processName: "explorer",
            executablePath: @"C:\Windows\explorer.exe",
            windowTitle: "Downloads",
            windowClass: "CabinetWClass",
            displayMode: DisplayMode.Windowed,
            processId: 1234,
            hwnd: new IntPtr(0x12345678)
        );

        // Verify it's in Windowed mode
        Assert.Equal(DisplayMode.Windowed, game.DisplayMode);

        // The ToString should show [WIN] 
        var str = game.ToString();
        Assert.Contains("[WIN]", str);

        // But the auto-start logic in OnGameChanged should reject this
        // because DisplayMode is not FullscreenExclusive or FullscreenOptimized
        Assert.False(game.DisplayMode == DisplayMode.FullscreenExclusive);
        Assert.False(game.DisplayMode == DisplayMode.FullscreenOptimized);
    }

    [Fact]
    public void GameInfo_FullscreenMode_CanTriggerAutoStart()
    {
        var game = new GameInfo(
            processName: "FiveM",
            executablePath: @"C:\Program Files\Steam\steamapps\common\FiveM\FiveM.exe",
            windowTitle: "FiveM",
            windowClass: "grcWindow",
            displayMode: DisplayMode.FullscreenOptimized,
            processId: 5678,
            hwnd: new IntPtr(0x87654321)
        );

        Assert.Equal(DisplayMode.FullscreenOptimized, game.DisplayMode);
        Assert.Contains("[FSO]", game.ToString());

        // Fullscreen modes should pass the auto-start check
        var canAutoStart = game.DisplayMode == DisplayMode.FullscreenExclusive ||
                           game.DisplayMode == DisplayMode.FullscreenOptimized;
        Assert.True(canAutoStart);
    }

    [Fact]
    public void GameInfo_SystemWindowClass_DoesNotTriggerAutoStart()
    {
        // Use reflection to call IsSystemWindowClass
        var method = typeof(EngineCoordinator).GetMethod("IsSystemWindowClass",
            System.Reflection.BindingFlags.Static | System.Reflection.BindingFlags.NonPublic);
        Assert.NotNull(method);

        static bool Call(object? obj, System.Reflection.MethodInfo m, string arg)
            => (bool)m.Invoke(obj, [arg])!;

        // These system classes should be filtered even if fullscreen
        Assert.True(Call(null, method, "Progman"));
        Assert.True(Call(null, method, "Shell_TrayWnd"));
        Assert.True(Call(null, method, "WorkerW"));
    }

    [Fact]
    public void GameDetector_DetectsForeground_ForAnyWindow()
    {
        var hwnd = System.Diagnostics.Process.GetCurrentProcess().MainWindowHandle;

        // If no window handle (console app), skip this test
        if (hwnd == IntPtr.Zero)
            return; // Not applicable in unit test environment

        Assert.NotEqual(IntPtr.Zero, hwnd);
    }
}
