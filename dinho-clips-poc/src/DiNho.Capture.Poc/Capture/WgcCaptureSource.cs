using DiNho.Capture.Poc.Logging;
using System.Diagnostics;
using System.Runtime.InteropServices;
using DiNho.Capture.Poc.Logging;
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

    private Direct3D11CaptureFrame? _latestFrame;
    private long _latestFrameTicks;
    private readonly AutoResetEvent _frameSignal = new(false);
    private bool _hasReceivedFrame;

    public void Initialize(ID3D11Device? sharedDevice = null) =>
        Initialize(sharedDevice, IntPtr.Zero);

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd)
    {
        _targetHwnd = targetHwnd;

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
                Console.Error.WriteLine($"[WGC-DIAG] QueryInterface<IDXGIDevice> falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }

            _winrtDevice = Direct3D11Helper.CreateDirect3DDeviceFromDxgiDevice(dxgiDevice);
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[WGC-DIAG] CreateDirect3DDeviceFromDxgiDevice falhou: {ex.GetType().Name}: {ex.Message}");
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
                Console.Error.WriteLine($"[WGC-DIAG] CreateForWindow falhou: {ex.GetType().Name}: {ex.Message}");
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
                item = GraphicsCaptureItemHelper.CreateForPrimaryMonitor();
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"[WGC-DIAG] CreateForPrimaryMonitor falhou: {ex.GetType().Name}: {ex.Message}");
                throw;
            }
            if (item is null)
                throw new InvalidOperationException("WGC CreateForPrimaryMonitor retornou null — WGC pode não estar disponível.");
            _captureItem = item;
        }

        _framePool = Direct3D11CaptureFramePool.Create(
            _winrtDevice,
            DirectXPixelFormat.B8G8R8A8UIntNormalized,
            numberOfBuffers: 2,
            _captureItem.Size);

        _session = _framePool.CreateCaptureSession(_captureItem);

        // NOTA: FrameArrived NÃO é registrado aqui — precisa ser na pump thread.
        // StartCapture() também não é chamado aqui — será via StartFramePump().
    }

    /// <summary>
    /// Registra o FrameArrived event handler e inicia a captura.
    /// Deve ser chamado na pump thread (STA com message pump) para que
    /// o DWM consiga entregar frames via o Windows message loop.
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

        var old = Interlocked.Exchange(ref _latestFrame, frame);
        old?.Dispose();
        Interlocked.Exchange(ref _latestFrameTicks, ticks);
        _hasReceivedFrame = true;
        _frameSignal.Set();
    }

    public CapturedFrame TryCaptureFrame(int timeoutMs)
    {
        var startTicks = Stopwatch.GetTimestamp();

        if (_frameSignal is null || _device is null)
            return new CapturedFrame(startTicks, Stopwatch.GetTimestamp(), 0, 0, success: false);

        try
        {
            var effectiveTimeout = !_hasReceivedFrame ? Math.Max(timeoutMs, 500) : timeoutMs;

            if (!_frameSignal.WaitOne(effectiveTimeout))
            {
                var timeoutTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, timeoutTicks, 0, 0, success: false, waitEndTicks: timeoutTicks);
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
                                    Console.Error.WriteLine($"[WGC] GetInterface falhou: hr={hrGet}");
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
                            Console.Error.WriteLine($"[WGC] Ambas estratégias falharam — IDirect3DDxgiInterfaceAccess={hr1}, IDXGISurface={hr2}");
                        }
                    }
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"[WGC] Falha ao extrair textura: {ex.GetType().Name}: {ex.Message}");
                }

                var extractEndTicks = Stopwatch.GetTimestamp();

                if (sourceTexture is null)
                {
                    return new CapturedFrame(startTicks, endTicks, size.Width, size.Height, success: true, waitEndTicks: waitEndTicks, copyEndTicks: extractEndTicks);
                }

                var desc = sourceTexture.Description;
                if (desc.Width != size.Width || desc.Height != size.Height)
                {
                    Console.Error.WriteLine($"[WGC] DIM MISMATCH: tex={desc.Width}x{desc.Height} fmt={desc.Format} vs content={size.Width}x{size.Height} — frame pulado para evitar E_OUTOFMEMORY no GpuVideoConverter");
                    return new CapturedFrame(startTicks, endTicks, 0, 0, success: false, waitEndTicks: waitEndTicks);
                }

                var copyDesc = new Texture2DDescription
                {
                    Width = desc.Width,
                    Height = desc.Height,
                    MipLevels = 1,
                    ArraySize = 1,
                    Format = desc.Format,
                    SampleDescription = new SampleDescription(1, 0),
                    Usage = ResourceUsage.Default,
                    BindFlags = BindFlags.None,
                    CPUAccessFlags = CpuAccessFlags.None,
                };

                var copy = _device.CreateTexture2D(copyDesc);
                var ctx = _device.ImmediateContext;
                ctx.CopyResource(copy, sourceTexture);
                ctx.Flush();

                var copyEndTicks = Stopwatch.GetTimestamp();
                return new CapturedFrame(startTicks, copyEndTicks, size.Width, size.Height, success: true, copy, _device,
                    waitEndTicks, copyEndTicks);
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

    public void Dispose()
    {
        _frameSignal.Dispose();
        _session?.Dispose();
        if (_framePool is not null)
        {
            _framePool.FrameArrived -= OnFrameArrived;
            _framePool.Dispose();
        }
        _latestFrame?.Dispose();
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
