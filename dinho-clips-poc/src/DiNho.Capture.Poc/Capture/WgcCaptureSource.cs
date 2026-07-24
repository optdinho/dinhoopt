using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
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
    private bool _hasReceivedFrame;
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
            numberOfBuffers: 4,
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

        var old = Interlocked.Exchange(ref _latestFrame, frame);
        old?.Dispose();
        Interlocked.Exchange(ref _latestFrameTicks, ticks);
        _hasReceivedFrame = true;
        _frameSignal.Set();
    }

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

            var frame = Interlocked.Exchange(ref _latestFrame, (Direct3D11CaptureFrame?)null);
            var frameTicks = _latestFrameTicks;

            if (frame is null)
            {
                var failTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, failTicks, 0, 0, success: false, waitEndTicks: failTicks);
            }

            var size = frame.ContentSize;
            var endTicks = frameTicks;

            try
            {
                var surface = frame.Surface;
                if (surface == null)
                    return new CapturedFrame(startTicks, endTicks, 0, 0, success: false, waitEndTicks: waitEndTicks);

                ID3D11Texture2D? sourceTexture = null;

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
    /// IsBorderRequired=false: remove indicador amarelo de captura (IGraphicsCaptureSession3, Win11 21H2+).
    /// IsCursorCaptureEnabled=false: evita overhead de software cursor (IGraphicsCaptureSession2, Win10 1903+).
    /// </summary>
    private void ConfigureSession3()
    {
        if (_session is null) return;

        var sessionPtr = Marshal.GetIUnknownForObject(_session);
        try
        {
            // IGraphicsCaptureSession2 — IsCursorCaptureEnabled
            var iid2 = typeof(IGraphicsCaptureSession2).GUID;
            if (Marshal.QueryInterface(sessionPtr, ref iid2, out var ptr2) == 0 && ptr2 != IntPtr.Zero)
            {
                try
                {
                    var session2 = (IGraphicsCaptureSession2)Marshal.GetObjectForIUnknown(ptr2);
                    session2.IsCursorCaptureEnabled = false;
                    Log.I("WGC", "Session2: cursor capture disabled");
                }
                catch { }
                finally { Marshal.Release(ptr2); }
            }

            // IGraphicsCaptureSession3 — IsBorderRequired
            var iid3 = typeof(IGraphicsCaptureSession3).GUID;
            if (Marshal.QueryInterface(sessionPtr, ref iid3, out var ptr3) == 0 && ptr3 != IntPtr.Zero)
            {
                try
                {
                    var session3 = (IGraphicsCaptureSession3)Marshal.GetObjectForIUnknown(ptr3);
                    session3.IsBorderRequired = false;
                    Log.I("WGC", "Session3: border indicator disabled");
                }
                catch { }
                finally { Marshal.Release(ptr3); }
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
        _frameSignal.Dispose();
        _session?.Dispose();
        if (_framePool is not null)
        {
            _framePool.FrameArrived -= OnFrameArrived;
            _framePool.Dispose();
        }
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
