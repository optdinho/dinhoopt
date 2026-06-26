using System.Diagnostics;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace DiNho.Capture.Poc.Encoders;

public enum EncoderType { Ffmpeg, FfmpegHw, None }

public sealed class EncoderManager : IDisposable
{
    /// <summary>Vendor → H264 encoder map.</summary>
    public static readonly Dictionary<int, string> VendorCodecs = new()
    {
        [0x10DE] = "h264_nvenc", // NVIDIA
        [0x1002] = "h264_amf",   // AMD
        [0x8086] = "h264_qsv",   // Intel
    };

    /// <summary>Vendor → HEVC encoder map.</summary>
    public static readonly Dictionary<int, string> VendorHevcCodecs = new()
    {
        [0x10DE] = "hevc_nvenc",
        [0x1002] = "hevc_amf",
        [0x8086] = "hevc_qsv",
    };

    /// <summary>Vendor → AV1 encoder map (NVENC only, others fall back to libsvtav1).</summary>
    public static readonly Dictionary<int, string> VendorAv1Codecs = new()
    {
        [0x10DE] = "av1_nvenc",
        [0x1002] = "av1_amf",
        [0x8086] = "libsvtav1",
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

    /// <summary>Return list of GPU adapter names and vendor IDs for the UI dropdown.</summary>
    public static List<(int Index, string Name, int VendorId)> GetGpuList()
    {
        var list = new List<(int, string, int)>();
        try
        {
            using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
            for (int i = 0; factory.EnumAdapters1(i, out var adapter).Success; i++)
            {
                using (adapter)
                {
                    var desc = adapter.Description1;
                    list.Add((i, desc.Description.TrimEnd('\0'), desc.VendorId));
                }
            }
        }
        catch { }
        return list;
    }

    public static string GetPreferredCodec(int vendorId)
    {
        if (vendorId == 0) return "";
        return VendorCodecs.TryGetValue(vendorId, out var codec) ? codec : "";
    }

    /// <summary>Map user-facing codec name (auto/h264/hevc/av1/libx264/libx265) to a concrete
    /// ffmpeg encoder name using the detected GPU vendor. Returns null if the mapping fails
    /// (caller should fall back to DetectBestCodec).</summary>
    public static string? MapUserCodec(string userCodec, int vendorId)
    {
        return userCodec.ToLowerInvariant() switch
        {
            "h264" => GetPreferredCodec(vendorId),
            "hevc" => vendorId == 0 ? "libx265" :
                      VendorHevcCodecs.TryGetValue(vendorId, out var h) ? h : "libx265",
            "av1"  => vendorId == 0 ? "libsvtav1" :
                      VendorAv1Codecs.TryGetValue(vendorId, out var a) ? a : "libsvtav1",
            "libx264" => "libx264",
            "libx265" => "libx265",
            _ => null, // "auto" → caller uses DetectBestCodec
        };
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
