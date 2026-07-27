using DiNho.Capture.Poc.Logging;
using Windows.Win32;
using Windows.Win32.Foundation;
using Windows.Win32.UI.WindowsAndMessaging;

namespace DiNho.Capture.Poc.Capture;

/// <summary>
/// Finds DnHo windows by Electron PID and sets WDA_EXCLUDEFROMCAPTURE,
/// hiding the DiNho UI from recording footage when the user alt-tabs.
/// </summary>
internal static class WindowAffinityHelper
{
    /// <summary>
    /// Finds DnHo windows by Electron PID and sets WDA_EXCLUDEFROMCAPTURE.
    /// Returns the list of excluded window handles for later restoration.
    /// </summary>
    internal static unsafe List<IntPtr> ExcludeDinhoWindows(int electronPid)
    {
        var hwnds = new List<IntPtr>();
        if (electronPid <= 0) return hwnds;
        try
        {
            PInvoke.EnumWindows((hwnd, _) =>
            {
                uint pid;
                PInvoke.GetWindowThreadProcessId(hwnd, &pid);
                if (pid == (uint)electronPid && PInvoke.IsWindowVisible(hwnd))
                {
                    hwnds.Add((IntPtr)hwnd);
                    WdaHelper.ExcludeWindowFromCapture((IntPtr)hwnd);
                }
                return true;
            }, default);
            if (hwnds.Count > 0)
                Log.I("WindowAffinityHelper", $"WDA: excluded {hwnds.Count} DnHo window(s) from capture (PID={electronPid})");
        }
        catch (Exception ex)
        {
            Log.W("WindowAffinityHelper", $"WDA exclude failed: {ex.Message}");
        }
        return hwnds;
    }

    /// <summary>
    /// Restores WDA_NONE on DnHo windows — makes them visible in capture again.
    /// </summary>
    internal static void RestoreDinhoWindows(List<IntPtr> hwnds)
    {
        if (hwnds.Count == 0) return;
        try
        {
            foreach (var hwnd in hwnds)
                WdaHelper.RestoreWindowCapture(hwnd);
            Log.I("WindowAffinityHelper", $"WDA: restored {hwnds.Count} DnHo window(s) visibility");
        }
        catch (Exception ex)
        {
            Log.W("WindowAffinityHelper", $"WDA restore failed: {ex.Message}");
        }
        hwnds.Clear();
    }
}
