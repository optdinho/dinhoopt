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
            // SR|RT em vez de só SR: o VideoProcessor (VideoProcessorBlt) exige a textura de
            // entrada com bind RenderTarget + ShaderResource — em RTX 5050 (NV) uma textura
            // SR-only devolve E_INVALIDARG (0x80070057) em TODOS os frames do caminho GPU.
            // O MSDN diz que SR basta para o ID3D11VideoProcessorInputView, mas o driver NV
            // falha sem RT (o _inputCopy, sempre SR|RT, nunca falhou). SR habilita a leitura
            // direta (sem _inputCopy); RT é o requisito real do driver. Compatível com o
            // CopyResource de WGC/DXGI/Hybrid (bind flags são irrelevantes para CopyResource).
            BindFlags = BindFlags.ShaderResource | BindFlags.RenderTarget,
            CPUAccessFlags = CpuAccessFlags.None,
        });
}
