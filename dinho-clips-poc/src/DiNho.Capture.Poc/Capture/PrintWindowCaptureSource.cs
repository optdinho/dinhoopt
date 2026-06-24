using System.Diagnostics;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Capture;

public sealed class PrintWindowCaptureSource : ICaptureSource
{
    public string Name => "PrintWindow";
    public int Width => _windowWidth;
    public int Height => _windowHeight;
    public ID3D11Device? Device => _device;

    private const uint PWM_CAPTUREWINDOW = 0x80000000;

    private ID3D11Device? _device;
    private ID3D11DeviceContext? _context;
    private bool _ownsDevice;
    private IntPtr _targetHwnd;

    private int _windowWidth;
    private int _windowHeight;
    private ID3D11Texture2D? _cachedTexture;
    private long _lastCaptureTicks;
    private readonly long _minFrameIntervalTicks;

    // Staging texture for CPU→GPU upload
    private ID3D11Texture2D? _stagingTexture;
    private int _stagingWidth;
    private int _stagingHeight;

    public PrintWindowCaptureSource(int targetFps = 10)
    {
        _minFrameIntervalTicks = Stopwatch.Frequency / Math.Clamp(targetFps, 1, 60);
    }

    public void Initialize(ID3D11Device? sharedDevice = null)
    {
        throw new NotSupportedException(
            "PrintWindowCaptureSource requires an HWND. Use Initialize(sharedDevice, hwnd) instead.");
    }

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd)
    {
        _targetHwnd = targetHwnd;

        if (sharedDevice != null)
        {
            _device = sharedDevice;
            _context = _device.ImmediateContext;
            _ownsDevice = false;
        }
        else
        {
            var flags = DeviceCreationFlags.BgraSupport;
            var result = D3D11.D3D11CreateDevice(
                null, DriverType.Hardware, flags,
                [FeatureLevel.Level_11_1, FeatureLevel.Level_11_0],
                out _device, out _, out _context);
            if (result.Failure || _device is null || _context is null)
                throw new InvalidOperationException($"Falha ao criar D3D11 device para PrintWindow: {result}");
            _ownsDevice = true;
        }

        RefreshWindowDimensions();
        if (_windowWidth > 0 && _windowHeight > 0)
            AllocateTextures(_windowWidth, _windowHeight);
    }

    public CapturedFrame TryCaptureFrame(int timeoutMs)
    {
        var startTicks = Stopwatch.GetTimestamp();

        // Throttle to configured fps
        var now = Stopwatch.GetTimestamp();
        if (now - _lastCaptureTicks < _minFrameIntervalTicks)
        {
            // Return cached frame if available
            if (_cachedTexture != null)
            {
                var desc = _cachedTexture.Description;
                var clone = _device!.CreateTexture2D(desc);
                _context!.CopyResource(clone, _cachedTexture);
                return new CapturedFrame(startTicks, now, _windowWidth, _windowHeight,
                    success: true, clone, _device, now, now);
            }
            return new CapturedFrame(startTicks, now, 0, 0, success: false);
        }

        // Window still valid?
        if (!IsWindow(_targetHwnd))
            return new CapturedFrame(startTicks, Stopwatch.GetTimestamp(), 0, 0, success: false);

        // Check for dimension change
        var oldW = _windowWidth;
        var oldH = _windowHeight;
        RefreshWindowDimensions();
        bool sizeChanged = _windowWidth != oldW || _windowHeight != oldH;
        if (sizeChanged && _windowWidth > 0 && _windowHeight > 0)
            AllocateTextures(_windowWidth, _windowHeight);

        var waitEndTicks = Stopwatch.GetTimestamp();

        // If window has zero area (minimized during capture), keep cached
        if (_windowWidth <= 0 || _windowHeight <= 0)
        {
            if (_cachedTexture != null)
            {
                var desc = _cachedTexture.Description;
                var clone = _device!.CreateTexture2D(desc);
                _context!.CopyResource(clone, _cachedTexture);
                return new CapturedFrame(startTicks, waitEndTicks, _windowWidth, _windowHeight,
                    success: true, clone, _device, waitEndTicks, Stopwatch.GetTimestamp());
            }
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }

        // Capture via PrintWindow
        var capResult = CaptureBitmap();
        if (capResult == null || capResult.Length == 0)
        {
            // PrintWindow returned blank — use cached
            if (_cachedTexture != null)
            {
                var desc = _cachedTexture.Description;
                var clone = _device!.CreateTexture2D(desc);
                _context!.CopyResource(clone, _cachedTexture);
                return new CapturedFrame(startTicks, waitEndTicks, _windowWidth, _windowHeight,
                    success: true, clone, _device, waitEndTicks, Stopwatch.GetTimestamp());
            }
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }

        _lastCaptureTicks = now;

        try
        {
            // Upload bitmap data to staging texture
            if (_stagingTexture == null)
                return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);

            var mapped = _context!.Map(_stagingTexture, 0, MapMode.Write, Vortice.Direct3D11.MapFlags.None);
            try
            {
                int srcRowPitch = _windowWidth * 4;
                int dstRowPitch = mapped.RowPitch;

                // Copy row-by-row handling pitch differences
                for (int y = 0; y < _windowHeight; y++)
                {
                    Marshal.Copy(capResult, y * srcRowPitch,
                        mapped.DataPointer + y * dstRowPitch, srcRowPitch);
                }
            }
            finally
            {
                _context.Unmap(_stagingTexture, 0);
            }

            // Copy staging → device cache texture
            _context.CopyResource(_cachedTexture!, _stagingTexture);

            // Clone for output
            var desc = _cachedTexture!.Description;
            var clone2 = _device!.CreateTexture2D(desc);
            _context.CopyResource(clone2, _cachedTexture);

            var copyEndTicks = Stopwatch.GetTimestamp();
            return new CapturedFrame(startTicks, copyEndTicks, _windowWidth, _windowHeight,
                success: true, clone2, _device, waitEndTicks, copyEndTicks);
        }
        catch
        {
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }
    }

    private byte[]? CaptureBitmap()
    {
        if (_windowWidth <= 0 || _windowHeight <= 0)
            return null;

        var hdcScreen = GetDC(IntPtr.Zero);
        if (hdcScreen == IntPtr.Zero)
            return null;

        var hdcMem = CreateCompatibleDC(hdcScreen);
        var hBitmap = CreateCompatibleBitmap(hdcScreen, _windowWidth, _windowHeight);
        if (hBitmap == IntPtr.Zero)
        {
            DeleteDC(hdcMem);
            ReleaseDC(IntPtr.Zero, hdcScreen);
            return null;
        }

        var hOld = SelectObject(hdcMem, hBitmap);

        try
        {
            bool printed = PrintWindow(_targetHwnd, hdcMem, PWM_CAPTUREWINDOW);
            if (!printed)
                return null;

            // Extract pixel data via GetDIBits
            int rowPitch = _windowWidth * 4;
            int pixelSize = rowPitch * _windowHeight;
            var buffer = new byte[pixelSize];
            var gcHandle = GCHandle.Alloc(buffer, GCHandleType.Pinned);

            try
            {
                var bmi = new BITMAPINFO
                {
                    bmiHeader = new BITMAPINFOHEADER
                    {
                        biSize = Marshal.SizeOf<BITMAPINFOHEADER>(),
                        biWidth = _windowWidth,
                        biHeight = -_windowHeight, // top-down
                        biPlanes = 1,
                        biBitCount = 32,
                        biCompression = 0, // BI_RGB
                        biSizeImage = pixelSize,
                    }
                };

                int lines = GetDIBits(hdcMem, hBitmap, 0, (uint)_windowHeight,
                    gcHandle.AddrOfPinnedObject(), ref bmi, 0);
                if (lines == 0)
                    return null;
            }
            finally
            {
                gcHandle.Free();
            }

            return buffer;
        }
        finally
        {
            SelectObject(hdcMem, hOld);
            DeleteObject(hBitmap);
            DeleteDC(hdcMem);
            ReleaseDC(IntPtr.Zero, hdcScreen);
        }
    }

    private void RefreshWindowDimensions()
    {
        if (!IsWindow(_targetHwnd))
        {
            _windowWidth = 0;
            _windowHeight = 0;
            return;
        }

        if (IsIconic(_targetHwnd))
        {
            // Minimized: use normal-position dimensions from WINDOWPLACEMENT
            var placement = new WINDOWPLACEMENT();
            placement.length = Marshal.SizeOf<WINDOWPLACEMENT>();
            if (GetWindowPlacement(_targetHwnd, ref placement))
            {
                var rc = placement.rcNormalPosition;
                int w = rc.Right - rc.Left;
                int h = rc.Bottom - rc.Top;
                // Clamp to reasonable values (minimized windows may report 0)
                _windowWidth = Math.Max(1, w & ~1);
                _windowHeight = Math.Max(1, h & ~1);
            }
            return;
        }

        var rect = new RECT();
        if (!GetClientRect(_targetHwnd, ref rect))
        {
            _windowWidth = 0;
            _windowHeight = 0;
            return;
        }

        // GetClientRect returns right=width, bottom=height
        _windowWidth = Math.Max(1, rect.Right & ~1);
        _windowHeight = Math.Max(1, rect.Bottom & ~1);
    }

    private void AllocateTextures(int width, int height)
    {
        _cachedTexture?.Dispose();
        _stagingTexture?.Dispose();

        var desc = new Texture2DDescription
        {
            Width = width,
            Height = height,
            MipLevels = 1,
            ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.None,
            CPUAccessFlags = CpuAccessFlags.None,
        };

        _cachedTexture = _device!.CreateTexture2D(desc);

        var stagingDesc = new Texture2DDescription
        {
            Width = width,
            Height = height,
            MipLevels = 1,
            ArraySize = 1,
            Format = Format.B8G8R8A8_UNorm,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Staging,
            CPUAccessFlags = CpuAccessFlags.Write,
        };
        _stagingTexture = _device!.CreateTexture2D(stagingDesc);

        _stagingWidth = width;
        _stagingHeight = height;
    }

    public bool CheckDeviceLost() => _device?.DeviceRemovedReason is { Failure: true };

    public void Dispose()
    {
        _cachedTexture?.Dispose();
        _stagingTexture?.Dispose();
        if (_ownsDevice)
        {
            _context?.Dispose();
            _device?.Dispose();
        }
    }

    // --- Public helpers for window state ---

    public static bool IsWindowForeground(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        return GetForegroundWindow() == hwnd;
    }

    public static bool IsWindowMinimized(IntPtr hwnd)
    {
        if (hwnd == IntPtr.Zero) return false;
        return IsIconic(hwnd);
    }

    // --- Win32 P/Invokes ---

    [DllImport("user32.dll")]
    private static extern bool PrintWindow(IntPtr hwnd, IntPtr hdcBlt, uint nFlags);

    [DllImport("user32.dll")]
    private static extern IntPtr GetDC(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ReleaseDC(IntPtr hWnd, IntPtr hDC);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern IntPtr CreateCompatibleBitmap(IntPtr hdc, int nWidth, int nHeight);

    [DllImport("gdi32.dll")]
    private static extern IntPtr SelectObject(IntPtr hdc, IntPtr hgdiobj);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteObject(IntPtr hObject);

    [DllImport("gdi32.dll")]
    private static extern bool DeleteDC(IntPtr hdc);

    [DllImport("gdi32.dll")]
    private static extern int GetDIBits(IntPtr hdc, IntPtr hbmp, uint uStartScan,
        uint cScanLines, IntPtr lpvBits, ref BITMAPINFO lpbmi, uint uUsage);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsIconic(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetClientRect(IntPtr hWnd, ref RECT lpRect);

    [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowPlacement(IntPtr hWnd, ref WINDOWPLACEMENT lpwndpl);

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern bool GetWindowRect(IntPtr hWnd, ref RECT lpRect);

    // --- Structs ---

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFOHEADER
    {
        public int biSize;
        public int biWidth;
        public int biHeight;
        public short biPlanes;
        public short biBitCount;
        public int biCompression;
        public int biSizeImage;
        public int biXPelsPerMeter;
        public int biYPelsPerMeter;
        public int biClrUsed;
        public int biClrImportant;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct BITMAPINFO
    {
        public BITMAPINFOHEADER bmiHeader;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WINDOWPLACEMENT
    {
        public int length;
        public int flags;
        public int showCmd;
        public POINT ptMinPosition;
        public POINT ptMaxPosition;
        public RECT rcNormalPosition;
    }
}
