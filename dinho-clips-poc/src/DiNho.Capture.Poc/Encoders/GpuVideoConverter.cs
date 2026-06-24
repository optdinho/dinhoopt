using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Encoders;

internal sealed class GpuVideoConverter : IDisposable
{
    private readonly ID3D11VideoDevice _videoDevice;
    private readonly ID3D11VideoContext _videoContext;
    private readonly ID3D11VideoProcessor _videoProcessor;
    private readonly ID3D11VideoProcessorEnumerator _enumerator;
    private readonly int _width;
    private readonly int _height;
    private ID3D11Texture2D? _cachedOutput;
    private bool _disposed;

    public GpuVideoConverter(ID3D11Device device, int width, int height)
    {
        _width = width;
        _height = height;

        _videoDevice = device.QueryInterface<ID3D11VideoDevice>();
        var ctx = device.ImmediateContext;
        _videoContext = ctx.QueryInterface<ID3D11VideoContext>();

        var contentDesc = new VideoProcessorContentDescription
        {
            InputFrameFormat = VideoFrameFormat.Progressive,
            InputFrameRate = new Rational(60, 1),
            InputWidth = width,
            InputHeight = height,
            OutputFrameRate = new Rational(60, 1),
            OutputWidth = width,
            OutputHeight = height,
            Usage = VideoUsage.PlaybackNormal
        };

        _videoDevice.CreateVideoProcessorEnumerator(ref contentDesc, out _enumerator).CheckError();
        _videoDevice.CreateVideoProcessor(_enumerator, 0, out _videoProcessor).CheckError();

        var nv12Desc = new Texture2DDescription
        {
            Width = _width,
            Height = _height,
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

    public ID3D11Texture2D Convert(ID3D11Texture2D inputBgra)
    {
        var inputViewDesc = new VideoProcessorInputViewDescription
        {
            ViewDimension = VideoProcessorInputViewDimension.Texture2D,
            FourCC = 0,
            Texture2D = new Texture2DVideoProcessorInputView { MipSlice = 0, ArraySlice = 0 }
        };
        _videoDevice.CreateVideoProcessorInputView(
            inputBgra, _enumerator, inputViewDesc, out var inputView).CheckError();

        using (inputView)
        {
            var outputViewDesc = new VideoProcessorOutputViewDescription
            {
                ViewDimension = VideoProcessorOutputViewDimension.Texture2D,
                Texture2D = new Texture2DVideoProcessorOutputView { MipSlice = 0 }
            };
            _videoDevice.CreateVideoProcessorOutputView(
                _cachedOutput, _enumerator, outputViewDesc, out var outputView).CheckError();

            using (outputView)
            {
                var stream = new VideoProcessorStream
                {
                    Enable = true,
                    OutputIndex = 0,
                    InputFrameOrField = 0,
                    PastFrames = 0,
                    FutureFrames = 0,
                    InputSurface = inputView
                };

                _videoContext.VideoProcessorBlt(
                    _videoProcessor,
                    outputView,
                    0,
                    1,
                    new[] { stream });
            }
        }

        return _cachedOutput;
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        _cachedOutput?.Dispose();
        _videoProcessor.Dispose();
        _enumerator.Dispose();
        _videoContext.Dispose();
        _videoDevice.Dispose();
    }
}
