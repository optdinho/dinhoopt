using System.Diagnostics;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Encoders;

public enum EncoderType { Ffmpeg, FfmpegHw, None }

public sealed class EncoderManager : IDisposable
{
    public static readonly Dictionary<int, string> VendorCodecs = new()
    {
        [0x10DE] = "h264_nvenc", // NVIDIA
        [0x1002] = "h264_amf",   // AMD
        [0x8086] = "h264_qsv",   // Intel
    };

    public static int DetectGpuVendorId()
    {
        try
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            for (int i = 0; factory.EnumAdapters1(i, out var adapter).Success; i++)
            {
                using (adapter)
                {
                    var desc = adapter.Description1;
                    if (desc.VendorId is 0x10DE or 0x1002 or 0x8086)
                        return desc.VendorId;
                }
            }
        }
        catch { }
        return 0;
    }

    public static string GetPreferredCodec(int vendorId)
    {
        if (vendorId == 0) return "";
        return VendorCodecs.TryGetValue(vendorId, out var codec) ? codec : "";
    }

    public static List<EncoderType> DetectAvailableEncoders()
    {
        var result = new List<EncoderType>();

        if (CheckFfmpegAvailable())
        {
            // Check which codecs ffmpeg supports
            var hasHw = CheckFfmpegEncoder("h264_nvenc") ||
                        CheckFfmpegEncoder("h264_amf") ||
                        CheckFfmpegEncoder("h264_qsv");

            if (hasHw) result.Add(EncoderType.FfmpegHw);
            result.Add(EncoderType.Ffmpeg);
        }

        if (result.Count == 0)
            result.Add(EncoderType.None);

        return result;
    }

    private static bool CheckFfmpegAvailable()
    {
        try
        {
            using var proc = new Process
            {
                StartInfo = new ProcessStartInfo("ffmpeg")
                {
                    Arguments = "-version",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            proc.Start();
            proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(2000);
            return proc.ExitCode == 0;
        }
        catch { return false; }
    }

    private static bool CheckFfmpegEncoder(string enc)
    {
        try
        {
            using var p = new Process
            {
                StartInfo = new ProcessStartInfo("ffmpeg")
                {
                    Arguments = "-encoders",
                    RedirectStandardOutput = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                }
            };
            p.Start();
            var o = p.StandardOutput.ReadToEnd();
            p.WaitForExit(2000);
            return o.Contains(enc, StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static IEncoder CreateBestEncoder(bool forceSoftware = false, ID3D11Device? sharedDevice = null, int bitrateKbps = 2000)
    {
        var available = DetectAvailableEncoders();

        foreach (var type in available)
        {
            if (type == EncoderType.None) continue;
            try { return CreateEncoder(type, sharedDevice, bitrateKbps); }
            catch { continue; }
        }

        throw new InvalidOperationException("No encoder available");
    }

    public static IEncoder CreateEncoder(EncoderType type, ID3D11Device? sharedDevice = null, int bitrateKbps = 2000)
    {
        return type switch
        {
            EncoderType.Ffmpeg => new FfmpegEncoder(useHardware: false),
            EncoderType.FfmpegHw => new FfmpegEncoder(useHardware: true),
            _ => throw new ArgumentOutOfRangeException(nameof(type)),
        };
    }

    public void Dispose() { }
}
