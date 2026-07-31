using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Encoders;

internal sealed class GpuVideoConverter : IDisposable
{
    private readonly ID3D11VideoDevice _videoDevice;
    private readonly ID3D11VideoContext _videoContext;
    private readonly ID3D11VideoProcessor _videoProcessor;
    private readonly ID3D11VideoProcessorEnumerator _enumerator;
    private ID3D11VideoContext1? _videoContext1;
    private readonly int _width;
    private readonly int _height;
    private ID3D11Texture2D? _cachedOutput;
    private ID3D11VideoProcessorInputView? _cachedInputView;
    private ID3D11VideoProcessorOutputView? _cachedOutputView;
    private ID3D11Texture2D? _cachedInputViewTexture;
    private bool _disposed;

    public GpuVideoConverter(ID3D11Device device, int width, int height)
    {
        if (width < 64 || height < 64)
            throw new ArgumentException($"GpuVideoConverter: dimensão ({width}x{height}) abaixo do mínimo 64x64 — crop muito pequeno causa E_INVALIDARG no VideoProcessorBlt");
        _width = width;
        _height = height;

        ID3D11VideoDevice? videoDevice = null;
        ID3D11VideoContext? videoContext = null;
        try
        {
            videoDevice = device.QueryInterface<ID3D11VideoDevice>();
            var ctx = device.ImmediateContext;
            videoContext = ctx.QueryInterface<ID3D11VideoContext>();
            _videoDevice = videoDevice;
            _videoContext = videoContext;

            var contentDesc = new VideoProcessorContentDescription
            {
                InputFrameFormat = VideoFrameFormat.Progressive,
                InputFrameRate = new Rational(60, 1),
                InputWidth = (uint)width,
                InputHeight = (uint)height,
                OutputFrameRate = new Rational(60, 1),
                OutputWidth = (uint)width,
                OutputHeight = (uint)height,
                Usage = VideoUsage.PlaybackNormal
            };

            _videoDevice.CreateVideoProcessorEnumerator(ref contentDesc, out _enumerator).CheckError();
            _videoDevice.CreateVideoProcessor(_enumerator, 0, out _videoProcessor).CheckError();

            // Define o espaço de cores correto: entrada BGRA full-range BT.709 → saída NV12
            // limited-range BT.709. Sem isso o D3D11 VideoProcessor mantém o default BT.601 e o
            // MP4 exportado fica sem o atom `colr` — players assumem BT.601 e as cores saem lavadas.
            _videoContext1 = ctx.QueryInterfaceOrNull<ID3D11VideoContext1>();
            if (_videoContext1 is not null)
            {
                try
                {
                    _videoContext1.VideoProcessorSetStreamColorSpace1(_videoProcessor, 0, ColorSpaceType.RgbFullG22NoneP709);
                    _videoContext1.VideoProcessorSetOutputColorSpace1(_videoProcessor, ColorSpaceType.YcbcrStudioG22LeftP709);
                }
                catch (Exception)
                {
                    _videoContext1.Dispose();
                    _videoContext1 = null;
                }
            }

            var nv12Desc = new Texture2DDescription
            {
                Width = (uint)_width,
                Height = (uint)_height,
                MipLevels = 1,
                ArraySize = 1,
                Format = Format.NV12,
                SampleDescription = new SampleDescription(1, 0),
                Usage = ResourceUsage.Default,
                BindFlags = BindFlags.RenderTarget,
                CPUAccessFlags = CpuAccessFlags.None,
            };
            _cachedOutput = device.CreateTexture2D(nv12Desc);
        }
        catch
        {
            videoDevice?.Dispose();
            videoContext?.Dispose();
            _videoContext1?.Dispose();
            throw;
        }
    }

    public ID3D11Texture2D Convert(ID3D11Texture2D inputBgra)
    {
        if (_cachedInputView == null || _cachedInputViewTexture != inputBgra)
        {
            _cachedInputView?.Dispose();
            var inputViewDesc = new VideoProcessorInputViewDescription
            {
                ViewDimension = VideoProcessorInputViewDimension.Texture2D,
                FourCC = 0,
                Texture2D = new Texture2DVideoProcessorInputView { MipSlice = 0, ArraySlice = 0 }
            };
            _videoDevice.CreateVideoProcessorInputView(
                inputBgra, _enumerator, inputViewDesc, out _cachedInputView).CheckError();
            _cachedInputViewTexture = inputBgra;
        }

        if (_cachedOutputView == null)
        {
            var outputViewDesc = new VideoProcessorOutputViewDescription
            {
                ViewDimension = VideoProcessorOutputViewDimension.Texture2D,
                Texture2D = new Texture2DVideoProcessorOutputView { MipSlice = 0 }
            };
            _videoDevice.CreateVideoProcessorOutputView(
                _cachedOutput, _enumerator, outputViewDesc, out _cachedOutputView).CheckError();
        }

        var stream = new VideoProcessorStream
        {
            Enable = true,
            OutputIndex = 0,
            InputFrameOrField = 0,
            PastFrames = 0,
            FutureFrames = 0,
            InputSurface = _cachedInputView
        };

        try
        {
            _videoContext.VideoProcessorBlt(
                _videoProcessor,
                _cachedOutputView,
                0,
                1,
                new[] { stream });
        }
        catch (Exception) when (IsDeviceLost())
        {
            throw new DeviceLostException("VideoProcessorBlt failed — device removed");
        }

        return _cachedOutput;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cachedOutput?.Dispose();
        _cachedInputView?.Dispose();
        _cachedOutputView?.Dispose();
        // VideoProcessor and Enumerator were created by us — safe to dispose.
        _videoProcessor.Dispose();
        _enumerator.Dispose();
        // _videoContext and _videoDevice are QueryInterface references from the
        // shared D3D11 device. Disposing them releases the shared COM object
        // and crashes other subsystems using the same device (FfmpegEncoder,
        // WgcCaptureSource, etc.). We must NOT dispose or Release them here.
    }

    /// <summary>
    /// Verifica se o dispositivo D3D11 foi removido (TDR, driver crash, sleep/wake).
    /// Chamado no catch do VideoProcessorBlt para distinguir device lost de outros erros.
    /// </summary>
    private bool IsDeviceLost()
    {
        try
        {
            using var device = _videoDevice.QueryInterface<ID3D11Device>();
            return device.DeviceRemovedReason is { Failure: true };
        }
        catch
        {
            return true; // Se não conseguiu obter o device, considerar lost
        }
    }
}
