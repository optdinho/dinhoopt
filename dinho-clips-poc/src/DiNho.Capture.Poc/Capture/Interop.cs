using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX.Direct3D11;
using Vortice.DXGI;
using WinRT;

namespace DiNho.Capture.Poc.Capture
{
    [ComImport]
    [Guid("1EB64011-96F5-463A-A87B-4B1E9BFAE9F9")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    internal interface IGraphicsCaptureItemInterop
    {
        // IInspectable vtable padding (3 methods) — slots [3], [4], [5]
        // Necessário porque IGraphicsCaptureItemInterop herda de IInspectable.
        // InterfaceIsIUnknown + padding evita o crash do CLR ao tentar validar
        // projeção WinRT no Marshal.GetTypedObjectForIUnknown.
        [PreserveSig] int GetIids(out int iidCount, out IntPtr iids);
        [PreserveSig] int GetRuntimeClassName(out IntPtr className);
        [PreserveSig] int GetTrustLevel(out int trustLevel);
        // Método real em vtable[6]
        void CreateForMonitor(nint monitor, ref Guid riid, out nint result);
    }

    internal static class GraphicsCaptureItemHelper
    {
        [DllImport("combase.dll", PreserveSig = false)]
        private static extern void RoGetActivationFactory(IntPtr activatableClassId, ref Guid iid, out IntPtr factory);

        [DllImport("combase.dll", PreserveSig = true)]
        private static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string sourceString, int length, out IntPtr hstring);

        [DllImport("combase.dll", PreserveSig = true)]
        private static extern int WindowsDeleteString(IntPtr hstring);

        private const string RuntimeClassName = "Windows.Graphics.Capture.GraphicsCaptureItem";
        private static readonly Guid IGraphicsCaptureItemInteropGuid = new("1EB64011-96F5-463A-A87B-4B1E9BFAE9F9");

        private static IntPtr CreateHString(string s)
        {
            var hr = WindowsCreateString(s, s.Length, out var hstr);
            if (hr != 0)
                throw new InvalidOperationException($"WindowsCreateString falhou: HRESULT=0x{hr:X8}");
            return hstr;
        }

        private static IGraphicsCaptureItemInterop GetActivationFactoryInterop()
        {
            var hstr = CreateHString(RuntimeClassName);
            try
            {
                var iid = IGraphicsCaptureItemInteropGuid;
                RoGetActivationFactory(hstr, ref iid, out var factoryPtr);
                try
                {
                    return (IGraphicsCaptureItemInterop)Marshal.GetTypedObjectForIUnknown(factoryPtr, typeof(IGraphicsCaptureItemInterop));
                }
                finally
                {
                    Marshal.Release(factoryPtr);
                }
            }
            finally
            {
                WindowsDeleteString(hstr);
            }
        }

        public static GraphicsCaptureItem CreateForMonitor(IntPtr hMonitor)
        {
            IGraphicsCaptureItemInterop interop;
            try
            {
                interop = GetActivationFactoryInterop();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WGC-DIAG] GetActivationFactoryInterop() falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            var guid = typeof(GraphicsCaptureItem).GUID;
            IntPtr itemPtr;
            try
            {
                interop.CreateForMonitor(hMonitor, ref guid, out itemPtr);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WGC-DIAG] interop.CreateForMonitor falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            try
            {
                return MarshalInterface<GraphicsCaptureItem>.FromAbi(itemPtr);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WGC-DIAG] MarshalInterface<GraphicsCaptureItem>.FromAbi falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
        }

        public static GraphicsCaptureItem CreateForPrimaryMonitor()
        {
            var hMonitor = MonitorHelper.GetPrimaryMonitorHandle();
            Console.Error.WriteLine($"[WGC-DIAG] CreateForPrimaryMonitor: hMonitor=0x{hMonitor:X8}");
            return CreateForMonitor(hMonitor);
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
            IntPtr dxgiPtr;
            try
            {
                dxgiPtr = dxgiDevice.NativePointer;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WGC-DIAG] dxgiDevice.NativePointer falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            IntPtr winrtPtr;
            try
            {
                winrtPtr = CreateDirect3D11DeviceFromDXGIDevice(dxgiPtr);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WGC-DIAG] d3d11!CreateDirect3D11DeviceFromDXGIDevice falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            try
            {
                return MarshalInterface<IDirect3DDevice>.FromAbi(winrtPtr);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WGC-DIAG] MarshalInterface<IDirect3DDevice>.FromAbi falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
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
