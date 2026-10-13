using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text.Json;
using DiNho.Capture.Poc.Encoders;
using DiNho.Capture.Poc.Ipc;
using DiNho.Capture.Poc.Logging;
using Vortice.Direct3D11;

namespace DiNho.Capture.Poc;

public sealed partial class EngineCoordinator
{
    // Pedido de printscreen pendente. 1 = há um pedido por satisfazer.
    // A hotkey corre na thread do hook; a captura é feita na thread da pipeline,
    // que é quem tem o frame BGRA em mão. Interlocked garante a troca atómica.
    private int _screenshotRequested;

    /// <summary>
    /// Marca um pedido de printscreen. Consumido no próximo frame real da pipeline.
    /// </summary>
    internal void RequestScreenshot()
    {
        Interlocked.Exchange(ref _screenshotRequested, 1);
        Log.I("Screenshot", "Printscreen pedido — será capturado no próximo frame.");
    }

    /// <summary>Consome (atómico) o pedido pendente. True se havia um.</summary>
    internal bool ConsumeScreenshotRequest() =>
        Interlocked.Exchange(ref _screenshotRequested, 0) == 1;

    /// <summary>
    /// Nome do ficheiro PNG de printscreen, ordenável por tempo.
    /// </summary>
    internal static string BuildScreenshotFileName(DateTime timestamp) =>
        $"screenshot-{timestamp.ToString("yyyyMMdd-HHmmss-fff", CultureInfo.InvariantCulture)}.png";

    /// <summary>
    /// Argumentos do ffmpeg para converter um frame BGRA cru (stdin) num PNG.
    /// </summary>
    internal static string BuildScreenshotFfmpegArgs(int width, int height, string outputPath) =>
        $"-y -loglevel error -f rawvideo -pix_fmt bgra -s {width}x{height} -i pipe:0 -frames:v 1 \"{outputPath}\"";

    /// <summary>
    /// Repacka as linhas BGRA removendo o padding de <paramref name="rowPitch"/> para
    /// obter um bloco denso width*4 por linha (o que o rawvideo espera). Puro — testável.
    /// </summary>
    internal static byte[] PackBgraRows(byte[] source, int rowPitch, int width, int height)
    {
        var stride = width * 4;
        var packed = new byte[stride * height];
        for (int y = 0; y < height; y++)
            System.Buffer.BlockCopy(source, y * rowPitch, packed, y * stride, stride);
        return packed;
    }

    /// <summary>
    /// Captura o frame (textura BGRA) para PNG. Corre na thread da pipeline, por isso
    /// nunca propaga exceções — um printscreen falhado não pode derrubar a captura.
    /// </summary>
    private void TryCaptureScreenshot(ID3D11Texture2D texture, int width, int height)
    {
        string? outputPath = null;
        try
        {
            if (width <= 0 || height <= 0)
            {
                BroadcastScreenshotResult(false, null, "Dimensões de frame inválidas");
                return;
            }

            var device = texture.Device;
            if (device is null)
            {
                BroadcastScreenshotResult(false, null, "Textura sem device D3D11");
                return;
            }

            var context = device.ImmediateContext;
            var desc = texture.Description;
            desc.Usage = ResourceUsage.Staging;
            desc.CPUAccessFlags = CpuAccessFlags.Read;
            desc.BindFlags = BindFlags.None;

            byte[] packed;
            using (var staging = device.CreateTexture2D(desc))
            {
                context.CopyResource(staging, texture);
                var mapped = context.Map(staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
                try
                {
                    int rowPitch = (int)mapped.RowPitch;
                    var raw = new byte[rowPitch * height];
                    Marshal.Copy(mapped.DataPointer, raw, 0, raw.Length);
                    packed = rowPitch == width * 4 ? raw : PackBgraRows(raw, rowPitch, width, height);
                }
                finally
                {
                    context.Unmap(staging, 0);
                }
            }

            outputPath = Path.Combine(GetOutputDirectory(), BuildScreenshotFileName(DateTime.Now));
            var psi = FfmpegPathResolver.CreateFfmpegStartInfo(
                args: BuildScreenshotFfmpegArgs(width, height, outputPath),
                redirectInput: true,
                redirectError: true);

            using var proc = new Process { StartInfo = psi };
            proc.Start();
            proc.StandardInput.BaseStream.Write(packed, 0, packed.Length);
            proc.StandardInput.BaseStream.Flush();
            proc.StandardInput.Close();

            if (!proc.WaitForExit(15000))
            {
                try { proc.Kill(entireProcessTree: true); } catch { /* best effort */ }
                BroadcastScreenshotResult(false, outputPath, "ffmpeg excedeu o tempo limite");
                return;
            }

            if (proc.ExitCode != 0 || !File.Exists(outputPath))
            {
                var stderr = proc.StandardError.ReadToEnd();
                BroadcastScreenshotResult(false, outputPath,
                    $"ffmpeg exit {proc.ExitCode}: {stderr.Trim()}");
                return;
            }

            Log.I("Screenshot", $"Printscreen gravado: {outputPath} ({width}x{height})");
            BroadcastScreenshotResult(true, outputPath, null);
        }
        catch (Exception ex)
        {
            Log.E("Screenshot", $"Falha ao gravar printscreen: {ex.GetType().Name}: {ex.Message}");
            BroadcastScreenshotResult(false, outputPath, ex.Message);
        }
    }

    private void BroadcastScreenshotResult(bool success, string? path, string? error)
    {
        try
        {
            var envelope = new IpcEnvelope
            {
                Version = 1,
                Command = "_event",
                Payload = JsonSerializer.SerializeToElement(new
                {
                    type = success ? "screenshotSaved" : "screenshotFailed",
                    path,
                    error,
                })
            };
            _pipeServer.BroadcastRaw(JsonSerializer.Serialize(envelope));
        }
        catch (Exception ex)
        {
            Log.W("Screenshot", $"Falha ao broadcast screenshot: {ex.Message}");
        }
    }
}
