using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VadTest;

[StructLayout(LayoutKind.Sequential)]
internal struct AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
{
    public uint TargetProcessId;
    public uint ProcessLoopbackMode;
}

[StructLayout(LayoutKind.Sequential)]
internal struct AUDIOCLIENT_ACTIVATION_PARAMS
{
    public uint ActivationType;
    public AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS ProcessLoopbackParams;
}

[StructLayout(LayoutKind.Sequential)]
internal struct PROPVARIANT_BLOB
{
    public ushort vt;
    public ushort wReserved1;
    public ushort wReserved2;
    public ushort wReserved3;
    public uint blobCbSize;
    public IntPtr blobData;
}

[StructLayout(LayoutKind.Sequential)]
internal struct WAVEFORMATEX
{
    public ushort wFormatTag;
    public ushort nChannels;
    public uint nSamplesPerSec;
    public uint nAvgBytesPerSec;
    public ushort nBlockAlign;
    public ushort wBitsPerSample;
    public ushort cbSize;
}

[StructLayout(LayoutKind.Sequential)]
internal struct WAVEFORMATEXTENSIBLE
{
    public WAVEFORMATEX Format;
    public ushort wValidBitsPerSample;
    public uint dwChannelMask;
    public Guid SubFormat;
}

[ComImport]
[Guid("1CB9AD4C-DBFA-4C32-B178-C2F568A703B2")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioClient
{
    [PreserveSig] int GetMixFormat(out IntPtr ppFormat);
    [PreserveSig] int GetDevicePeriod(out long defaultPeriod, out long minimumPeriod);
    [PreserveSig] int GetBufferSize(out uint bufferSize);
    [PreserveSig] int GetStreamLatency(out long latency);
    [PreserveSig] int GetCurrentPadding(out uint padding);
    [PreserveSig] int IsFormatSupported(int shareMode, IntPtr pFormat, out IntPtr closestMatch);
    [PreserveSig] int Initialize(int shareMode, int streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, IntPtr audioSessionGuid);
    [PreserveSig] int Stop();
    [PreserveSig] int Start();
    [PreserveSig] int Reset();
    [PreserveSig] int SetEventHandle(IntPtr eventHandle);
    [PreserveSig] int GetService([In] ref Guid riid, [MarshalAs(UnmanagedType.IUnknown)] out object service);
}

[ComImport]
[Guid("C8ADBD64-E71E-48A0-A4DE-185C395CD317")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioCaptureClient
{
    void GetBuffer(out IntPtr pData, out uint framesAvailable, out uint flags, out ulong devicePosition, out ulong qpcPosition);
    void ReleaseBuffer(uint frames);
    void GetNextPacketSize(out uint packetSize);
}

[ComImport]
[Guid("41D949AB-9862-444A-80F6-C261334DA5EB")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IActivateAudioInterfaceCompletionHandler
{
    void ActivateCompleted([MarshalAs(UnmanagedType.IUnknown)] object operation);
}

[ComImport]
[Guid("72A22D78-CDE4-431D-B8CC-843A71199B6D")]
[InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IActivateAudioInterfaceAsyncOperation
{
    void GetActivateResult(out int activateResult, [MarshalAs(UnmanagedType.IUnknown)] out object activatedInterface);
}

internal sealed class ActivateHandler : IActivateAudioInterfaceCompletionHandler
{
    private readonly ManualResetEventSlim _done = new();
    public IAudioClient? AudioClient { get; private set; }
    public int Result { get; private set; } = -1;

    public void ActivateCompleted(object operation)
    {
        try
        {
            var op = (IActivateAudioInterfaceAsyncOperation)operation;
            op.GetActivateResult(out var hr, out var obj);
            Console.WriteLine($"  [ActivateHandler] GetActivateResult: HR=0x{hr:X8}, obj={(obj == null ? "null" : obj.GetType().Name)}");
            Result = hr;
            if (hr == 0 && obj != null)
                AudioClient = (IAudioClient)obj;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  [ActivateHandler] Exception: {ex.Message}");
        }
        _done.Set();
    }

    public bool Wait(int ms) => _done.Wait(ms);
}

internal class Program
{
    private const string VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK = @"VAD\Process_Loopback";
    private static readonly Guid IID_IAudioCaptureClient = new("C8ADBD64-E71E-48A0-A4DE-185C395CD317");

    private const int AUDCLNT_SHAREMODE_SHARED = 0;
    private const int AUDCLNT_STREAMFLAGS_EVENTCALLBACK = 0x40000;
    private const int AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM = 0x8000000;
    private const int WAIT_TIMEOUT_MS = 10000;

    private static readonly (string desc, ushort tag, ushort bits, ushort channels, ushort blockAlign, uint avgBytes)[] FormatVariations =
    [
        ("PCM 48kHz 16bit stereo", 1, 16, 2, 4, 192000u),
        ("PCM 48kHz 32bit stereo", 1, 32, 2, 8, 384000u),
        ("PCM 44.1kHz 16bit stereo", 1, 16, 2, 4, 176400u),
        ("PCM 48kHz 16bit mono", 1, 16, 1, 2, 96000u),
        ("IEEE float 48kHz 32bit stereo", 3, 32, 2, 8, 384000u),
        ("IEEE float 44.1kHz 32bit stereo", 3, 32, 2, 8, 352800u),
        ("IEEE float 48kHz 32bit mono", 3, 32, 1, 4, 192000u),
    ];

    private static void Main(string[] args)
    {
        Console.WriteLine("=== VAD Process Loopback Test ===");
        Console.WriteLine($"OS: {Environment.OSVersion}");
        Console.WriteLine($".NET: {RuntimeInformation.FrameworkDescription}");
        Console.WriteLine($"Arch: {RuntimeInformation.ProcessArchitecture}");
        Console.WriteLine();

        // Parse arguments
        int targetPid = Environment.ProcessId;
        string? targetProcessName = null;

        if (args.Length > 0 && args[0] is "--help" or "-h" or "/?")
        {
            Console.WriteLine("Usage: VadTest [--pid <PID>] [--name <processname>]");
            Console.WriteLine("  If no PID specified, uses current process.");
            Console.WriteLine("  If --name specified, finds first process with that name.");
            return;
        }

        if (args is ["--pid", string pidStr] && int.TryParse(pidStr, out var pid))
            targetPid = pid;
        else if (args is ["--name", string name])
        {
            targetProcessName = name;
            var procs = Process.GetProcessesByName(name);
            if (procs.Length > 0)
            {
                targetPid = procs[0].Id;
                Console.WriteLine($"Found process '{name}' with PID={targetPid}");
            }
            else
            {
                Console.WriteLine($"Process '{name}' not found. Using current process.");
                targetPid = Environment.ProcessId;
            }
        }

        try
        {
            var proc = Process.GetProcessById(targetPid);
            Console.WriteLine($"Target: {proc.ProcessName} (PID={targetPid})");
        }
        catch
        {
            Console.WriteLine($"Target: PID={targetPid} (process not found, will still try)");
        }

        Console.WriteLine();

        // --- Test 1: Activate WITH activation params ---
        Console.WriteLine("=== Test 1: ActivateAudioInterfaceAsync WITH activation params (INCLUDE mode) ===");
        var clientWithParams = ActivateWithParams(targetPid, include: true);

        // --- Test 2: Activate WITH activation params (EXCLUDE mode) ---
        Console.WriteLine();
        Console.WriteLine("=== Test 2: ActivateAudioInterfaceAsync WITH activation params (EXCLUDE mode) ===");
        var clientExclude = ActivateWithParams(targetPid, include: false);

        // --- Test 3: Activate WITHOUT activation params (diagnostic) ---
        Console.WriteLine();
        Console.WriteLine("=== Test 3: ActivateAudioInterfaceAsync WITHOUT activation params ===");
        var clientNoParams = ActivateWithoutParams();

        // Test Initialize on whichever activation succeeded
        var testClients = new List<(string label, IAudioClient? client)>
        {
            ("WITH params (INCLUDE)", clientWithParams),
            ("WITH params (EXCLUDE)", clientExclude),
            ("WITHOUT params", clientNoParams),
        };

        foreach (var (label, client) in testClients)
        {
            if (client == null)
            {
                Console.WriteLine($"\n  [{label}] No IAudioClient available, skipping Initialize tests.");
                continue;
            }

            Console.WriteLine($"\n=== Initialize tests: {label} ===");

            // First, try GetMixFormat
            Console.WriteLine("  GetMixFormat:");
            int hr = client.GetMixFormat(out var mixFmtPtr);
            Console.WriteLine($"    HR=0x{hr:X8} ({(hr == 0 ? "OK" : HrMessage(hr))})");
            if (hr == 0 && mixFmtPtr != IntPtr.Zero)
            {
                var wfx = Marshal.PtrToStructure<WAVEFORMATEX>(mixFmtPtr);
                Console.WriteLine($"    Format: tag=0x{wfx.wFormatTag:X4} SR={wfx.nSamplesPerSec} ch={wfx.nChannels} bits={wfx.wBitsPerSample} block={wfx.nBlockAlign} avg={wfx.nAvgBytesPerSec} cbSize={wfx.cbSize}");
                Marshal.FreeCoTaskMem(mixFmtPtr);
            }
            else if (hr == 0)
            {
                Console.WriteLine("    MixFormat returned null pointer");
            }
            else
            {
                Console.WriteLine($"    MixFormat unavailable - will try hardcoded formats");
            }

            Console.WriteLine("  GetDevicePeriod:");
            hr = client.GetDevicePeriod(out var defPeriod, out var minPeriod);
            Console.WriteLine($"    HR=0x{hr:X8} ({(hr == 0 ? "OK" : HrMessage(hr))}) def={defPeriod} min={minPeriod}");

            Console.WriteLine("  GetBufferSize:");
            hr = client.GetBufferSize(out var bufSize);
            Console.WriteLine($"    HR=0x{hr:X8} ({(hr == 0 ? "OK" : HrMessage(hr))}) size={bufSize}");

            // Try Initialize with IntPtr.Zero session GUID (nullptr, like C++ sample)
            Console.WriteLine();
            Console.WriteLine("  -- Initialize attempts with IntPtr.Zero session GUID --");
            var sessionGuidZero = IntPtr.Zero;

            foreach (var (desc, tag, bits, ch, blockAlign, avgBytes) in FormatVariations)
            {
                var fmt = new WAVEFORMATEX
                {
                    wFormatTag = tag,
                    nChannels = ch,
                    nSamplesPerSec = 48000,
                    wBitsPerSample = bits,
                    nBlockAlign = blockAlign,
                    nAvgBytesPerSec = avgBytes,
                    cbSize = 0
                };
                IntPtr fmtPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WAVEFORMATEX>());
                Marshal.StructureToPtr(fmt, fmtPtr, false);

                hr = client.Initialize(AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                    0, 0, fmtPtr, sessionGuidZero);
                Console.WriteLine($"    Initialize({desc}): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");
                Marshal.FreeHGlobal(fmtPtr);

                if (hr == 0) break;
            }

            // Try NULL format with various flags
            Console.WriteLine("  -- Initialize attempts with NULL format --");
            foreach (var (flagsLabel, flags) in new[] {
                ("EVENTCALLBACK|AUTOCONVERTPCM", AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM),
                ("AUTOCONVERTPCM only", AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM),
                ("EVENTCALLBACK only", AUDCLNT_STREAMFLAGS_EVENTCALLBACK),
                ("no flags (bare)", 0),
            })
            {
                hr = client.Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 0, 0, IntPtr.Zero, sessionGuidZero);
                Console.WriteLine($"    Initialize(NULL, {flagsLabel}): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");
                if (hr == 0) break;
            }

            // Try manual vtable call (bypass CLR COM marshalling)
            Console.WriteLine("  -- Manual vtable Initialize call (bypass CLR COM) --");
            TestInitializeViaVtable(client);

            // Try WAVEFORMATEXTENSIBLE
            Console.WriteLine("  -- Initialize attempts with WAVEFORMATEXTENSIBLE --");
            var ext = new WAVEFORMATEXTENSIBLE
            {
                Format = new WAVEFORMATEX
                {
                    wFormatTag = 0xFFFE,
                    nChannels = 2,
                    nSamplesPerSec = 48000,
                    wBitsPerSample = 32,
                    nBlockAlign = 8,
                    nAvgBytesPerSec = 384000,
                    cbSize = 22,
                },
                wValidBitsPerSample = 32,
                dwChannelMask = 3,
                SubFormat = new Guid("00000003-0000-0010-8000-00AA00389B71"),
            };
            IntPtr extPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WAVEFORMATEXTENSIBLE>());
            Marshal.StructureToPtr(ext, extPtr, false);
            hr = client.Initialize(AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                0, 0, extPtr, sessionGuidZero);
            Console.WriteLine($"    Initialize(EXTENSIBLE float): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");
            Marshal.FreeHGlobal(extPtr);

            if (hr == 0)
            {
                Console.WriteLine("\n  >>> Initialize EXITOSO! Testando captura...");
                TestCapture(client, waitForEvent: false);
            }
            else
            {
                // Try capture WITHOUT Initialize (Start returned S_OK in vtable test)
                Console.WriteLine("\n  >>> Initialize falhou. Testando captura SEM Initialize (Start direto) <<<");
                TestCapture(client, waitForEvent: false, skipInitialize: true);
            }

            Console.WriteLine($"\n  --- Cleaning up {label} ---");
            client.Stop();
            if (hr != 0)
            {
                // Stop via COM too
                try { client.Stop(); } catch { }
            }
        }

        // --- Test 4: Real audio device (validation of our COM interface) ---
        Console.WriteLine();
        Console.WriteLine("=== Test 4: Real audio device (validate COM interface definition) ===");
        TestRealDevice();

        Console.WriteLine("\n=== Teste concluido ===");
    }

    private static IAudioClient? ActivateWithParams(int targetPid, bool include)
    {
        string mode = include ? "INCLUDE" : "EXCLUDE";
        Console.WriteLine($"  Mode: {mode}, PID={targetPid}");

        unsafe
        {
            int paramsSize = sizeof(AUDIOCLIENT_ACTIVATION_PARAMS);
            int pvSize = sizeof(PROPVARIANT_BLOB);

            byte* block = (byte*)NativeMemory.AllocZeroed((nuint)(pvSize + paramsSize));
            byte* pvPtr = block;
            byte* apPtr = block + pvSize;

            uint loopbackMode = include ? 0u : 1u;
            var ap = (AUDIOCLIENT_ACTIVATION_PARAMS*)apPtr;
            *ap = new AUDIOCLIENT_ACTIVATION_PARAMS
            {
                ActivationType = 1,
                ProcessLoopbackParams = new AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS
                {
                    TargetProcessId = (uint)targetPid,
                    ProcessLoopbackMode = loopbackMode,
                }
            };

            var pv = (PROPVARIANT_BLOB*)pvPtr;
            *pv = new PROPVARIANT_BLOB
            {
                vt = 0x0041, // VT_BLOB
                blobCbSize = (uint)paramsSize,
                blobData = (IntPtr)apPtr,
            };

            Console.WriteLine($"  PROPVARIANT at 0x{(nuint)pvPtr:X}, size={pvSize}");
            Console.WriteLine($"  ActivationParams at 0x{(nuint)apPtr:X}, size={paramsSize}");
            Console.WriteLine($"  vt=0x{pv->vt:X4} blobCbSize={pv->blobCbSize} blobData=0x{(nuint)pv->blobData:X}");
            Console.WriteLine($"  ActivationType={ap->ActivationType} TargetProcessId={ap->ProcessLoopbackParams.TargetProcessId} ProcessLoopbackMode={ap->ProcessLoopbackParams.ProcessLoopbackMode}");

            var handler = new ActivateHandler();
            var handlerPtr = Marshal.GetComInterfaceForObject(handler, typeof(IActivateAudioInterfaceCompletionHandler));
            var audioClientIid = typeof(IAudioClient).GUID;
            Console.WriteLine($"  Calling ActivateAudioInterfaceAsync(device='{VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK}', riid={audioClientIid})...");

            int hr = ActivateAudioInterfaceAsync(
                VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, ref audioClientIid,
                (IntPtr)pvPtr, handlerPtr, out var asyncOp);

            Marshal.Release(handlerPtr);

            Console.WriteLine($"  Sync return: HR=0x{hr:X8} ({(hr == 0 ? "OK" : HrMessage(hr))}), asyncOp={asyncOp}");

            if (hr != 0)
            {
                Console.Error.WriteLine($"  ActivateAudioInterfaceAsync retornou erro sincrono");
                NativeMemory.Free(block);
                return null;
            }

            Console.WriteLine($"  Aguardando callback (timeout={WAIT_TIMEOUT_MS}ms)...");
            bool signaled = handler.Wait(WAIT_TIMEOUT_MS);

            NativeMemory.Free(block);

            if (!signaled)
            {
                Console.Error.WriteLine("  TIMEOUT - callback never arrived!");
                return null;
            }

            Console.WriteLine($"  Async result: HR=0x{handler.Result:X8} ({(handler.Result == 0 ? "OK" : HrMessage(handler.Result))})");
            Console.WriteLine($"  AudioClient: {(handler.AudioClient == null ? "null" : "OK")}");

            return handler.AudioClient;
        }
    }

    private static IAudioClient? ActivateWithoutParams()
    {
        Console.WriteLine("  Trying ActivateAudioInterfaceAsync WITHOUT activation params...");

        var handler = new ActivateHandler();
        var handlerPtr = Marshal.GetComInterfaceForObject(handler, typeof(IActivateAudioInterfaceCompletionHandler));
        var audioClientIid = typeof(IAudioClient).GUID;

        int hr = ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK, ref audioClientIid,
            IntPtr.Zero, handlerPtr, out var asyncOp);

        Marshal.Release(handlerPtr);

        Console.WriteLine($"  Sync return: HR=0x{hr:X8} ({(hr == 0 ? "OK" : HrMessage(hr))})");

        if (hr != 0)
            return null;

        Console.WriteLine($"  Aguardando callback (timeout={WAIT_TIMEOUT_MS}ms)...");
        bool signaled = handler.Wait(WAIT_TIMEOUT_MS);

        if (!signaled)
        {
            Console.Error.WriteLine("  TIMEOUT - callback never arrived!");
            return null;
        }

        Console.WriteLine($"  Async result: HR=0x{handler.Result:X8} ({(handler.Result == 0 ? "OK" : HrMessage(handler.Result))})");
        Console.WriteLine($"  AudioClient: {(handler.AudioClient == null ? "null" : "OK")}");

        return handler.AudioClient;
    }

    private static void TestCapture(IAudioClient client, bool waitForEvent = true, bool skipInitialize = false)
    {
        Console.WriteLine($"  Setting up capture (skipInitialize={skipInitialize}, waitForEvent={waitForEvent})...");

        // SetEventHandle (skip if waitForEvent=false)
        IntPtr eventHandle = IntPtr.Zero;
        if (waitForEvent)
        {
            eventHandle = CreateEventW(IntPtr.Zero, false, false, null);
            if (eventHandle != IntPtr.Zero)
            {
                int hr = client.SetEventHandle(eventHandle);
                if (hr != 0)
                {
                    Console.WriteLine($"    SetEventHandle: HR=0x{hr:X8} ({HrMessage(hr)}) - using polling");
                    CloseHandle(eventHandle);
                    eventHandle = IntPtr.Zero;
                }
                else
                    Console.WriteLine("    SetEventHandle: OK");
            }
        }
        else
        {
            Console.WriteLine("    SetEventHandle: skipped (polling mode forced)");
        }

        var captureClientGuid = IID_IAudioCaptureClient;
        int hr2 = client.GetService(ref captureClientGuid, out var capObj);
        if (hr2 != 0)
        {
            Console.WriteLine($"    GetService: HR=0x{hr2:X8} ({HrMessage(hr2)}) - cannot capture");
            if (eventHandle != IntPtr.Zero) CloseHandle(eventHandle);
            return;
        }
        var captureClient = (IAudioCaptureClient)capObj;
        Console.WriteLine("    GetService: OK (IAudioCaptureClient obtained)");

        hr2 = client.Start();
        if (hr2 != 0)
        {
            Console.WriteLine($"    Start: HR=0x{hr2:X8} ({HrMessage(hr2)}) - cannot capture");
            return;
        }
        Console.WriteLine("    Start: OK - capturing for 5 seconds...");

        // Capture loop
        int packetsReceived = 0;
        int emptyPolls = 0;
        var sw = Stopwatch.StartNew();
        bool eventDriven = eventHandle != IntPtr.Zero;

        while (sw.ElapsedMilliseconds < 5000 && packetsReceived < 50)
        {
            if (eventDriven)
            {
                uint waitResult = WaitForSingleObject(eventHandle, 500);
                if (waitResult != 0) { emptyPolls++; continue; }
            }
            else
            {
                Thread.Sleep(10);
            }

            captureClient.GetNextPacketSize(out var nextSize);

            if (nextSize > 0)
            {
                packetsReceived++;
                captureClient.GetBuffer(out var dataPtr, out var frames,
                    out var flags, out var devPos, out var qpcPos);

                bool isSilence = (flags & 0x08) != 0;
                if (packetsReceived <= 3 || packetsReceived % 10 == 0)
                    Console.WriteLine($"    Packet #{packetsReceived}: frames={frames} flags=0x{flags:X} data=0x{(nuint)dataPtr:X} devPos={devPos} {(isSilence ? "[SILENCE]" : "[DATA]")}");

                captureClient.ReleaseBuffer(frames);
                captureClient.GetNextPacketSize(out nextSize);
            }
            else
            {
                emptyPolls++;
                if (emptyPolls % 100 == 0)
                    Console.WriteLine($"    Empty polls: {emptyPolls} ({(eventDriven ? "event" : "polling")} mode, elapsed={sw.ElapsedMilliseconds}ms)");
            }
        }

        Console.WriteLine($"    Capture result: {packetsReceived} packets, {emptyPolls} empty polls in {sw.ElapsedMilliseconds}ms");

        // Stop
        client.Stop();
        if (eventHandle != IntPtr.Zero) CloseHandle(eventHandle);
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int InitializeDelegate(IntPtr thisPtr, int shareMode, int streamFlags, long hnsBufferDuration, long hnsPeriodicity, IntPtr pFormat, IntPtr audioSessionGuid);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetMixFormatDelegate(IntPtr thisPtr, out IntPtr ppFormat);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetDevicePeriodDelegate(IntPtr thisPtr, out long defaultPeriod, out long minimumPeriod);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int GetBufferSizeDelegate(IntPtr thisPtr, out uint bufferSize);

    private static unsafe void TestInitializeViaVtable(IAudioClient client)
    {
        // Get raw COM interface pointer
        IntPtr comPtr = Marshal.GetComInterfaceForObject(client, typeof(IAudioClient));
        if (comPtr == IntPtr.Zero)
        {
            Console.WriteLine("    Failed to get raw COM pointer");
            return;
        }

        try
        {
            // Read vtable pointer (first field of COM object)
            IntPtr vtablePtr = Marshal.ReadIntPtr(comPtr);
            Console.WriteLine($"    Raw COM pointer: 0x{(nuint)comPtr:X}");
            Console.WriteLine($"    Vtable pointer: 0x{(nuint)vtablePtr:X}");

            // Slot 3 = GetMixFormat (0-indexed: slot 3 after IUnknown's 3 = vtable[3])
            IntPtr getMixFormatPtr = Marshal.ReadIntPtr(vtablePtr, 3 * IntPtr.Size);
            var getMixFormat = Marshal.GetDelegateForFunctionPointer<GetMixFormatDelegate>(getMixFormatPtr);
            int hr = getMixFormat(comPtr, out var fmtPtr);
            Console.WriteLine($"    Manual GetMixFormat (slot 3): HR=0x{hr:X8} ({HrMessage(hr)})");

            // Slot 4 = GetDevicePeriod
            IntPtr getDevicePeriodPtr = Marshal.ReadIntPtr(vtablePtr, 4 * IntPtr.Size);
            var getDevicePeriod = Marshal.GetDelegateForFunctionPointer<GetDevicePeriodDelegate>(getDevicePeriodPtr);
            hr = getDevicePeriod(comPtr, out var defPeriod, out var minPeriod);
            Console.WriteLine($"    Manual GetDevicePeriod (slot 4): HR=0x{hr:X8} ({HrMessage(hr)}) def={defPeriod} min={minPeriod}");

            // Slot 5 = GetBufferSize
            IntPtr getBufferSizePtr = Marshal.ReadIntPtr(vtablePtr, 5 * IntPtr.Size);
            var getBufferSize = Marshal.GetDelegateForFunctionPointer<GetBufferSizeDelegate>(getBufferSizePtr);
            hr = getBufferSize(comPtr, out var bufSize);
            Console.WriteLine($"    Manual GetBufferSize (slot 5): HR=0x{hr:X8} ({HrMessage(hr)}) size={bufSize}");

            // Slot 9 = Initialize (0-indexed: 3 + 6 = 9)
            IntPtr initFuncPtr = Marshal.ReadIntPtr(vtablePtr, 9 * IntPtr.Size);
            Console.WriteLine($"    Manual Initialize func ptr: 0x{(nuint)initFuncPtr:X}");

            var initialize = Marshal.GetDelegateForFunctionPointer<InitializeDelegate>(initFuncPtr);

            var fmt = new WAVEFORMATEX
            {
                wFormatTag = 1,
                nChannels = 2,
                nSamplesPerSec = 48000,
                wBitsPerSample = 16,
                nBlockAlign = 4,
                nAvgBytesPerSec = 192000,
                cbSize = 0
            };
            IntPtr fmtPtr2 = Marshal.AllocHGlobal(Marshal.SizeOf<WAVEFORMATEX>());
            Marshal.StructureToPtr(fmt, fmtPtr2, false);

            // Try IntPtr.Zero for session GUID
            hr = initialize(comPtr, 0 /*SHARED*/,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                0, 0, fmtPtr2, IntPtr.Zero);
            Console.WriteLine($"    Manual Initialize (PCM, nullptr session): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");

            if (hr != 0)
            {
                // Try without any flags
                hr = initialize(comPtr, 0 /*SHARED*/, 0, 0, 0, fmtPtr2, IntPtr.Zero);
                Console.WriteLine($"    Manual Initialize (PCM, no flags): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");
            }

            if (hr != 0)
            {
                // Try NULL format
                hr = initialize(comPtr, 0 /*SHARED*/, 0, 0, 0, IntPtr.Zero, IntPtr.Zero);
                Console.WriteLine($"    Manual Initialize (NULL, no flags): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");
            }

            if (hr != 0)
            {
                // Try with 100ns durations (100000 = 10ms)
                hr = initialize(comPtr, 0 /*SHARED*/,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                    100000, 100000, fmtPtr2, IntPtr.Zero);
                Console.WriteLine($"    Manual Initialize (PCM, 10ms period): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");
            }

            Marshal.FreeHGlobal(fmtPtr2);

            // Also try calling Stop/Start via vtable to verify those slots
            // Slot 9 (SDK) = Start
            IntPtr startFuncSdk9 = Marshal.ReadIntPtr(vtablePtr, 9 * IntPtr.Size);
            Console.WriteLine($"    SDK Start (slot 9) func ptr: 0x{(nuint)startFuncSdk9:X}");
            var startDelSdk9 = Marshal.GetDelegateForFunctionPointer<StartDelegate>(startFuncSdk9);
            hr = startDelSdk9(comPtr);
            Console.WriteLine($"    Manual SDK Start (slot 9): HR=0x{hr:X8} ({HrMessage(hr)})");

            // SDK Slot 10 = Stop
            IntPtr stopFuncPtr = Marshal.ReadIntPtr(vtablePtr, 10 * IntPtr.Size);
            var stopDel = Marshal.GetDelegateForFunctionPointer<StopDelegate>(stopFuncPtr);
            hr = stopDel(comPtr);
            Console.WriteLine($"    Manual SDK Stop (slot 10): HR=0x{hr:X8} ({HrMessage(hr)})");

            // SDK Slot 11 = Reset
            IntPtr resetFuncPtr = Marshal.ReadIntPtr(vtablePtr, 11 * IntPtr.Size);
            var resetDel = Marshal.GetDelegateForFunctionPointer<StartDelegate>(resetFuncPtr);
            hr = resetDel(comPtr);
            Console.WriteLine($"    Manual SDK Reset (slot 11): HR=0x{hr:X8} ({HrMessage(hr)})");

            // SDK Slot 12 = SetEventHandle
            // (skip this one)

            // SDK Slot 13 = GetService
            IntPtr getServiceFuncPtr = Marshal.ReadIntPtr(vtablePtr, 13 * IntPtr.Size);
            Console.WriteLine($"    SDK GetService (slot 13) func ptr: 0x{(nuint)getServiceFuncPtr:X}");

            // SDK Slot 14 = Initialize (THE REAL Initialize!)
            IntPtr realInitFuncPtr = Marshal.ReadIntPtr(vtablePtr, 14 * IntPtr.Size);
            Console.WriteLine($"\n    *** SDK Initialize (slot 14) func ptr: 0x{(nuint)realInitFuncPtr:X} ***");
            Console.WriteLine($"    *** (Compare with our slot 9 ptr 0x{(nuint)initFuncPtr:X}) ***");

            var realInitialize = Marshal.GetDelegateForFunctionPointer<InitializeDelegate>(realInitFuncPtr);
            IntPtr fmtPtr3 = Marshal.AllocHGlobal(Marshal.SizeOf<WAVEFORMATEX>());
            Marshal.StructureToPtr(fmt, fmtPtr3, false);
            hr = realInitialize(comPtr, 0 /*SHARED*/,
                AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                0, 0, fmtPtr3, IntPtr.Zero);
            Console.WriteLine($"    *** SDK Initialize (slot 14, PCM): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))} ***");

            if (hr != 0)
            {
                hr = realInitialize(comPtr, 0, 0, 0, 0, IntPtr.Zero, IntPtr.Zero);
                Console.WriteLine($"    *** SDK Initialize (slot 14, NULL fmt, no flags): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))} ***");
            }
            Marshal.FreeHGlobal(fmtPtr3);

            Console.WriteLine("    Manual vtable test complete.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"    Manual vtable exception: {ex.GetType().Name}: {ex.Message}");
        }
        finally
        {
            Marshal.Release(comPtr);
        }
    }

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int StopDelegate(IntPtr thisPtr);

    [UnmanagedFunctionPointer(CallingConvention.StdCall)]
    private delegate int StartDelegate(IntPtr thisPtr);

    private static string HrMessage(int hr)
    {
        return unchecked((uint)hr) switch
        {
            0x80004001 => "E_NOTIMPL",
            0x80004002 => "E_NOINTERFACE",
            0x80004005 => "E_FAIL",
            0x80070057 => "E_INVALIDARG",
            0x8007000E => "E_OUTOFMEMORY",
            0x88890001 => "AUDCLNT_E_NOT_STOPPED",
            0x8889000A => "AUDCLNT_E_BUFFER_ERROR",
            0x88890008 => "AUDCLNT_E_BUFFER_SIZE_ERROR",
            0x88890011 => "AUDCLNT_E_EVENTHANDLE_NOT_SET",
            0x88890013 => "AUDCLNT_E_INVALID_DEVICE_PERIOD",
            0x88890014 => "AUDCLNT_E_EXCLUSIVE_MODE_NOT_ALLOWED",
            0x88890015 => "AUDCLNT_E_BUFDURATION_PERIOD_NOT_EQUAL",
            0x88890016 => "AUDCLNT_E_SERVICE_NOT_RUNNING",
            0x88890021 => "AUDCLNT_E_NOT_INITIALIZED",
            0x88890023 => "AUDCLNT_E_INVALID_STREAM_FLAG",
            _ => $"HR=0x{hr:X8}",
        };
    }

    private static void TestRealDevice()
    {
        try
        {
            using var enumerator = new NAudio.CoreAudioApi.MMDeviceEnumerator();
            var defaultDev = enumerator.GetDefaultAudioEndpoint(
                NAudio.CoreAudioApi.DataFlow.Render,
                NAudio.CoreAudioApi.Role.Multimedia);
            var deviceId = defaultDev.ID;
            var deviceName = defaultDev.FriendlyName;

            Console.WriteLine($"  Default render device: '{deviceName}'");
            Console.WriteLine($"  Device ID: {deviceId}");

            var handler = new ActivateHandler();
            var handlerPtr = Marshal.GetComInterfaceForObject(handler, typeof(IActivateAudioInterfaceCompletionHandler));
            var audioClientIid = typeof(IAudioClient).GUID;

            int hr = ActivateAudioInterfaceAsync(
                deviceId, ref audioClientIid,
                IntPtr.Zero, handlerPtr, out var asyncOp);

            Marshal.Release(handlerPtr);

            Console.WriteLine($"  Sync return: HR=0x{hr:X8} ({(hr == 0 ? "OK" : HrMessage(hr))})");

            if (hr != 0 || !handler.Wait(WAIT_TIMEOUT_MS) || handler.AudioClient == null)
            {
                Console.WriteLine("  Failed to activate real device.");
                return;
            }

            var client = handler.AudioClient;
            Console.WriteLine("  Real device activated!");

            // Test GetMixFormat (should work on real device)
            hr = client.GetMixFormat(out var fmtPtr);
            Console.WriteLine($"  GetMixFormat: HR=0x{hr:X8}");
            if (hr == 0 && fmtPtr != IntPtr.Zero)
            {
                var wfx = Marshal.PtrToStructure<WAVEFORMATEX>(fmtPtr);
                Console.WriteLine($"    Format: tag=0x{wfx.wFormatTag:X4} SR={wfx.nSamplesPerSec} ch={wfx.nChannels} bits={wfx.wBitsPerSample}");
                Marshal.FreeCoTaskMem(fmtPtr);

                // Now try Initialize with the real format
                IntPtr clonePtr = Marshal.AllocHGlobal(Marshal.SizeOf<WAVEFORMATEX>());
                Marshal.StructureToPtr(wfx, clonePtr, false);
                hr = client.Initialize(AUDCLNT_SHAREMODE_SHARED,
                    AUDCLNT_STREAMFLAGS_EVENTCALLBACK | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                    0, 0, clonePtr, IntPtr.Zero);
                Console.WriteLine($"  Initialize (real fmt): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");
                Marshal.FreeHGlobal(clonePtr);
            }
            else
            {
                // Try without mix format
                hr = client.Initialize(AUDCLNT_SHAREMODE_SHARED, 0, 0, 0, IntPtr.Zero, IntPtr.Zero);
                Console.WriteLine($"  Initialize (NULL): HR=0x{hr:X8} {(hr == 0 ? "<<< OK >>>" : HrMessage(hr))}");
            }

            hr = client.GetBufferSize(out var bufSize);
            Console.WriteLine($"  GetBufferSize: HR=0x{hr:X8} size={bufSize}");

            // Test GetDevicePeriod
            hr = client.GetDevicePeriod(out var defPeriod, out var minPeriod);
            Console.WriteLine($"  GetDevicePeriod: HR=0x{hr:X8} def={defPeriod} min={minPeriod}");

            client.Stop();
            Console.WriteLine("  Real device test complete.");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"  Real device test exception: {ex.GetType().Name}: {ex.Message}");
        }
    }

    [DllImport("mmdevapi.dll", ExactSpelling = true)]
    private static extern int ActivateAudioInterfaceAsync(
        [MarshalAs(UnmanagedType.LPWStr)] string deviceInterfacePath,
        [In] ref Guid riid,
        IntPtr activationParams,
        IntPtr completionHandler,
        [MarshalAs(UnmanagedType.IUnknown)] out object activationOperation);

    [DllImport("kernel32.dll", ExactSpelling = true)]
    private static extern IntPtr CreateEventW(IntPtr lpEventAttributes, bool bManualReset, bool bInitialState, string? lpName);

    [DllImport("kernel32.dll", ExactSpelling = true)]
    private static extern uint WaitForSingleObject(IntPtr hHandle, uint dwMilliseconds);

    [DllImport("kernel32.dll", ExactSpelling = true)]
    private static extern bool CloseHandle(IntPtr hObject);
}
