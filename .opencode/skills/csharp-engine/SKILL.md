---
name: csharp-engine
description: "C# engine patterns for DiNho Optimizer: partial classes, COM interop, TDD seams, FFmpeg args, build/publish/deploy cycle. Use when modifying dinho-clips-poc/ C# code."
origin: project
date_added: "2026-08-18"
---

# C# Engine Patterns

Expert C# engine development for DiNho Optimizer's clips capture system (`dinho-clips-poc/`).

## When to Activate

- Modifying `EngineCoordinator.cs` or its partials
- Adding/changing FFmpeg encoder arguments
- Working with WGC/D3D11/COM interop
- Adding C# unit tests
- Building/publishing the engine
- Debugging engine crashes or restart loops

## Do NOT Use When

- Working on Electron/TypeScript code (use `electron-ipc`)
- Fixing build errors only (use `build-error-resolver`)
- Debugging runtime logs (use `debug-runtime`)

## Project Structure

```
dinho-clips-poc/
├── src/DiNho.Capture.Poc/
│   ├── EngineCoordinator.cs              ← orchestrator (partial)
│   ├── EngineCoordinator.Capture.cs      ← capture pipeline
│   ├── EngineCoordinator.Audio.cs        ← audio mixing
│   ├── EngineCoordinator.Export.cs       ← clip export
│   ├── EngineCoordinator.Game.cs         ← game detection
│   ├── IpcMessageHandler.cs              ← pipe command dispatch
│   ├── Config/ConfigManager.cs           ← config validation
│   ├── Capture/
│   │   ├── WgcCaptureSource.cs           ← Windows Graphics Capture
│   │   ├── TexturePool.cs                ← D3D11 texture pool
│   │   └── WindowsMessagePump.cs         ← STA thread pump
│   ├── Encoders/
│   │   ├── FfmpegEncoder.cs              ← video encoding
│   │   ├── FfmpegEncoder.NalParsing.cs   ← NAL unit parsing
│   │   ├── FfmpegAacEncoder.cs           ← audio encoding
│   │   └── EncoderManager.cs             ← codec detection
│   ├── Buffer/
│   │   ├── ReplayBuffer.cs               ← circular buffer
│   │   └── DiskSpillBuffer.cs            ← disk overflow
│   └── Export/
│       └── ClipExporter.cs               ← Matroska + MP4 mux
├── tests/DiNho.Capture.Poc.Tests/
│   ├── FfmpegEncoderTests.cs
│   ├── EngineCoordinatorCaptureTests.cs
│   └── ReplayBufferTests.cs
└── DiNho.Capture.Poc.csproj
```

## Partial Class Convention

`EngineCoordinator` is split into partials by domain:

| File | Domain |
|------|--------|
| `EngineCoordinator.cs` | Core lifecycle, fields, constructors |
| `EngineCoordinator.Capture.cs` | Capture pipeline, PipelineLoop, watchdog |
| `EngineCoordinator.Audio.cs` | AudioMixer, mic, loopback |
| `EngineCoordinator.Export.cs` | SaveClip, ExportToMp4 |
| `EngineCoordinator.Game.cs` | Game detection, process lookup |
| `EngineCoordinator.CaptureSource.cs` | WGC/DXGI source selection |

**Rule**: Add code to the correct partial. Never merge partials.

## TDD Seams Pattern

For testability without GPU/process dependencies:

```csharp
// Static seam — replaceable in tests via reflection
internal static Func<uint, bool> IsProcessAliveProbe { get; set; } = pid => {
    // Production: P/Invoke OpenProcess
    var h = Interop.OpenProcess(0x1000, false, pid);
    // ...
};

// In tests:
var original = EngineCoordinator.IsProcessAliveProbe;
try {
    EngineCoordinator.IsProcessAliveProbe = pid => pid == 1234;
    // test logic
} finally {
    EngineCoordinator.IsProcessAliveProbe = original;
}
```

**Pattern**: `internal static Func<T,R> NameProbe { get; set; } = defaultValue;`

## FFmpeg Args by Codec

### NVENC (NVIDIA)
```
-c:v h264_nvenc -preset p4 -tune hq -rc cqp -cq {cq}
-bf 2 -g 120 -rc-lookahead 16 -spatial-aq 1 -aq-strength 8
-temporal-aq 1 -multipass fullres -weighted_pred {bf0?}
```

### AMF (AMD)
```
-c:v h264_amf -quality {quality|balanced|speed} -rc cqp
-qp_i {cq} -qp_p {cq} -bf 0 -g 60 -filler_data 0
-enforce_hrd 0 -vbaq true
```

### QSV (Intel)
```
-c:v h264_qsv -preset fastest -async_depth 1
-init_hw_device qsv
```

### CPU fallback
```
-c:v libx264 -preset veryfast -crf {cq} -bf 0 -profile:v high
```

**Rules**:
- `-weighted_pred 1` ONLY with `-bf 0` (NVENC/ffmpeg 9.0)
- `-filler_data 0` NOT `-filler 0` (ffmpeg 9.0)
- `-extra_hw_frames` REMOVED (not an encoder option in ffmpeg 9.0)
- Always check `ffmpeg -h encoder=<name>` for valid options

## Build/Publish/Deploy Cycle

```powershell
# 1. Build (check for errors)
dotnet build src\DiNho.Capture.Poc\DiNho.Capture.Poc.csproj -c Release

# 2. Publish (self-contained)
dotnet publish src\DiNho.Capture.Poc\DiNho.Capture.Poc.csproj `
  -c Release --self-contained true -r win-x64 `
  -o bin\Release\net10.0-windows10.0.26100.0\publish

# 3. Stage for packaging
npm run copy-engine   # copies to resources/clips-engine-staging/

# 4. Deploy to installed app
Copy-Item -Path "bin\Release\...\publish\DiNho.Capture.Poc.*" `
  -Destination "$env:LOCALAPPDATA\Programs\dinho-optimizer\resources\clips-engine\"
```

## Testing

```powershell
# Run all C# tests
dotnet test

# Run specific test class
dotnet test --filter "FullyQualifiedName~FfmpegEncoderTests"

# Run with verbose output
dotnet test --logger "console;verbosity=detailed"
```

### Test Naming Convention
```csharp
[Fact]
public void MethodName_Condition_ExpectedResult() { }

[Theory]
[InlineData(0)]
[InlineData(1)]
public void MethodName_SpecificInput_ReturnsExpected(int input) { }
```

## COM Interop Rules

```csharp
// Always use try/catch/finally for COM objects
object? obj = null;
try {
    Marshal.QueryInterface(unknown, ref iid, out var ptr);
    obj = Marshal.GetObjectForIUnknown(ptr);
    // use obj
} finally {
    if (obj != null) Marshal.ReleaseComObject(obj);
}
```

**Rules**:
- Always `Marshal.Release` in finally
- Never hold COM references across frames
- Use `[ComImport]` interface definitions with exact GUIDs
