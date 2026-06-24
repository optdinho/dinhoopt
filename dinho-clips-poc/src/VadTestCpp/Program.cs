using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VadTestCpp;

internal class Program
{
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate void AudioCallback(IntPtr data, int length);

    [DllImport("ApplicationLoopback.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern void SetAudioCallback(AudioCallback callback);

    [DllImport("ApplicationLoopback.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int StartCaptureAsync(
        uint processId,
        [MarshalAs(UnmanagedType.Bool)] bool includeProcessTree,
        ushort channel,
        uint sampleRate,
        ushort bitsPerSample);

    [DllImport("ApplicationLoopback.dll", CallingConvention = CallingConvention.StdCall)]
    private static extern int StopCaptureAsync();

    private static int Main(string[] args)
    {
        Console.WriteLine("=== VadTestCpp — C++ DLL VAD Loopback ===");
        Console.WriteLine($"OS: {Environment.OSVersion}");
        Console.WriteLine($".NET: {RuntimeInformation.FrameworkDescription}");
        Console.WriteLine();

        int targetPid = Environment.ProcessId;
        if (args is ["--pid", string pidStr] && int.TryParse(pidStr, out var pid))
            targetPid = pid;

        Console.WriteLine($"Target PID: {targetPid} ({GetProcessName(targetPid)})");
        Console.WriteLine($"Format: 48kHz, stereo, 16-bit PCM");
        Console.WriteLine($"Include tree: true");
        Console.WriteLine();

        long totalBytes = 0;
        int packetCount = 0;
        var sw = Stopwatch.StartNew();

        // Copy da DLL para o output directory
        var dllSrc = Path.Combine(AppContext.BaseDirectory, "ApplicationLoopback.dll");
        if (!File.Exists(dllSrc))
        {
            Console.Error.WriteLine("ApplicationLoopback.dll not found!");
            return 1;
        }

        AudioCallback callback = (data, length) =>
        {
            totalBytes += length;
            packetCount++;
            if (packetCount <= 5 || packetCount % 50 == 0)
                Console.WriteLine($"  Packet #{packetCount}: {length} bytes, total={totalBytes / 1024} KB");
        };

        // Keep GC alive
        var keepAlive = GCHandle.Alloc(callback);

        Console.WriteLine("Setting callback...");
        SetAudioCallback(callback);

        Console.WriteLine($"Calling StartCaptureAsync(PID={targetPid}, includeTree=true, ch=2, SR=48000, bits=16)...");
        Console.WriteLine("(This may block — capture runs on MF work queue)");
        Console.WriteLine();

        // StartCaptureAsync pode bloquear (Sleep infinito no DLL),
        // então rodamos numa thread separada
        var captureThread = new Thread(() =>
        {
            int hr = StartCaptureAsync((uint)targetPid, true, 2, 48000, 16);
            Console.WriteLine($"StartCaptureAsync returned: HR=0x{hr:X8}");
        })
        {
            Name = "CppDllCapture",
            IsBackground = false
        };
        captureThread.Start();

        // Aguarda primeiros pacotes
        Console.WriteLine("Waiting for audio data...");
        Thread.Sleep(3000);

        if (packetCount == 0)
        {
            Console.WriteLine("WARNING: No audio packets received in 3s!");
            Console.WriteLine("Possible issues:");
            Console.WriteLine("  1. Target process is not playing audio");
            Console.WriteLine("  2. DLL compilation differs from source code");
            Console.WriteLine("  3. Windows build incompatibility");
        }

        Console.WriteLine();
        Console.WriteLine($"Captured for {sw.Elapsed.TotalSeconds:F1}s:");
        Console.WriteLine($"  Packets: {packetCount}");
        Console.WriteLine($"  Total data: {totalBytes / 1024} KB ({totalBytes} bytes)");
        Console.WriteLine($"  Avg packet: {(totalBytes > 0 && packetCount > 0 ? totalBytes / packetCount : 0)} bytes");

        Console.WriteLine();
        Console.WriteLine("Stopping capture...");
        int stopHr = StopCaptureAsync();
        Console.WriteLine($"StopCaptureAsync returned: HR=0x{stopHr:X8}");

        keepAlive.Free();
        Console.WriteLine("Done.");
        return packetCount > 0 ? 0 : 1;
    }

    private static string GetProcessName(int pid)
    {
        try { return Process.GetProcessById(pid).ProcessName; }
        catch { return "unknown"; }
    }
}
