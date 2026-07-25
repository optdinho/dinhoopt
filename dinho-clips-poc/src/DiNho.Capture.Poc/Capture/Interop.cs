using DiNho.Capture.Poc.Logging;
using System.Runtime.InteropServices;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX.Direct3D11;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using WinRT;

namespace DiNho.Capture.Poc.Capture
{
    internal static class GraphicsCaptureItemHelper
    {
        [DllImport("combase.dll", PreserveSig = false)]
        private static extern void RoGetActivationFactory(IntPtr activatableClassId, ref Guid iid, out IntPtr factory);

        [DllImport("combase.dll", PreserveSig = true)]
        private static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string sourceString, int length, out IntPtr hstring);

        [DllImport("combase.dll", PreserveSig = true)]
        private static extern int WindowsDeleteString(IntPtr hstring);

        private const string RuntimeClassName = "Windows.Graphics.Capture.GraphicsCaptureItem";

        // IInspectable GUID — every WinRT activation factory implements this
        private static readonly Guid IInspectableGuid = new("AF86E2E0-B12D-4C6A-9C5A-D78A0574605B");

        // IGraphicsCaptureItemInterop — COM interface on the activation factory for monitor/window capture
        private static readonly Guid IGraphicsCaptureItemInteropGuid = new("1EB64011-96F5-463A-A87B-4B1E9BFAE9F9");

        // GraphicsCaptureItem GUID — passed to CreateForWindow/CreateForMonitor as riid
        private static readonly Guid GraphicsCaptureItemGuid = typeof(GraphicsCaptureItem).GUID;

        // Raw vtable delegates — bypass COM interop marshaling entirely.
        // COM vtable methods use stdcall convention on Windows.
        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int CreateForMonitorDelegate(IntPtr thisPtr, IntPtr hMonitor, ref Guid iid, out IntPtr result);

        [UnmanagedFunctionPointer(CallingConvention.StdCall)]
        private delegate int CreateForWindowDelegate(IntPtr thisPtr, IntPtr hwnd, ref Guid iid, out IntPtr result);

        private static IntPtr CreateHString(string s)
        {
            var hr = WindowsCreateString(s, s.Length, out var hstr);
            if (hr != 0)
                throw new InvalidOperationException($"WindowsCreateString falhou: HRESULT=0x{hr:X8}");
            return hstr;
        }

        /// <summary>
        /// Gets the activation factory as IInspectable via RoGetActivationFactory.
        /// Caller must Marshal.Release() when done.
        /// </summary>
        private static IntPtr GetActivationFactoryAsInspectable()
        {
            var hstr = CreateHString(RuntimeClassName);
            try
            {
                var iid = IInspectableGuid;
                RoGetActivationFactory(hstr, ref iid, out var factoryPtr);
                return factoryPtr;
            }
            finally
            {
                WindowsDeleteString(hstr);
            }
        }

