using System.Diagnostics;
using Vortice;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Capture;

public sealed class DxgiCaptureSource : ICaptureSource
{
    public string Name => "DXGI Desktop Duplication";
    public int Width => _outputWidth;
    public int Height => _outputHeight;
    public ID3D11Device? Device => _device;

    private ID3D11Device? _device;
    private bool _ownsDevice;
    private ID3D11DeviceContext? _context;
    private IDXGIOutputDuplication? _duplication;
    private int _outputWidth;
    private int _outputHeight;

    private ID3D11Texture2D? _cachedTexture;
    private int _cachedWidth;
    private int _cachedHeight;

    public bool CheckDeviceLost() => _device?.DeviceRemovedReason is { Failure: true };

    public void Initialize(ID3D11Device? sharedDevice = null) =>
        Initialize(sharedDevice, IntPtr.Zero);

    public void Initialize(ID3D11Device? sharedDevice, IntPtr targetHwnd)
    {
        if (sharedDevice != null)
        {
            _device = sharedDevice;
            _context = _device.ImmediateContext;
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
                out _context);

            if (result.Failure || _device is null || _context is null)
            {
                throw new InvalidOperationException(
                    $"Falha ao criar D3D11 device para DXGI: {result}. " +
                    "Verifique se o driver da GPU está atualizado.");
            }

            _ownsDevice = true;
        }

        using var dxgiDevice = _device.QueryInterface<IDXGIDevice>();
        using var adapter = dxgiDevice.GetAdapter();

        // Enumerar todas as saídas e escolher a que contém a janela alvo
        var monitorHwnd = targetHwnd != IntPtr.Zero
            ? MonitorHelper.GetMonitorFromWindowHandle(targetHwnd)
            : MonitorHelper.GetPrimaryMonitorHandle();

        IDXGIOutput1? selectedOutput = null;
        OutputDescription selectedDesc = default;

        for (int i = 0; adapter.EnumOutputs(i, out var output).Success; i++)
        {
            using var output1 = output.QueryInterface<IDXGIOutput1>();
            var desc = output1.Description;

            // Verificar se este output corresponde ao monitor da janela
            var outputBounds = desc.DesktopCoordinates;
            var outputMidX = (outputBounds.Left + outputBounds.Right) / 2;
            var outputMidY = (outputBounds.Top + outputBounds.Bottom) / 2;
            var outputMonitor = MonitorHelper.MonitorFromPoint(outputMidX, outputMidY);

            if (outputMonitor == monitorHwnd)
            {
                selectedDesc = desc;
                _duplication = output1.DuplicateOutput(_device);
                _outputWidth = selectedDesc.DesktopCoordinates.Right - selectedDesc.DesktopCoordinates.Left;
                _outputHeight = selectedDesc.DesktopCoordinates.Bottom - selectedDesc.DesktopCoordinates.Top;
                return;
            }

            // Fallback: first output if no match
            if (selectedOutput is null)
            {
                selectedOutput = output1;
                selectedDesc = desc;
            }
        }

        if (selectedOutput is null)
            throw new InvalidOperationException("Nenhum output DXGI disponível para captura.");

        _outputWidth = selectedDesc.DesktopCoordinates.Right - selectedDesc.DesktopCoordinates.Left;
        _outputHeight = selectedDesc.DesktopCoordinates.Bottom - selectedDesc.DesktopCoordinates.Top;
        _duplication = selectedOutput.DuplicateOutput(_device);
    }

    public CapturedFrame TryCaptureFrame(int timeoutMs)
    {
        if (_duplication is null)
            throw new InvalidOperationException("Chame Initialize() antes de capturar.");

        var startTicks = Stopwatch.GetTimestamp();

        var hr = _duplication.AcquireNextFrame(
            timeoutMs,
            out var frameInfo,
            out var desktopResource);

        var waitEndTicks = Stopwatch.GetTimestamp();

        if (hr == Vortice.DXGI.ResultCode.WaitTimeout)
        {
            if (_cachedTexture != null)
            {
                var desc = _cachedTexture.Description;
                var clone = _device!.CreateTexture2D(desc);
                _context!.CopyResource(clone, _cachedTexture);
                return new CapturedFrame(startTicks, waitEndTicks, _cachedWidth, _cachedHeight, success: true, clone, _device,
                    waitEndTicks, waitEndTicks);
            }
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }

        if (hr.Failure || desktopResource is null)
        {
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }

        ID3D11Texture2D? copy = null;
        try
        {
            using var texture = desktopResource.QueryInterface<ID3D11Texture2D>();
            var desc = texture.Description;

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

            copy = _device!.CreateTexture2D(copyDesc);
            _context!.CopyResource(copy, texture);

            _cachedTexture?.Dispose();
            _cachedTexture = copy;
            _cachedWidth = (int)desc.Width;
            _cachedHeight = (int)desc.Height;
            var copyEndTicks = Stopwatch.GetTimestamp();
            var clone = _device!.CreateTexture2D(copyDesc);
            _context!.CopyResource(clone, copy);
            return new CapturedFrame(startTicks, copyEndTicks, (int)desc.Width, (int)desc.Height, success: true, clone, _device,
                waitEndTicks, copyEndTicks);
        }
        catch
        {
            copy?.Dispose();
            return new CapturedFrame(startTicks, waitEndTicks, 0, 0, success: false);
        }
        finally
        {
            desktopResource.Dispose();
            _duplication.ReleaseFrame();
        }
    }

    public void Dispose()
    {
        _cachedTexture?.Dispose();
        _duplication?.Dispose();
        if (_ownsDevice)
        {
            _context?.Dispose();
            _device?.Dispose();
        }
    }
}