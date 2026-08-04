using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Capture;

/// <summary>
/// Pool ping-pong de texturas D3D11 para evitar alocações por frame.
/// O pipeline de captura é single-threaded — 2 texturas bastam:
/// uma sendo capturada (retorno de Rent), outra sendo encoded pelo NVENC.
/// </summary>
public sealed class TexturePool : IDisposable
{
    private readonly ID3D11Device _device;
    private readonly ID3D11Texture2D[] _pool;
    private int _nextIndex;
    private int _width, _height;
    private Format _format;
    private bool _disposed;

    public TexturePool(ID3D11Device device, int poolSize = 2)
    {
        _device = device;
        _pool = new ID3D11Texture2D[poolSize];
    }

    /// <summary>
    /// Obtém uma textura do pool com as dimensões desejadas.
    /// Se as dimensões ou formato mudaram, recria todas as texturas.
    /// A textura retornada NÃO deve ser disposed pelo chamador — o pool gerencia seu lifecycle.
    /// </summary>
    public ID3D11Texture2D Rent(int width, int height, Format format)
    {
        if (_width != width || _height != height || _format != format)
        {
            for (var i = 0; i < _pool.Length; i++)
            {
                _pool[i]?.Dispose();
                _pool[i] = null!;
            }
            _width = width;
            _height = height;
            _format = format;
        }

        var idx = _nextIndex % _pool.Length;
        _nextIndex++;

        if (_pool[idx] is null)
        {
            _pool[idx] = CreateTexture(width, height, format);
        }

        return _pool[idx];
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        for (var i = 0; i < _pool.Length; i++)
        {
            _pool[i]?.Dispose();
            _pool[i] = null!;
        }
    }

    private ID3D11Texture2D CreateTexture(int width, int height, Format format) =>
        _device.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)width,
            Height = (uint)height,
            MipLevels = 1,
            ArraySize = 1,
            Format = format,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            // ShaderResource habilita o D3D11 VideoProcessor (VideoProcessorBlt) a ler a
            // textura diretamente como entrada — evita uma cópia redundante (CopyResource)
            // no caminho WGC. O VideoProcessor usa ID3D11VideoProcessorInputView, que exige
            // bind como SR; texturas BindFlags.None não podem ser usadas nessa conversão.
            BindFlags = BindFlags.ShaderResource,
            CPUAccessFlags = CpuAccessFlags.None,
        });
}
