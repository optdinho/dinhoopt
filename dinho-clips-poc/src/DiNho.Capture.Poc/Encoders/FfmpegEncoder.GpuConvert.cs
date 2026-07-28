using System.Runtime.CompilerServices;
using DiNho.Capture.Poc.Logging;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.MediaFoundation;

namespace DiNho.Capture.Poc.Encoders;

internal partial class FfmpegEncoder
{
    private DateTime _gpuConverterFailedUntil = DateTime.MinValue;
    private const int GPU_CONVERTER_COOLDOWN_MS = 5000;

    private ID3D11Texture2D? _cpuStaging;
    private int _cpuStagingW, _cpuStagingH;

    private unsafe byte[]? ConvertGpuNv12(ID3D11Texture2D texture)
    {
        if ((_cropW > 0 && _cropW < 320) || (_cropH > 0 && _cropH < 240))
        {
            _gpuConvertFails++;
            Log.W("FfmpegEncoder", $"crop too small {_cropW}x{_cropH} — skipping frame");
            return null;
        }

        var texDesc = texture.Description;
        // Allow height mismatch of 1 pixel (odd→even rounding in Initialize)
        if (texDesc.Width != _width || Math.Abs((int)texDesc.Height - _height) > 1)
        {
            _gpuConvertFails++;
            Log.W("FfmpegEncoder", $"DIM MISMATCH guard: tex={texDesc.Width}x{texDesc.Height} esperado={_width}x{_height} — frame pulado");
            return null;
        }

        // Odd capture height: GpuVideoConverter requires even NV12 dimensions — go straight to CPU fallback
        if ((texDesc.Height & 1) != 0)
            return ConvertCpuNv12(texture, texture.Device);

        var device = texture.Device;
        var ctx = device.ImmediateContext;

        if (_gpuConverter == null && DateTime.UtcNow < _gpuConverterFailedUntil)
            return ConvertCpuNv12(texture, device);

        try
        {
            _gpuConverter ??= new GpuVideoConverter(device, _width, _height);
            _gpuConverterFailedUntil = DateTime.MinValue;
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            _gpuConverterFailedUntil = DateTime.UtcNow.AddMilliseconds(GPU_CONVERTER_COOLDOWN_MS);
            Log.E("FfmpegEncoder", $"GpuVideoConverter constructor fail #{_gpuConvertFails}: {ex.Message} — falling back to CPU conversion");
            return ConvertCpuNv12(texture, device);
        }

        try
        {
            EnsureInputCopy(texture, device);
            ctx.CopyResource(_inputCopy, texture);

            var nv12Tex = _gpuConverter.Convert(_inputCopy);
            EnsureStaging(device);
            ctx.CopyResource(_nv12Staging, nv12Tex);

            // Map() on a staging texture blocks until all preceding GPU work completes.
            // Explicit Flush() calls were forcing synchronous GPU execution, adding ~1-2ms/frame.
            var map = ctx.Map(_nv12Staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
            _gpuConvertFails = 0;
            try
            {
                return PackNv12(map);
            }
            finally { ctx.Unmap(_nv12Staging, 0); }
        }
        catch (DeviceLostException)
        {
            _gpuConverter?.Dispose();
            _gpuConverter = null;
            _gpuConverterFailedUntil = DateTime.MinValue;
            _nv12Staging?.Dispose();
            _nv12Staging = null;
            _inputCopy?.Dispose();
            _inputCopy = null;
            _gpuConvertFails++;
            throw;
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            Log.E("FfmpegEncoder", $"GPU convert fail #{_gpuConvertFails}: {ex.GetType().Name}: {ex.Message}");
            return ConvertCpuNv12(texture, device);
        }
    }

    private unsafe byte[]? ConvertCpuNv12(ID3D11Texture2D texture, ID3D11Device device)
    {
        try
        {
            var texDesc = texture.Description;
            int texW = (int)texDesc.Width;
            int texH = (int)texDesc.Height;
            // Staging texture must match source size for CopyResource, but we only convert _height rows
            if (_cpuStaging == null || _cpuStagingW != texW || _cpuStagingH != texH)
            {
                _cpuStaging?.Dispose();
                _cpuStaging = device.CreateTexture2D(new Texture2DDescription
                {
                    Width = (uint)texW, Height = (uint)texH, MipLevels = 1, ArraySize = 1,
                    Format = Format.B8G8R8A8_UNorm,
                    SampleDescription = new SampleDescription(1, 0),
                    Usage = ResourceUsage.Staging,
                    BindFlags = BindFlags.None,
                    CPUAccessFlags = CpuAccessFlags.Read,
                });
                _cpuStagingW = texW;
                _cpuStagingH = texH;
                Log.W("FfmpegEncoder", $"CPU BGRA→NV12 fallback active (capture={texW}x{texH} encode={_width}x{_height})");
            }

            var ctx = device.ImmediateContext;
            ctx.CopyResource(_cpuStaging, texture);
            var map = ctx.Map(_cpuStaging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
            try
            {
                int srcPitch = (int)map.RowPitch;
                int ySize = _height * _width;
                int totalSize = ySize + (_height / 2) * _width;

                if (_nv12Scratch == null || _nv12Scratch.Length != totalSize)
                    _nv12Scratch = new byte[totalSize];

                var src = (byte*)map.DataPointer.ToPointer();
                fixed (byte* dst = _nv12Scratch)
                {
                    byte* yPlane = dst;
                    byte* uvPlane = dst + ySize;

                    // Only convert _height rows (may be 1 less than texH if odd)
                    for (int row = 0; row < _height; row++)
                    {
                        var srcRow = src + row * srcPitch;
                        for (int col = 0; col < _width; col++)
                        {
                            byte b = srcRow[col * 4 + 0];
                            byte g = srcRow[col * 4 + 1];
                            byte r = srcRow[col * 4 + 2];

                            int y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
                            yPlane[row * _width + col] = (byte)(y < 16 ? 16 : y > 235 ? 235 : y);

                            // NV12: U and V are interleaved in the same plane (U V U V ...)
                            if ((row & 1) == 0 && (col & 1) == 0)
                            {
                                int u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
                                int v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
                                int uvIdx = (row / 2) * _width + col;
                                uvPlane[uvIdx] = (byte)(u < 16 ? 16 : u > 240 ? 240 : u);
                                uvPlane[uvIdx + 1] = (byte)(v < 16 ? 16 : v > 240 ? 240 : v);
                            }
                        }
                    }
                }
                return _nv12Scratch;
            }
            finally { ctx.Unmap(_cpuStaging, 0); }
        }
        catch (Exception ex)
        {
            _gpuConvertFails++;
            Log.E("FfmpegEncoder", $"CPU convert fail #{_gpuConvertFails}: {ex.GetType().Name}: {ex.Message}");
            return null;
        }
    }

    private void EnsureInputCopy(ID3D11Texture2D texture, ID3D11Device device)
    {
        var desc = texture.Description;
        if (_inputCopy != null && _inputCopyW == desc.Width && _inputCopyH == desc.Height && _inputCopyFormat == desc.Format)
            return;
        _inputCopy?.Dispose();
        _inputCopy = device.CreateTexture2D(new Texture2DDescription
        {
            Width = desc.Width, Height = desc.Height, MipLevels = 1, ArraySize = 1,
            Format = desc.Format,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Default,
            BindFlags = BindFlags.ShaderResource | BindFlags.RenderTarget,
            CPUAccessFlags = CpuAccessFlags.None,
        });
        Log.D("FfmpegEncoder", $"EnsureInputCopy: {desc.Width}x{desc.Height} fmt={desc.Format}");
        _inputCopyW = (int)desc.Width;
        _inputCopyH = (int)desc.Height;
        _inputCopyFormat = desc.Format;
    }

    private void EnsureStaging(ID3D11Device device)
    {
        if (_nv12Staging != null && _stagingW == _width && _stagingH == _height) return;
        _nv12Staging?.Dispose();
        _nv12Staging = device.CreateTexture2D(new Texture2DDescription
        {
            Width = (uint)_width, Height = (uint)_height, MipLevels = 1, ArraySize = 1,
            Format = Format.NV12,
            SampleDescription = new SampleDescription(1, 0),
            Usage = ResourceUsage.Staging,
            BindFlags = BindFlags.None,
            CPUAccessFlags = CpuAccessFlags.Read,
        });
        _stagingW = _width;
        _stagingH = _height;
    }

    private unsafe byte[] PackNv12(MappedSubresource map)
    {
        int srcPitch = (int)map.RowPitch;
        int ySize = _height * _width;
        int totalSize = ySize + _height / 2 * _width;

        if (_nv12Scratch?.Length != totalSize)
            _nv12Scratch = new byte[totalSize];

        var src = (byte*)map.DataPointer.ToPointer();

        // Bulk copy Y plane (1620 individual CopyBlock calls → 1 bulk copy for 1080p)
        int yBytes = ySize;
        if (srcPitch == _width)
        {
            Unsafe.CopyBlockUnaligned(ref _nv12Scratch[0], ref src[0], (uint)yBytes);
        }
        else
        {
            for (int y = 0; y < _height; y++)
                Unsafe.CopyBlockUnaligned(ref _nv12Scratch[y * _width], ref src[y * srcPitch], (uint)_width);
        }

        // Bulk copy UV plane
        int uvSrcBase = srcPitch * _height;
        int uvBytes = _height / 2 * _width;
        if (srcPitch == _width)
        {
            Unsafe.CopyBlockUnaligned(ref _nv12Scratch[yBytes], ref src[uvSrcBase], (uint)uvBytes);
        }
        else
        {
            for (int y = 0; y < _height / 2; y++)
                Unsafe.CopyBlockUnaligned(ref _nv12Scratch[yBytes + y * _width], ref src[uvSrcBase + y * srcPitch], (uint)_width);
        }

        return _nv12Scratch;
    }
}