        /// <summary>
        /// Creates a GraphicsCaptureItem for a monitor using raw vtable calls.
        /// Two-step approach:
        ///   1) Get activation factory as IInspectable (always works for WinRT classes)
        ///   2) Marshal.QueryInterface for IGraphicsCaptureItemInterop (standard COM QI)
        /// Then call CreateForMonitor via raw vtable (slot 4 — IUnknown(3) + method(1)).
        /// </summary>
        public static GraphicsCaptureItem CreateForMonitor(IntPtr hMonitor)
        {
            IntPtr factoryPtr;
            try
            {
                factoryPtr = GetActivationFactoryAsInspectable();
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"GetActivationFactoryAsInspectable() falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            IntPtr interopPtr = IntPtr.Zero;
            try
            {
                // QI the activation factory for IGraphicsCaptureItemInterop
                var interopGuid = IGraphicsCaptureItemInteropGuid;
                var qiHr = Marshal.QueryInterface(factoryPtr, ref interopGuid, out interopPtr);
                if (qiHr != 0 || interopPtr == IntPtr.Zero)
                    throw new COMException($"QI for IGraphicsCaptureItemInterop failed: HRESULT=0x{qiHr:X8}", qiHr);

                Log.D("WGC-DIAG", $"QI IGraphicsCaptureItemInterop OK: interopPtr=0x{interopPtr:X8}");

                // IGraphicsCaptureItemInterop vtable (inherits IUnknown):
                //   [0] QueryInterface, [1] AddRef, [2] Release
                //   [3] CreateForWindow, [4] CreateForMonitor
                var vtable = Marshal.ReadIntPtr(interopPtr);
                var createForMonitorPtr = Marshal.ReadIntPtr(vtable, 4 * IntPtr.Size);
                var createForMonitor = Marshal.GetDelegateForFunctionPointer<CreateForMonitorDelegate>(createForMonitorPtr);

                var itemGuid = GraphicsCaptureItemGuid;
                var hr = createForMonitor(interopPtr, hMonitor, ref itemGuid, out var itemPtr);

                if (hr != 0)
                    throw new COMException($"CreateForMonitor failed: HRESULT=0x{hr:X8}", hr);

                return MarshalInterface<GraphicsCaptureItem>.FromAbi(itemPtr);
            }
            catch (COMException)
            {
                throw;
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"CreateForMonitor raw vtable call failed: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
            finally
            {
                if (interopPtr != IntPtr.Zero) Marshal.Release(interopPtr);
                Marshal.Release(factoryPtr);
            }
        }

        public static GraphicsCaptureItem CreateForPrimaryMonitor()
        {
            var hMonitor = MonitorHelper.GetPrimaryMonitorHandle();
            Log.D("WGC-DIAG", $"CreateForPrimaryMonitor: hMonitor=0x{hMonitor:X8}");
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
                Log.E("WGC", $"TryCreateFromWindowId falhou: {ex.Message}");
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
                Log.E("WGC-DIAG", $"dxgiDevice.NativePointer falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            IntPtr winrtPtr;
            try
            {
                winrtPtr = CreateDirect3D11DeviceFromDXGIDevice(dxgiPtr);
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"d3d11!CreateDirect3D11DeviceFromDXGIDevice falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            try
            {
                return MarshalInterface<IDirect3DDevice>.FromAbi(winrtPtr);
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"MarshalInterface<IDirect3DDevice>.FromAbi falhou: {ex.GetType().Name}: {ex.Message}");
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

    /// <summary>
    /// Seleciona o melhor adaptador DXGI (preferência: GPU dedicada > integrada).
    /// Em notebooks com iGPU + dGPU, evita capturar na GPU errada.
    /// </summary>
    internal static class AdapterHelper
    {
        public static bool TryCreateDevice(out ID3D11Device? device, out ID3D11DeviceContext? context)
        {
            device = null;
            context = null;

            try
            {
                using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory6>();
                if (factory == null) return false;

                // Preferência: GPU dedicada (dGPU) > integrada (iGPU)
                for (uint i = 0; ; i++)
                {
                    var hr = factory.EnumAdapterByGpuPreference<IDXGIAdapter>(i, GpuPreference.HighPerformance, out var adapter);
                    if (hr.Failure || adapter == null) break;

                    var desc = adapter.Description;
                    // Pular adaptadores de software (WARP, etc.)
                    if (adapter is IDXGIAdapter1 adapter1)
                    {
                        var desc1 = adapter1.Description1;
                        if (desc1.Flags.HasFlag(AdapterFlags.Software))
                        {
                            adapter.Dispose();
                            continue;
                        }
                    }

                    var flags = DeviceCreationFlags.BgraSupport;
                    var result = D3D11.D3D11CreateDevice(
                        adapter, DriverType.Unknown, flags,
                        [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0],
                        out device, out _, out context);
                    adapter.Dispose();

                    if (result.Success && device != null) return true;
                    break;
                }
            }
            catch { }
            return false;
        }
    }

    /// <summary>
    /// Detecção HDR via DisplayConfigGetDeviceInfo (Win10 1703+).
    /// Retorna true se o monitor alvo estiver em modo HDR.
    /// Com BGRA8, o DWM faz HDR→SDR automaticamente (resultado visual correto).
    /// Com R16G16B16A16_FLOAT, preserva faixa HDR mas requer tone mapping manual.
    /// </summary>
    internal static class HdrHelper
    {
        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int DisplayConfigGetDeviceInfo(ref DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO requestPacket);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO
        {
            public uint type;
            public uint size;
            public DISPLAYCONFIG_DEVICE_INFO_HEADER header;
            public uint advancedColorInfoFlags;
            public uint advancedColorMode;
            public uint bitsPerChannel;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DISPLAYCONFIG_DEVICE_INFO_HEADER
        {
            public uint type;
            public uint size;
            public LUID adapterId;
            public uint id;
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct LUID
        {
            public uint LowPart;
            public int HighPart;
        }

        private const uint DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO = 0x00000047;
        private const uint DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_FLAG_ADVANCED_COLOR_ACTIVE = 0x1;

        public static bool IsHdrActive()
        {
            try
            {
                // Query primary display (adapterId=0, id=0)
                var request = new DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO
                {
                    type = DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
                    size = (uint)Marshal.SizeOf<DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO>(),
                    header = new DISPLAYCONFIG_DEVICE_INFO_HEADER
                    {
                        type = DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO,
                        size = (uint)Marshal.SizeOf<DISPLAYCONFIG_DEVICE_INFO_HEADER>(),
                    }
                };

                var hr = DisplayConfigGetDeviceInfo(ref request);
                if (hr != 0) return false;

                return (request.advancedColorInfoFlags & DISPLAYCONFIG_GET_ADVANCED_COLOR_INFO_FLAG_ADVANCED_COLOR_ACTIVE) != 0;
            }
            catch
            {
                return false;
            }
        }
    }

    /// <summary>
    /// Detecção e configuração WDA (Window Display Affinity).
    /// Jogos que usam SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) não podem ser capturados.
    /// O WGC retorna frames pretos nesse caso.
    /// Usamos WDA_EXCLUDEFROMCAPTURE para esconder a janela DnHo do próprio recording.
    /// </summary>
    internal static class WdaHelper
    {
        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GetWindowDisplayAffinity(IntPtr hWnd, out uint pdwFlags);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetWindowDisplayAffinity(IntPtr hWnd, uint dwAffinity);

        public const uint WDA_NONE = 0x00;
        public const uint WDA_EXCLUDEFROMCAPTURE = 0x01;
        public const uint WDA_EXCLUEFROMCAPTURE_WIN11 = 0x11; // Win11 name variant
        public const uint WDA_EXCLUDEFROMCAPTURE_MODERN = 0x11; // Win11+ variant

        /// <summary>
        /// Returns true if the window is excluded from capture (WDA_EXCLUDEFROMCAPTURE).
        /// In that case, WGC returns black frames — must fallback to Hybrid/DDA.
        /// </summary>
        public static bool IsExcludedFromCapture(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            try
            {
                if (!GetWindowDisplayAffinity(hwnd, out var affinity)) return false;
                return affinity == WDA_EXCLUDEFROMCAPTURE || affinity == WDA_EXCLUEFROMCAPTURE_WIN11;
            }
            catch
            {
                return false;
            }
        }

        /// <summary>
        /// Sets WDA_EXCLUDEFROMCAPTURE on a window — hides it from WGC/DXGI capture.
        /// Used to exclude the DnHo app window from recorded gameplay footage.
        /// Returns true on success.
        /// </summary>
        public static bool ExcludeWindowFromCapture(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            try
            {
                // Try Win10 constant (0x01) first — works on all Windows versions
                var ok = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE);
                if (!ok)
                {
                    // Fallback to Win11 constant (0x11) — some Win11 builds need this
                    ok = SetWindowDisplayAffinity(hwnd, WDA_EXCLUDEFROMCAPTURE_MODERN);
                    if (ok)
                        Log.I("WDA", $"SetWindowDisplayAffinity(0x{WDA_EXCLUDEFROMCAPTURE_MODERN:X}) OK (Win11 variant) on hwnd=0x{hwnd:X}");
                }
                else
                {
                    Log.I("WDA", $"SetWindowDisplayAffinity(0x{WDA_EXCLUDEFROMCAPTURE:X}) OK on hwnd=0x{hwnd:X}");
                }
                if (!ok)
                    Log.W("WDA", $"SetWindowDisplayAffinity failed: Win32 error={Marshal.GetLastWin32Error()}");
                return ok;
            }
            catch (Exception ex)
            {
                Log.W("WDA", $"SetWindowDisplayAffinity exception: {ex.Message}");
                return false;
            }
        }

        /// <summary>
        /// Restores WDA_NONE on a window — makes it visible in capture again.
        /// </summary>
        public static bool RestoreWindowCapture(IntPtr hwnd)
        {
            if (hwnd == IntPtr.Zero) return false;
            try
            {
                var ok = SetWindowDisplayAffinity(hwnd, WDA_NONE);
                if (ok)
                    Log.I("WDA", $"SetWindowDisplayAffinity(WDA_NONE) OK — window visible in capture again");
                return ok;
            }
            catch (Exception ex)
            {
                Log.W("WDA", $"RestoreWindowCapture exception: {ex.Message}");
                return false;
            }
        }
    }
}
