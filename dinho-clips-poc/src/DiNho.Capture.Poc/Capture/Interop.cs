using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX.Direct3D11;
using Vortice.DXGI;
using WinRT;

namespace DiNho.Capture.Poc.Capture
{
    [ComImport]
    [Guid("1EB64011-96F5-463A-A87B-4B1E9BFAE9F9")]
    [InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
    internal interface IGraphicsCaptureItemInterop
    {
        void CreateForMonitor(nint monitor, ref Guid riid, out nint result);
    }

    internal static class GraphicsCaptureItemHelper
    {
        [DllImport("user32.dll")]
        private static extern IntPtr GetDesktopWindow();

        public static GraphicsCaptureItem CreateForPrimaryMonitor()
        {
            try
            {
                // Usa a janela da área de trabalho (Desktop) que cobre o monitor primário.
                // TryCreateFromWindowId não precisa do ActivationFactory.Get — vai direto
                // pela projeção CsWinRT, que resolve o activation factory internamente.
                var desktopHwnd = GetDesktopWindow();
                var windowId = new global::Windows.UI.WindowId { Value = (ulong)desktopHwnd };
                var item = GraphicsCaptureItem.TryCreateFromWindowId(windowId);
                if (item is null)
                    throw new InvalidOperationException(
                        "TryCreateFromWindowId(desktop) retornou null — WGC pode não estar disponível.");
                return item;
            }
            catch (Exception ex)
            {
                throw new InvalidOperationException(
                    "WGC não disponível (" + ex.GetType().Name + "). " +
                    "Verifique se o sistema suporta Windows.Graphics.Capture (Windows 10 1903+).", ex);
            }
        }

        public static GraphicsCaptureItem? CreateForWindow(IntPtr hwnd)
        {
            try
            {
                var windowId = new global::Windows.UI.WindowId { Value = (ulong)hwnd };
                return GraphicsCaptureItem.TryCreateFromWindowId(windowId);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WGC] TryCreateFromWindowId falhou: {ex.Message}");
                return null;
            }
        }
    }

    internal static class Direct3D11Helper
    {
        [DllImport("d3d11.dll", EntryPoint = "CreateDirect3D11DeviceFromDXGIDevice", PreserveSig = false)]
        private static extern IntPtr CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgiDevice);

        public static IDirect3DDevice CreateDirect3DDeviceFromDxgiDevice(IDXGIDevice dxgiDevice)
        {
            var dxgiPtr = dxgiDevice.NativePointer;
            var winrtPtr = CreateDirect3D11DeviceFromDXGIDevice(dxgiPtr);
            return MarshalInterface<IDirect3DDevice>.FromAbi(winrtPtr);
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    internal struct NativePoint
    {
        public int X;
        public int Y;
        public NativePoint(int x, int y) { X = x; Y = y; }
    }

    internal static class MonitorHelper
    {
        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromPoint(NativePoint pt, uint dwFlags);

        [DllImport("user32.dll")]
        private static extern IntPtr MonitorFromWindow(IntPtr hwnd, uint dwFlags);

        [DllImport("user32.dll", CharSet = CharSet.Auto)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX lpmi);

        [DllImport("user32.dll")]
        private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, EnumMonitorsDelegate lpfnEnum, IntPtr dwData);

        private delegate bool EnumMonitorsDelegate(IntPtr hMonitor, IntPtr hdcMonitor, IntPtr lprcMonitor, IntPtr dwData);

        private const uint MONITOR_DEFAULTTOPRIMARY = 1;
        private const uint MONITOR_DEFAULTTONEAREST = 2;

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
        private struct MONITORINFOEX
        {
            public int cbSize;
            public RECT rcMonitor;
            public RECT rcWork;
            public uint dwFlags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
            public string szDevice;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct RECT
        {
            public int Left; public int Top; public int Right; public int Bottom;
        }

        public static IntPtr GetPrimaryMonitorHandle()
        {
            return MonitorFromPoint(new NativePoint(0, 0), MONITOR_DEFAULTTOPRIMARY);
        }

        public static int GetMonitorCount()
        {
            var count = 0;
            EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (_, _, _, _) => { count++; return true; }, IntPtr.Zero);
            return count;
        }

        public static int GetMonitorFromWindow(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return 0;
            var hMonitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            var mi = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (!GetMonitorInfo(hMonitor, ref mi))
                return 0;
            return hMonitor.GetHashCode();
        }

        public static IntPtr GetMonitorFromWindowHandle(IntPtr hwnd)
        {
            return MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        }

        public static IntPtr MonitorFromPoint(int x, int y)
        {
            return MonitorFromPoint(new NativePoint(x, y), MONITOR_DEFAULTTONEAREST);
        }

        public static (int left, int top, int right, int bottom) GetMonitorRect(IntPtr hMonitor)
        {
            var mi = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (!GetMonitorInfo(hMonitor, ref mi))
                return (0, 0, 0, 0);
            return (mi.rcMonitor.Left, mi.rcMonitor.Top, mi.rcMonitor.Right, mi.rcMonitor.Bottom);
        }
    }
}
