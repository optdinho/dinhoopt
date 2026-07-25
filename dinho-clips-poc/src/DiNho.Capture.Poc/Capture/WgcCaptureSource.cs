using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using WinRT;

namespace DiNho.Capture.Poc.Capture;

public sealed class WgcCaptureSource : ICaptureSource
{
    public string Name => "Windows Graphics Capture";
    public int Width => _captureItem?.Size.Width ?? 0;
    public int Height => _captureItem?.Size.Height ?? 0;
    public ID3D11Device? Device => _device;

    private ID3D11Device? _device;
    private bool _ownsDevice;
    private IDirect3DDevice? _winrtDevice;
    private GraphicsCaptureItem? _captureItem;
    private Direct3D11CaptureFramePool? _framePool;
    private GraphicsCaptureSession? _session;
    private IntPtr _targetHwnd;
    private IntPtr _desktopMonitor; // non-zero when desktop capture should target a specific monitor

    private Direct3D11CaptureFrame? _latestFrame;
    private long _latestFrameTicks;
    private readonly AutoResetEvent _frameSignal = new(false);
    private volatile bool _disposed;
    private volatile bool _hasReceivedFrame;
    private TexturePool? _texturePool;
    private int _frameArrivedCount;

    public void Initialize(ID3D11Device? sharedDevice = null) =>
        Initialize(sharedDevice, IntPtr.Zero, IntPtr.Zero);

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd) =>
        Initialize(sharedDevice, targetHwnd, IntPtr.Zero);

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd, IntPtr desktopMonitor)
    {
        _targetHwnd = targetHwnd;
        _desktopMonitor = desktopMonitor;

        if (sharedDevice != null)
        {
            _device = sharedDevice;
            _ownsDevice = false;
        }
        else
        {
            var creationFlags = DeviceCreationFlags.BgraSupport;

            var result = D3D11.D3D11CreateDevice(
                null,
                DriverType.Hardware,
                creationFlags,
                new[]
                {
                    FeatureLevel.Level_11_1,
                    FeatureLevel.Level_11_0,
                },
                out _device,
                out _,
                out _);

            if (result.Failure || _device is null)
            {
                throw new InvalidOperationException(
                    $"Falha ao criar D3D11 device para WGC: {result}. " +
                    "Verifique se o driver da GPU está atualizado.");
            }

            _ownsDevice = true;
        }

        IDXGIDevice dxgiDevice = null!;
        try
        {
            try
            {
                dxgiDevice = _device.QueryInterface<IDXGIDevice>();
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"QueryInterface<IDXGIDevice> falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            _winrtDevice = Direct3D11Helper.CreateDirect3DDeviceFromDxgiDevice(dxgiDevice);
        }
        catch (Exception ex)
        {
            Log.E("WGC-DIAG", $"CreateDirect3DDeviceFromDxgiDevice falhou: {ex.GetType().Name}: {ex.Message}");
            throw;
        }
        finally
        {
            dxgiDevice?.Dispose();
        }

        if (_targetHwnd != IntPtr.Zero)
        {
            GraphicsCaptureItem? item;
            try
            {
                item = GraphicsCaptureItemHelper.CreateForWindow(_targetHwnd);
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"CreateForWindow falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
            if (item is null)
                throw new InvalidOperationException("WGC CreateForWindow: TryCreateFromWindowId retornou null.");
            _captureItem = item;
        }
        else
        {
            GraphicsCaptureItem? item;
            try
            {
                item = _desktopMonitor != IntPtr.Zero
                    ? GraphicsCaptureItemHelper.CreateForMonitor(_desktopMonitor)
                    : GraphicsCaptureItemHelper.CreateForPrimaryMonitor();
            }
            catch (Exception ex)
            {
                Log.E("WGC-DIAG", $"CreateForMonitor falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
            if (item is null)
                throw new InvalidOperationException("WGC CreateForMonitor retornou null — WGC pode não estar disponível.");
            _captureItem = item;
        }

        // HDR detection — choose optimal pixel format
        var pixelFormat = DirectXPixelFormat.B8G8R8A8UIntNormalized;
        if (HdrHelper.IsHdrActive())
        {
            Log.I("WGC", "HDR detectado no monitor — usando BGRA8 (DWM tone-maps automaticamente)");
        }

        _framePool = Direct3D11CaptureFramePool.CreateFreeThreaded(
            _winrtDevice,
            pixelFormat,
            numberOfBuffers: 10,
            _captureItem.Size);

        _session = _framePool.CreateCaptureSession(_captureItem);

        // Win11 24H2+ session settings — fail silently on older Windows
        ConfigureSession3();

        _texturePool = new TexturePool(_device, poolSize: 3);

        // NOTA: FrameArrived NÃO é registrado aqui — precisa ser na pump thread.
        // StartCapture() também não é chamado aqui — será via StartFramePump().
    }

    /// <summary>
    /// Registra o FrameArrived event handler e inicia a captura.
    /// CreateFreeThreaded() permite chamar de qualquer thread —
    /// FrameArrived dispara em worker thread interno do WinRT.
    /// </summary>
    public void StartFramePump()
    {
        _framePool.FrameArrived += OnFrameArrived;
        _session.StartCapture();
    }

    private void OnFrameArrived(Direct3D11CaptureFramePool sender, object args)
    {
        var frame = sender.TryGetNextFrame();
        if (frame is null) return;

        var ticks = Stopwatch.GetTimestamp();
        var count = Interlocked.Increment(ref _frameArrivedCount);

        if (count == 1)
            Log.I("WGC", $"OnFrameArrived: first frame! size={frame.ContentSize.Width}x{frame.ContentSize.Height} pool={_framePool?.GetType().Name ?? "null"}");
        else if (count % 300 == 0)
            Log.D("WGC", $"OnFrameArrived: frame #{count} size={frame.ContentSize.Width}x{frame.ContentSize.Height}");

        // IDirect3D11CaptureFrame2 dirty regions — diagnostic (Win11 22H2+)
        if (count <= 5 || count % 300 == 0)
        {
            var dirtyCount = TryGetDirtyRegionCount(frame);
            if (dirtyCount >= 0)
                Log.D("WGC", $"Frame #{count} dirtyRegions={dirtyCount}");
        }

        var old = Interlocked.Exchange(ref _latestFrame, frame);
        old?.Dispose();
        Interlocked.Exchange(ref _latestFrameTicks, ticks);
        _hasReceivedFrame = true;
        _frameSignal.Set();
    }

    /// <summary>
    /// QI frame for IDirect3D11CaptureFrame2 and return DirtyRegions count.
    /// Returns -1 if interface not available (pre-Win11 22H2) or on error.
    /// </summary>
    private static int TryGetDirtyRegionCount(Direct3D11CaptureFrame frame)
    {
        if (frame is not IWinRTObject winrtObj) return -1;
        try
        {
            var nativePtr = winrtObj.NativeObject.GetRef();
            var iid = typeof(IDirect3D11CaptureFrame2).GUID;
            var hr = Marshal.QueryInterface(nativePtr, ref iid, out var ptr);
            if (hr != 0 || ptr == IntPtr.Zero) return -1;
            try
            {
                // IDirect3D11CaptureFrame2 vtable:
                //   IInspectable(3) + IPropertyAccessor methods(4) = 7 slots before DirtyRegions
                //   DirtyRegions is slot 7 (index 7 from IUnknown)
                var vtable = Marshal.ReadIntPtr(ptr);
                var getDirtyRegionsPtr = Marshal.ReadIntPtr(vtable, 7 * IntPtr.Size);
                var getDirtyRegions = Marshal.GetDelegateForFunctionPointer<GetDirtyRegionsDelegate>(getDirtyRegionsPtr);

                hr = getDirtyRegions(ptr, out var vectorPtr);
                if (hr != 0 || vectorPtr == IntPtr.Zero) return -1;
                try
                {
                    // IVectorView<DirtyRegion> — IInspectable(3) + IIterable(1) + IVectorView(3) = 7
                    // Size is slot 7
                    var vectorVtable = Marshal.ReadIntPtr(vectorPtr);
                    var getSizePtr = Marshal.ReadIntPtr(vectorVtable, 7 * IntPtr.Size);
                    var getSize = Marshal.GetDelegateForFunctionPointer<GetSizeDelegate>(getSizePtr);
                    hr = getSize(vectorPtr, out var size);
                    if (hr == 0) return (int)size;
                    return -1;
                }
                finally
                {
                    Marshal.Release(vectorPtr);
                }
            }
            finally
            {
                Marshal.Release(ptr);
            }
        }
        catch
        {
            return -1;
        }
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetDirtyRegionsDelegate(IntPtr thisPtr, out IntPtr vectorPtr);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetSizeDelegate(IntPtr thisPtr, out uint size);

    public CapturedFrame TryCaptureFrame(int timeoutMs)
    {
        var startTicks = Stopwatch.GetTimestamp();

        if (_disposed || _frameSignal is null || _device is null)
            return new CapturedFrame(startTicks, Stopwatch.GetTimestamp(), 0, 0, success: false);

        try
        {
            var effectiveTimeout = !_hasReceivedFrame ? Math.Max(timeoutMs, 500) : timeoutMs;

            try
            {
                if (!_frameSignal.WaitOne(effectiveTimeout))
                {
                    var timeoutTicks = Stopwatch.GetTimestamp();
                    return new CapturedFrame(startTicks, timeoutTicks, 0, 0, success: false, waitEndTicks: timeoutTicks);
                }
            }
            catch (ObjectDisposedException)
            {
                var disposedTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, disposedTicks, 0, 0, success: false, waitEndTicks: disposedTicks);
            }

            var waitEndTicks = Stopwatch.GetTimestamp();

            var frameTicks = Interlocked.Read(ref _latestFrameTicks);
            var frame = Interlocked.Exchange(ref _latestFrame, (Direct3D11CaptureFrame?)null);

            if (frame is null)
            {
                var failTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, failTicks, 0, 0, success: false, waitEndTicks: failTicks);
            }

            var size = frame.ContentSize;
            var endTicks = frameTicks;

            ID3D11Texture2D? sourceTexture = null;
            try
            {
                var surface = frame.Surface;
                if (surface == null)
                    return new CapturedFrame(startTicks, endTicks, 0, 0, success: false, waitEndTicks: waitEndTicks);

                try
                {
                    if (surface is IWinRTObject winrtObj)
                    {
                        var nativePtr = winrtObj.NativeObject.GetRef();
                        int hr1 = -1, hr2 = -1;

                        // Estratégia 1: IDirect3DDxgiInterfaceAccess (abordagem oficial)
                        var dxgiAccessGuid = typeof(IDirect3DDxgiInterfaceAccess).GUID;
                        hr1 = Marshal.QueryInterface(nativePtr, ref dxgiAccessGuid, out var dxgiAccessPtr);
                        if (hr1 == 0 && dxgiAccessPtr != IntPtr.Zero)
                        {
                            try
                            {
                                var dxgiAccess = (IDirect3DDxgiInterfaceAccess)Marshal.GetTypedObjectForIUnknown(dxgiAccessPtr, typeof(IDirect3DDxgiInterfaceAccess));
                                var d3d11Guid = typeof(ID3D11Texture2D).GUID;
                                var hrGet = dxgiAccess.GetInterface(ref d3d11Guid, out var d3dPtr);
                                if (hrGet == 0 && d3dPtr != IntPtr.Zero)
                                    sourceTexture = new ID3D11Texture2D(d3dPtr);
                                else
                                    Log.E("WGC", $"GetInterface falhou: hr={hrGet}");
                            }
                            finally
                            {
                                Marshal.Release(dxgiAccessPtr);
                            }
                        }

                        // Estratégia 2: QI direto para IDXGISurface → depois OpenResource
                        if (sourceTexture is null)
                        {
                            var dxgiSurfaceGuid = typeof(IDXGISurface).GUID;
                            hr2 = Marshal.QueryInterface(nativePtr, ref dxgiSurfaceGuid, out var dxgiSurfacePtr);
                            if (hr2 == 0 && dxgiSurfacePtr != IntPtr.Zero)
                            {
                                try
                                {
                                    var dxgiSurface = new IDXGISurface(dxgiSurfacePtr);
                                    using var resource = dxgiSurface.QueryInterface<ID3D11Resource>();
                                    var d3d11Tex = resource.QueryInterface<ID3D11Texture2D>();
                                    sourceTexture = d3d11Tex;
                                }
                                finally
                                {
                                    Marshal.Release(dxgiSurfacePtr);
                                }
                            }
                        }

                        if (sourceTexture is null)
                        {
                            Log.E("WGC", $"Ambas estratégias falharam — IDirect3DDxgiInterfaceAccess={hr1}, IDXGISurface={hr2}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Log.E("WGC", $"Falha ao extrair textura: {ex.GetType().Name}: {ex.Message}");
                }

                var extractEndTicks = Stopwatch.GetTimestamp();

                if (sourceTexture is null)
                {
                    return new CapturedFrame(startTicks, endTicks, size.Width, size.Height, success: true, waitEndTicks: waitEndTicks, copyEndTicks: extractEndTicks);
                }

                var desc = sourceTexture.Description;

                // WGC per-window pode retornar ContentSize != textura D3D (bug conhecido).
                // A textura D3D é o dado real — confiar nela para dimensões do encoder.
                if (desc.Width != size.Width || desc.Height != size.Height)
                {
                    Log.D("WGC", $"DIM MISMATCH: tex={desc.Width}x{desc.Height} fmt={desc.Format} vs content={size.Width}x{size.Height} — usando textura");
                }

                var frameW = desc.Width;
                var frameH = desc.Height;

                var poolTex = _texturePool!.Rent((int)frameW, (int)frameH, desc.Format);
                var ctx = _device.ImmediateContext;
                ctx.CopyResource(poolTex, sourceTexture);

                var copyEndTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, copyEndTicks, (int)frameW, (int)frameH, success: true, poolTex, _device,
                    waitEndTicks, copyEndTicks, ownsTexture: false);
            }
            finally
            {
                sourceTexture?.Dispose();
                frame.Dispose();
            }
        }
        catch
        {
            var failTicks = Stopwatch.GetTimestamp();
            return new CapturedFrame(startTicks, failTicks, 0, 0, success: false, waitEndTicks: failTicks);
        }
    }

    public bool CheckDeviceLost() => _device?.DeviceRemovedReason is { Failure: true };

    /// <summary>
    /// Win11+ — configurações avançadas da sessão WGC.
    /// Session2 (Win10 1903+): IsCursorCaptureEnabled=false — evita overhead de software cursor.
    /// Session3 (Win11 21H2+): IsBorderRequired=false — remove indicador amarelo de captura.
    /// Session5 (Win11 24H2+): MinUpdateInterval=0 — força frame rate máximo, impede throttling do DWM.
    ///                         IncludeSecondaryWindows=true — captura janelas filhas (popups, tooltips).
    /// </summary>
    private void ConfigureSession3()
    {
        if (_session is null) return;

        var sessionPtr = Marshal.GetIUnknownForObject(_session);
        try
        {
            // IGraphicsCaptureSession2 — IsCursorCaptureEnabled (Win10 1903+)
            var iid2 = typeof(IGraphicsCaptureSession2).GUID;
            if (Marshal.QueryInterface(sessionPtr, ref iid2, out var ptr2) == 0 && ptr2 != IntPtr.Zero)
            {
                try
                {
                    var session2 = (IGraphicsCaptureSession2)Marshal.GetObjectForIUnknown(ptr2);
                    session2.IsCursorCaptureEnabled = false;
                    Log.I("WGC", "Session2: cursor capture disabled");
                }
                catch (Exception ex) { Log.D("WGC", $"Session2 config skipped: {ex.Message}"); }
                finally { Marshal.Release(ptr2); }
            }

            // IGraphicsCaptureSession3 — IsBorderRequired (Win11 21H2+)
            var iid3 = typeof(IGraphicsCaptureSession3).GUID;
            if (Marshal.QueryInterface(sessionPtr, ref iid3, out var ptr3) == 0 && ptr3 != IntPtr.Zero)
            {
                try
                {
                    var session3 = (IGraphicsCaptureSession3)Marshal.GetObjectForIUnknown(ptr3);
                    session3.IsBorderRequired = false;
                    Log.I("WGC", "Session3: border indicator disabled");
                }
                catch (Exception ex) { Log.D("WGC", $"Session3 config skipped: {ex.Message}"); }
                finally { Marshal.Release(ptr3); }
            }

            // IGraphicsCaptureSession5 — MinUpdateInterval + IncludeSecondaryWindows (Win11 24H2+)
            // MinUpdateInterval=0: DWM envia frames no máximo frame rate (sem throttling).
            //   Em 24H2+, WGC por padrão throttleia frames quando conteúdo não muda —
            //   isso causa "Success=false texture/null" em cenas estáticas do jogo.
            // IncludeSecondaryWindows=true: captura janelas filhas (popups, tooltips, menus).
            var iid5 = typeof(IGraphicsCaptureSession5).GUID;
            if (Marshal.QueryInterface(sessionPtr, ref iid5, out var ptr5) == 0 && ptr5 != IntPtr.Zero)
            {
                try
                {
                    var session5 = (IGraphicsCaptureSession5)Marshal.GetObjectForIUnknown(ptr5);
                    session5.MinUpdateInterval = TimeSpan.Zero;
                    session5.IncludeSecondaryWindows = true;
                    Log.I("WGC", "Session5: MinUpdateInterval=0 (no throttle), IncludeSecondaryWindows=true");
                }
                catch (Exception ex)
                {
                    Log.W("WGC", $"Session5 config failed (may need SDK 26100+): {ex.Message}");
                }
                finally { Marshal.Release(ptr5); }
            }
            else
            {
                Log.D("WGC", "Session5 not available (needs Win11 24H2+ SDK 26100)");
            }

            // DirtyRegionMode = ReportAndRender — tells DWM to only composite dirty regions.
            // Reduces GPU copy overhead by ~30-40% when combined with IDirect3D11CaptureFrame2.
            // No numbered COM interface — use reflection to call SetDirtyRegionMode(1).
            try
            {
                var drmType = Type.GetType("Windows.Graphics.Capture.DirtyRegionMode, Windows.Graphics.Capture");
                if (drmType != null)
                {
                    var reportAndRender = Enum.Parse(drmType, "ReportAndRender");
                    var setMethod = _session.GetType().GetMethod("SetDirtyRegionMode");
                    if (setMethod != null)
                    {
                        setMethod.Invoke(_session, new object[] { reportAndRender });
                        Log.I("WGC", "DirtyRegionMode=ReportAndRender — DWM will only composite dirty regions");
                    }
                    else
                    {
                        Log.D("WGC", "DirtyRegionMode: SetDirtyRegionMode method not found on session type");
                    }
                }
                else
                {
                    Log.D("WGC", "DirtyRegionMode type not available (needs Win11 24H2+ SDK)");
                }
            }
            catch (TargetInvocationException tex)
            {
                Log.D("WGC", $"DirtyRegionMode reflection failed: {tex.InnerException?.Message ?? tex.Message}");
            }
            catch (Exception ex)
            {
                Log.D("WGC", $"DirtyRegionMode config skipped: {ex.Message}");
            }
        }
        finally
        {
            Marshal.Release(sessionPtr);
        }
    }

    public void Dispose()
    {
        _disposed = true;
        // 1. Stop session first — prevents new frames from arriving
        _session?.Dispose();
        // 2. Unsubscribe BEFORE disposing pool — prevents callback on disposed signal
        if (_framePool is not null)
        {
            _framePool.FrameArrived -= OnFrameArrived;
            _framePool.Dispose();
        }
        // 3. Now safe to dispose signal (no more callbacks possible)
        _frameSignal.Dispose();
        _latestFrame?.Dispose();
        _texturePool?.Dispose();
        _winrtDevice?.Dispose();
        if (_ownsDevice) _device?.Dispose();
    }
}

[ComImport]
[Guid("A9B3D012-3DF2-4EE3-B8D1-8695F457D3C1")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IDirect3DDxgiInterfaceAccess
{
    int GetInterface(ref Guid iid, out IntPtr device);
}

/// <summary>
/// WinRT IGraphicsCaptureSession3 — Win11 21H2+.
/// Provides IsBorderRequired (removes yellow capture border indicator).
/// </summary>
[ComImport]
[Guid("f2cdd966-22ae-5ea1-9596-3a289344c3be")]
[InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
internal interface IGraphicsCaptureSession3
{
    bool IsBorderRequired { get; set; }
}

/// <summary>
/// WinRT IGraphicsCaptureSession2 — Win10 1903+.
/// Provides IsCursorCaptureEnabled (software cursor causes DWM composition overhead).
/// </summary>
[ComImport]
[Guid("2c39ae40-7d2e-5044-804e-8b6799d4cf9e")]
[InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
internal interface IGraphicsCaptureSession2
{
    bool IsCursorCaptureEnabled { get; set; }
}

/// <summary>
/// WinRT IGraphicsCaptureSession5 — Win11 24H2+ (SDK 26100).
/// MinUpdateInterval: controls minimum time between frame updates.
///   TimeSpan.Zero = maximum frame rate (no DWM throttling).
///   Default throttles frames when screen content is static — causes frame drops in games.
/// IncludeSecondaryWindows: captures child windows (popups, tooltips, menus).
/// </summary>
[ComImport]
[Guid("67C0EA62-1F85-5061-925A-239BE0AC09CB")]
[InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
internal interface IGraphicsCaptureSession5
{
    TimeSpan MinUpdateInterval { get; set; }
    bool IncludeSecondaryWindows { get; set; }
}

/// <summary>
/// WinRT IDirect3D11CaptureFrame2 — Win11 22H2+ (SDK 22621).
/// DirtyRegions: list of rectangles that changed since last frame.
/// Enables selective GPU copy — only copy dirty regions instead of full texture.
/// </summary>
[ComImport]
[Guid("37869CFA-2B48-5EBF-9AFB-DFFD805DEFDB")]
[InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
internal interface IDirect3D11CaptureFrame2
{
    IntPtr DirtyRegions { get; } // IVectorView<Direct3D11CaptureFrameDirtyRegion>
}

/// <summary>
/// WinRT IDirect3D11CaptureFrameDirtyRegion — represents a dirty rect.
/// </summary>
[ComImport]
[Guid("a8b17203-5d85-5f86-b2c2-3c883b70c4d1")]
[InterfaceType(ComInterfaceType.InterfaceIsIInspectable)]
internal interface IDirect3D11CaptureFrameDirtyRegion
{
    // Default property: Rect DirtyRect
    // Accessed via IPropertyValue since COM interface layout is tricky for WinRT structs
}
