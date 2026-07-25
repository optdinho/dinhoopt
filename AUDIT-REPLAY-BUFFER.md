# DiNho Replay Buffer — Comprehensive Technical Audit Report

**Date:** 2026-06-28  
**Auditor:** opencode/big-pickle  
**Scope:** C# engine (32 files), TypeScript backend (4 files), frontend (1 file), shared types/channels

---

## Executive Summary

The Replay Buffer system is functionally complete and has been tested in production with FiveM (RTX 5050). It ships with a working NVENC H.264 pipeline, WASAPI audio capture, microphone mixing, PTT, and Matroska+ffmpeg-based clip export.

However, **10 high-impact bugs, 7 medium issues, and 5 architectural concerns** were identified. Most critically:

1. **GpuVideoConverter disposes D3D11 immediate context** — a shared resource. One dispose crashes the entire D3D11 pipeline.
2. **EngineCoordinator + FfmpegEncoder monoliths** (55KB + 49KB) — single-class design mixing pipeline orchestration, IPC dispatch, and GPU video encoding.
3. **Multi-monitor blind spot** — WGC desktop capture hardcodes primary monitor; users gaming on a secondary display get the wrong desktop.
4. **HotkeyManager thread race** — `_disposed` flag + `Join(1000)` insufficient for clean shutdown.
5. **No HDR detection** — HDR displays produce different pixel formats; captured content may be washed out or corrupted.
6. **No unit tests for 28/32 C# files** — only ClipExporter integration tests exist.

---

## Flow Diagram (Current)

```
Electron (TS)                     C# Engine
============                      =========

clips.ipc.ts                      Program.cs
  ├─ startEngine()                └─ RunEngine()
  │   └─ spawn engine.exe             └─ EngineCoordinator.StartAsync()
  │                                      ├─ ConfigManager.Load()
  │                                      ├─ GameDetector.Start()
  │                                      │   └─ WinEventHook / Polling
  │                                      ├─ HotkeyManager.Start()
  │                                      │   └─ WH_KEYBOARD_LL / WH_MOUSE_LL
  │                                      ├─ EngineStatus.Heartbeat()
  │                                      ├─ RamManager.StartWatchdog()
  │                                      └─ NamedPipeServer (pipe wait)
  │
  ├─ CLIPS_START_CAPTURE           OnIpcMessage("startCapture")
  │   └─ sendPipeCommand               ├─ GameDetector.CurrentGame
  │                                    ├─ SelectCaptureSource()
  │                                    │   ├─ WgcCaptureSource (try per-window)
  │                                    │   ├─ WgcCaptureSource (desktop fallback)
  │                                    │   └─ DxgiCaptureSource (final fallback)
  │                                    ├─ EncoderManager.CreateBestEncoder()
  │                                    │   └─ FfmpegEncoder.Initialize()
  │                                    │       ├─ GpuVideoConverter (NV12)
  │                                    │       └─ ffmpeg subprocess (h264_nvenc)
  │                                    ├─ WasapiLoopbackSource.Start()
  │                                    ├─ WasapiMicSource.Start()
  │                                    │   └─ RnnoiseFilter (optional)
  │                                    ├─ AudioMixer (mixes loopback + mic)
  │                                    │   ├─ FfmpegAacEncoder (subprocess)
  │                                    │   └─ SoftClip limiter
  │                                    └─ ReplayBuffer (circular)
  │
  ├─ CLIPS_SAVE_CLIP               OnIpcMessage("saveClip")
  │   └─ sendPipeCommand               └─ SaveClipAsync()
  │                                        ├─ ReplayBuffer.GetSegments()
  │                                        ├─ FfmpegEncoder.Flush()
  │                                        ├─ FfmpegAacEncoder.Flush()
  │                                        ├─ WriteMatroskaFile() (temp MKV)
  │                                        ├─ ffmpeg mux: MKV → MP4
  │                                        └─ thumbnail-generator.ts (TS side)
  │
  └─ CLIPS_STOP_ENGINE / exit      OnIpcMessage("stopEngine")
      └─ stopEngineProcess()           └─ StopAsync()
                                           ├─ StopCapture()
                                           ├─ GameDetector.Stop()
                                           ├─ HotkeyManager.Stop()
                                           └─ EngineStatus.Dispose()
```

---

## PRIORITY 1 — Critical Bugs

### P1.1 GpuVideoConverter disposes D3D11 immediate context

**File:** `GpuVideoConverter.cs:116-119`  
**Severity:** CRITICAL — crashes pipeline  

```csharp
_videoProcessor.Dispose();
_enumerator.Dispose();
_videoContext.Dispose();   // ← device.ImmediateContext
_videoDevice.Dispose();     // ← QueryInterface from device
```

`_videoContext` is `device.ImmediateContext.QueryInterface<ID3D11VideoContext>()`. Disposing it calls `Release()` on the immediate context COM object. If any other code (WgcCaptureSource, DxgiCaptureSource, FfmpegEncoder) uses the same device context after `GpuVideoConverter` is disposed, the context pointer becomes invalid — immediate access violation or device removed error.

**Fix:** Remove `_videoContext.Dispose()` and `_videoDevice.Dispose()`. These are weak references (QI'd from the shared device). The device owns them.

---

### P1.2 FfmpegEncoder processes AVCC as AnnexB (regression risk)

**File:** `FfmpegEncoder.cs` (ReaderLoop)  
**Severity:** CRITICAL — causes 0-frame exports  

Multiple sessions fixed a cycle of bugs where:
1. NVENC outputs AVCC (4-byte length prefix) by default
2. `-bsf:v h264_mp4toannexb` was added to convert to AnnexB
3. `-f h264` was used as output format
4. The reader loop `ConvertAnnexBToAvcc` scanned for `00 00 01` start codes

The current `_rawBuf` + `ScanForStartCode()` approach handles pipe-split NALs correctly, but the complexity makes it fragile. A change in ffmpeg version could break the assumed output format.

**Evidence:** Multiple sessions (2026-06-26 through 2026-06-27) dedicated to fixing `video=0frames` — root cause was AVCC/AnnexB format confusion.

**Fix:** Replace `-f h264` with `-f avformat` using Matroska output directly from the encoder (avoid raw H264 entirely). Remove the reader loop format detection complexity.

---

### P1.3 Multi-monitor hardcoded to primary display

**File:** `Interop.cs:214-216`  
**Severity:** HIGH — wrong display captured for secondary monitor gaming  

```csharp
public static IntPtr GetPrimaryMonitorHandle()
{
    return MonitorFromPoint(new NativePoint(0, 0), MONITOR_DEFAULTTOPRIMARY);
}
```

`EngineCoordinator.SelectCaptureSource()` for WGC desktop always calls `GraphicsCaptureItemHelper.CreateForPrimaryMonitor()`, which monitors point (0,0). If the game is on a secondary monitor (to the right, e.g., 1920,0), WGC desktop captures the wrong display.

**Fix:** `SelectCaptureSource()` should determine which monitor the game HWND is on and target that monitor. `MonitorFromWindow(gameHwnd, ...)` is already available.

---

### P1.4 HotkeyManager shutdown race

**File:** `HotkeyManager.cs:111-115`, `EngineCoordinator.cs` `StopAsync()`  
**Severity:** HIGH — potential crash on exit  

```csharp
public void Stop()
{
    _disposed = true;          // ← set by caller thread
    _hookThread?.Join(1000);   // ← wait max 1s for hook thread
    _hookThread = null;
}
```

The hook thread runs `GetMessage(ref msg, ...)` which **blocks indefinitely** until a message arrives. `Join(1000)` may timeout. After timeout, the hook is never unhooked via `UnhookWindowsHookEx`. The leaked hook can:
- Keep the DLL loaded
- Cause crashes if the callback delegate is GC'd while the hook still references it
- `_winEventDelegate` is a field in GameDetector but `_hookDelegate`/`_mouseHookDelegate` are locals in the anonymous method — if `Stop()` disposes the thread before the loop exits, these locals may be GC'd.

**Fix:** Use `PostThreadMessage` or `PostMessage` to wake the `GetMessage` call before `Join()`. Ensure unhook happens on timeout too.

---

### P1.5 No HDR detection or handling

**Files:** `WgcCaptureSource.cs`, `DxgiCaptureSource.cs`, `FfmpegEncoder.cs`  
**Severity:** HIGH — HDR clips appear washed out or fail  

None of the capture sources check if the display outputs HDR (10-bit, scRGB/BT.2020). WGC and DXGI in HDR mode produce `R16G16B16A16_Float` or `R10G10B10A2_UNORM` textures. The encoder pipeline expects `NV12` (8-bit SDR). Without color space conversion + metadata, HDR clips look washed out or have incorrect colors.

**Fix:** Detect HDR mode via `DXGI_OUTPUT_DESC1.ColorSpace`. Add color space conversion to the GPU pipeline (`VideoProcessorBlt` with `DXGI_COLOR_SPACE_*`). Signal HDR metadata in the output MP4 (HEVC preferred for HDR).

---

### P1.6 GpuVideoConverter VideoProcessorContentDescription mismatch

**File:** `GpuVideoConverter.cs:32-41`  
**Severity:** HIGH — `E_INVALIDARG` on certain crops  

```csharp
var contentDesc = new VideoProcessorContentDescription
{
    InputFrameFormat = VideoFrameFormat.Progressive,
    InputFrameRate = new Rational(60, 1),
    InputWidth = width,       // ← always the FULL width
    InputHeight = height,
    OutputWidth = width,
    OutputHeight = height,
    Usage = VideoUsage.PlaybackNormal
};
```

`InputWidth`/`InputHeight` should reflect the input texture dimensions, not the desired output dimensions. If WGC captures 1920×1080 but the game window is 1280×720 (cropped), the converter creates a description expecting 1920×1080 input but receives a crop. This can produce `E_INVALIDARG` in `VideoProcessorBlt`.

**Evidence:** The code in `EngineCoordinator.cs` that creates `GpuVideoConverter` passes `_captureWidth`/`_captureHeight` (config), not the actual capture frame dimensions.

**Fix:** Use actual captured frame dimensions in `VideoProcessorContentDescription`, or ensure the input texture is the expected size.

---

### P1.7 Named pipe buffer starvation

**File:** `EngineCoordinator.cs` HandleClientAsync  
**Severity:** HIGH — silent clip save failure  

The named pipe protocol sends `saveClip` as a fire-and-forget command. The response (`{ Action: "ok" }`) is written after `SaveClipAsync` completes. During export (potentially 5-30s), no other pipe messages are processed because the reader loop blocks on the `saveClip` handler.

The pipe internal buffer is 4096 bytes (default for Windows named pipes). If the Electron side sends multiple commands during export, the pipe buffer fills, and subsequent writes block or fail. The Electron side has no mechanism to detect this.

**Fix:** Process IPC messages concurrently. Export should not block the pipe reader loop. Use a work queue with immediate `{ Action: "accepted" }` response.

---

### P1.8 32-bit float NaN in AAC encoder (regression risk)

**File:** `WasapiLoopbackSource.cs`, `WasapiMicSource.cs`  
**Severity:** HIGH — silent audio corruption  

Previous sessions fixed a NaN issue by changing `new WaveFormat(48000, 32, N)` to `WaveFormat.CreateIeeeFloatWaveFormat(48000, N)`. The fix is correct for PCM 32-bit IEEE float. However:

```csharp
// WasapiLoopbackSource.cs — potential regression point
var waveFormat = WaveFormat.CreateIeeeFloatWaveFormat(48000, 2);
```

If the actual device format is not IEEE float (e.g., PCM 32-bit signed integer), the `Buffer.BlockCopy` to `float[]` will interpret the data as float, producing NaN or denormalized values. These propagate through `AudioMixer`, `FfmpegAacEncoder`, and corrupt the output AAC stream.

**Fix:** Check `WaveFormat.Encoding` and convert explicitly. Add `float.IsNaN` guard in `AudioMixer.OnMicData` / `OnGameData`.

---

### P1.9 AudioSessionMuteManager assumes persistent sessions

**File:** `AudioSessionMuteManager.cs:26-56`  
**Severity:** HIGH — mute leaks  

`MuteAllExcept` enumerates sessions once and mutes all non-target sessions. If a **new** audio session starts after muting (e.g., Discord notification, browser tab starts playing), it won't be muted. Conversely, if a session ends before `Restore()`, the restore tries to access a stale `SimpleAudioVolume` (may throw).

**Fix:** Enumerate sessions periodically while capture is active, or use a timer to re-apply muting. Remove disposed sessions from `_saved` before restore.

---

### P1.10 FfmpegEncoder output queue unbounded on encode stall

**File:** `FfmpegEncoder.cs` — `_pendingOutputs`  
**Severity:** HIGH — OOM on encoder hang  

The `_pendingOutputs` Channel has no capacity limit. If ffmpeg stalls (GPU hang, disk full), packets accumulate in memory. At 60fps with 1080p NVENC (~200KB per packet), memory grows at ~12MB/s. After 60s without ffmpeg consuming, ~720MB is retained.

The limit of 32 packets mentioned in session notes may not be effective if the channel is unbounded (`Channel.CreateUnbounded<EncodedPacket>()`).

**Fix:** Use `Channel.CreateBounded<EncodedPacket>(new BoundedChannelOptions(64) { FullMode = BoundedChannelFullMode.DropOldest })`. Drop oldest packets when buffer is full to prevent OOM.

---

## PRIORITY 2 — Medium Issues

### P2.1 Race in `_lastForegroundHwnd` (GameDetector)

**File:** `GameDetector.cs:63,183-185,211-214`  

`_lastForegroundHwnd` is written from two threads:
- `HookThreadProc` → `OnForegroundChangedNative` → `OnForegroundChanged`  
- `PollForeground` (timer callback)

No synchronization. The `volatile` keyword on `_running` doesn't protect `_lastForegroundHwnd`. Reads from `OnForegroundChanged` and `PollForeground` can race, causing both to process the same HWND change (double event) or miss a change.

**Fix:** Interlocked.CompareExchange or lock around `_lastForegroundHwnd`.

---

### P2.2 RamManager `_wasUnderPressure` never resets after first recovery

**File:** `RamManager.cs:52,175,223-228`  

`_wasUnderPressure` is set to `true` when pressure or critical threshold is hit. It's only reset when usage drops below `NormalThreshold` (75%). If the system oscillates around the pressure threshold (85%), `_wasUnderPressure` stays `true` and `OnNormal` fires only after the first dip below 75%. Intermediate drops from 90% → 80% → 90% would not trigger any recovery action.

**Fix:** Add hysteresis: set `_wasUnderPressure = false` when usage drops below `NormalThreshold - 0.05` (70%) to create a clean reset band.

---

### P2.3 clips-config-manager: `excludeProcessId` divergence

**File:** `clips-config-manager.ts:123,170`  

```typescript
// buildEngineConfig (line 123)
excludeProcessId: c.useExcludeMode ? process.pid : c.excludeProcessId,

// getCurrentConfigPayload (line 170)
excludeProcessId: config.excludeProcessId,
```

`getCurrentConfigPayload` always uses the config value, ignoring `useExcludeMode`. If `useExcludeMode` is true but `excludeProcessId` is 0 (default), the engine receives `excludeProcessId=0` instead of `process.pid` — the Electron process is NOT excluded, causing the engine to capture the DiNho UI's audio as a game.

**Fix:** Apply same logic as `buildEngineConfig` in `getCurrentConfigPayload`.

---

### P2.4 FfmpegAacEncoder Idle priority (regression risk)

**File:** `FfmpegAacEncoder.cs`  

Previously fixed from `Idle` to `BelowNormal`, but the fix may not persist across refactors. The AAC encoder process priority must stay at `BelowNormal` (minimum) to prevent audio starvation during game capture.

**Fix:** Add a unit test that asserts `ProcessPriorityClass` is not `Idle`.

---

### P2.5 Thumbnail generator uses `execFileSync` (blocking)

**File:** `thumbnail-generator.ts`  
**Severity:** MEDIUM  

`execFileSync` blocks the Electron main process during thumbnail generation. If ffmpeg hangs (corrupt clip), the Electron main process freezes. All IPC handlers stop responding.

**Fix:** Use `execFile` (async) or offload to worker thread.

---

### P2.6 PipelineWatchdog `ShouldReinit()` logic gap

**File:** `PipelineWatchdog.cs:85-89`  

```csharp
public bool ShouldReinit()
{
    return _consecutiveGood == 0 && _lastIssueTime != DateTime.MinValue
        && (DateTime.UtcNow - _lastIssueTime).TotalSeconds > 3;
}
```

If `ReportGoodFrame` is called (setting `_consecutiveGood = 1`), `ShouldReinit()` returns false immediately — even if the drop rate is 90%. This prevents reinit for persistent dropped-frame scenarios. A single good frame resets the reinit timer.

**Fix:** Add a drop-rate threshold. Reinit if drop rate > 50% for 5+ seconds, regardless of the last individual frame.

---

### P2.7 MasterClock precision on high-DPC systems

**File:** `MasterClock.cs`  

`Stopwatch.GetTimestamp()` uses QPC (QueryPerformanceCounter), which is subject to DPC latency jitter on poorly configured systems (e.g., NVIDIA driver DPC stutter). For audio sync (ConsumePcmPts), jitter of 1-2ms can cause audible pops.

**Fix:** Implement a "smooth clock" that uses QPC for high-frequency but applies a PLL (phase-locked loop) to filter jitter, similar to audio drivers.

---

## PRIORITY 3 — Architectural Concerns

### P3.1 EngineCoordinator monolith (55KB + partial class ~657L = ~3340L)

**Files:** `EngineCoordinator.cs` + `IpcMessageHandler.cs`  
**Risk:** Maintainability, testability  

Single class manages: capture lifecycle, encoder lifecycle, audio lifecycle, IPC dispatch, config sync, game detection coordination, export, diagnostics, hotkey routing, and watchdog. Any change risks breaking unrelated features.

**Recommendation:** Split into:
- `CaptureManager.cs` — capture source lifecycle (+ WGC pump)
- `EncoderManager.cs` — already exists, move encoder lifecycle here
- `AudioManager.cs` — mixer + sources + mute management
- `ExportManager.cs` — save/trim/merge
- Keep `EngineCoordinator` as thin orchestrator (~300L)

### P3.2 FfmpegEncoder monolith (49KB)

**File:** `FfmpegEncoder.cs`  
**Risk:** High complexity, hard to test  

Combines: NV12 converter, ffmpeg subprocess management, reader loop with AVCC/AnnexB detection, packet queue, quality params, GPU texture input, color conversion, fallback logic.

**Recommendation:** Extract:
- `HardwareVideoEncoder.cs` — encoder init, params, GPU→NV12
- `EncoderReaderLoop.cs` — pipe reading, NAL parsing, AVCC/AnnexB
- `EncoderPacketQueue.cs` — bounded channel + stats

### P3.3 No C# unit tests for 28/32 files

Only `ClipExporterIntegrationTests.cs` (10 tests) exists among production source files. Critical components with zero coverage: `FfmpegEncoder`, `AudioMixer`, `GameDetector`, `HotkeyManager`, `WgcCaptureSource`, `DxgiCaptureSource`, `ReplayBuffer` (only Program.cs smoke test), `PipelineWatchdog`.

**Risk:** Refactoring the monolith classes is impossible without tests.

**Recommendation:** Add unit tests for:
- `FfmpegEncoder` — NAL parsing, AVCC/AnnexB conversion, packet queuing
- `AudioMixer` — mixing math, soft-clip, gain scaling, noise suppression
- `ReplayBuffer` — trim logic, video-only budget, edge cases
- `GameDetector` — display mode detection, window class lookup
- `HotkeyManager` — modifier matching, repeat suppression
- `PipelineWatchdog` — health levels, reinit decision
- `GpuVideoConverter` — crop validation, format conversion

### P3.4 Named pipe protocol is synchronous and blocking

**Design:** Each IPC command from Electron → C# blocks the pipe reader loop until the handler completes. Export (5-30s) blocks all other commands. Status polling, config updates, and hotkey events are queued behind the export.

**Recommendation:** Use async command queue with immediate acknowledgment. Export runs in background; status reads always return latest snapshot.

### P3.5 Electron main process blocked on thumbnail generation

`execFileSync` for ffmpeg thumbnail generation blocks the Electron main process. Combined with the synchronous pipe protocol, the entire system can freeze if ffmpeg hangs.

**Recommendation:** Where possible, generate thumbnails on the C# side during export (ffmpeg `-vframes 1` at specific PTS). Then simply transfer pre-generated thumbnail over IPC.

---

## Dead / Duplicate Code

### D1. `AudioSessionMuteManager.cs` — session muting approach

Session muting was rejected by the user and replaced with `CppLoopbackSource` (DLL-based per-process loopback). The `AudioSessionMuteManager` is dead code — it's never instantiated in `EngineCoordinator.cs` (the `_sessionMuteManager` field and `CheckAudioFallbackAfterDelayAsync` were removed in session 2026-06-24).

**Action:** Remove file.

### D2. `Bench` directory — BenchmarkResult.cs

`BenchmarkResult.cs` defines data models for benchmark results but no actual benchmark runner code exists in the prod assembly (benchmarks are in `Program.cs` `RunBenchmark()`). The file is dead code if benchmarks are CLI-only.

**Action:** Move to a separate `DiNho.Capture.Bench` project, or remove and keep benchmark logic in Program.cs only.

### D3. `Hotkeys/VirtualKey` enum

`HotkeyManager.cs:321-341` defines `VirtualKey` enum alongside `HotkeyManager`. It's used by `PushToTalkManager` and is not dead code per se, but it duplicates constants that already exist as `const int VK_*` fields in `HotkeyManager`. Consolidate.

### D4. `ConfigManager.ValidateOutputDirectory` static method

Defined but called from zero places in the engine. The validation is duplicated in the Electron side (`clipPathInOutputDir`).

**Action:** Remove C# side, keep Electron side (where the user-facing validation happens).

---

## Resource Leaks

### L1. GpuVideoConverter query interfaces not released

`QueryInterface<ID3D11VideoDevice>` and `QueryInterface<ID3D11VideoContext>` increase COM reference counts. If `Dispose()` is removed as recommended (P1.1), these references are never released → COM object leak.

**Fix:** Release QI'd references without disposing the underlying shared object:

```csharp
Marshal.Release(Marshal.GetIUnknownForObject(_videoContext));
```

But simpler: just don't QI at all. Use `device` directly, it provides `ID3D11VideoDevice` via `QueryInterface` already.

### L2. Named pipe handle leak on engine restart

`EngineCoordinator` creates a new `NamedPipeServerStream` each `StartAsync`. If the pipe client (Electron) disconnects and reconnects without `StopAsync` (e.g., crash recovery), the old pipe stream may not be disposed. Default `PipeDirection.InOut` with `PipeOptions.None` doesn't include `CurrentUserOnly` (implicit by default, but security could be more explicit).

**Fix:** Ensure the previous pipe stream is disposed before creating a new one. Add `PipeOptions.CurrentUserOnly` for security.

### L3. EncodedPacket `ArrayPool` return on flush

`FfmpegEncoder.Flush()` returns pending packets but does not return their `byte[]` buffers to `ArrayPool<byte>.Shared`. If the encoder is re-initialized (e.g., after `StopCapture` + `StartCapture`), the old arrays remain in memory until GC collects them.

**Fix:** Call `EncodedPacket.Release()` on all pending packets during flush. Add an `OnFlush` or similar callback.

---

## Performance Bottlenecks

### B1. ReplayBuffer single lock contention

`ReplayBuffer` uses a single `lock` for all operations (`AddVideo`, `AddAudio`, `GetSegments`, `Stats`, `TrimExcess`). The lock is held during `TrimExcess` which can iterate `_frames` entries. With 4096 video entries, this blocks audio and video producers.

**Fix:** Use `ReaderWriterLockSlim` or partition the buffer (video lock + audio lock separate).

### B2. `GpuVideoConverter` re-created per restart

Each `StartCapture` → `StopCapture` → `StartCapture` cycle creates a new `GpuVideoConverter` (D3D11 VideoProcessor, VideoProcessorEnumerator, output texture). The D3D11 VideoProcessor creation is expensive (~5-10ms). For quick toggles (e.g., game audio-only restart), this adds latency.

**Fix:** Cache and reuse the converter if resolution hasn't changed.

### B3. `EncodedPacket` allocation on every frame

Each captured frame creates a new `EncodedPacket` (class on the heap). At 60fps with 1080p, that's 216,000 packets/hour. The `ArrayPool` helps for byte arrays, but the `EncodedPacket` object itself is heap-allocated and GC'd.

**Fix:** Object pool for `EncodedPacket` (struct or recycled class). The existing `Release()` method already supports this pattern — just add a pool.

### B4. `ClipExporter.ExportToMp4` writes temp file on disk

The export pipeline writes a temp Matroska file (~100MB+) to disk, then runs ffmpeg to re-mux to MP4. This doubles I/O and SSD wear. For a 5-minute clip at 1080p60, ~600MB total I/O per export.

**Fix:** Use ffmpeg pipe input for the video stream (stdin) instead of a temp MKV file. The audio can also be piped. Only write the final MP4.

---

## Security Audit

### S1. No path traversal protection in `WriteMatroskaFile`

`ClipExporter.WriteMatroskaFile` receives a `tempVideoPath` derived from `ClipExporter.GenerateOutputPath`. If the `outputDirectory` config is compromised (Electron sends a path with `..` traversal), the temp file could be written outside the expected directory.

**Mitigation:** Already exists — `clipPathInOutputDir` on TS side validates. But no C#-side validation.

**Fix:** `ConfigManager.Load()` should call `Path.GetFullPath` and validate the resolved path starts with the expected base directory.

### S2. Named pipe ACL

The anonymous pipe `\\.\pipe\dinho-clips-engine` by default allows all authenticated users. Any process on the system can send commands to the engine.

**Fix:** Add `PipeSecurity` with deny for non-current-user, or use `PipeOptions.CurrentUserOnly` on .NET 9.

### S3. Electron IPC channels lack origin validation

`clips.ipc.ts` registers all channels via `ipcMain.handle`. There's no validation that the IPC caller is the legitimate renderer (but Electron's process model makes this inherent). Potential risk: compromised renderer could send arbitrary commands.

**Mitigation:** Acceptable risk for single-window Electron apps.

---

## IPC Boundary Audit

### Mismatch: `CLIPS_GET_STATUS` response shape

**TS expects:** `ClipsEngineStatus` (includes `running`, `capturing`, `uptime`, `fps`, `replayTimeSeconds`, `currentGame`, etc.)  
**C# sends:** `EngineStatusSnapshot` JSON over named pipe  

The `handlePipeMessage` in `clips-engine-connection.ts` parses these fields. **Potential mismatch**: `engineRunning` vs `running` field name. The TS code checks both: `status?.engineRunning ?? status?.running ?? false` (`GameClipsCard.tsx:20`). This suggests the field name changed at some point and backward compat was needed.

**Fix:** Unify field names. C# should send `"running"` (not `"engineRunning"`).

### Mismatch: `CLIPS_SET_CONFIG` — `hotkeys` vs `Hotkeys`

**TS sends:** `Hotkeys` (capitalized, from `buildEngineConfig` → `Hotkeys: hks.map(...)`)  
**C# expects:** `Hotkeys` (JsonPropertyName on `AppConfig.HotkeyBindings`)

This is correct. But `getCurrentConfigPayload` sends `hotkeys` (lowercase), which will NOT be deserialized by C# `AppConfig.HotkeyBindings` (which expects `Hotkeys`). The `config` handler in `IpcMessageHandler` uses `JsonSerializer.Deserialize<AppConfig>` which checks property names.

**Fix:** `getCurrentConfigPayload` should send `Hotkeys` (capitalized) to match the C# model.

---

## Recommendations Summary

### Immediate (1-2 days)
1. Fix P1.1 — Remove `_videoContext.Dispose()` and `_videoDevice.Dispose()` from `GpuVideoConverter`
2. Fix P1.3 — Multi-monitor support in `SelectCaptureSource()`
3. Fix P1.4 — Wake `GetMessage` before `Join()` in `HotkeyManager.Stop()`
4. Fix P1.7 — Async pipe command processing (non-blocking export)
5. Fix P1.10 — Bounded channel for encoder output queue

### Short-term (1 week)
- P2.1 — GameDetector race fix
- P2.3 — Config manager excludeProcessId divergence fix
- P2.5 — Async thumbnail generation
- P3.3 — Add unit tests for FfmpegEncoder.ReaderLoop, AudioMixer, ReplayBuffer

### Medium-term (2-4 weeks)
- P3.1 — Decompose EngineCoordinator (CaptureManager, AudioManager, ExportManager)
- P3.2 — Decompose FfmpegEncoder
- P3.4 — Async named pipe protocol with command queue
- P1.5 — HDR detection and color space conversion

### Long-term (1-2 months)
- P3.5 — Move thumbnail generation to C# engine side
- B4 — Pipe-based export (eliminate temp MKV file)
- B1 — ReaderWriterLockSlim in ReplayBuffer
- S2 — Named pipe security ACL

---

## Final Verdict

**Functional:** ✅ The system works in production for 1080p60 H.264 NVENC with WASAPI audio + mic, PTT, and clip export.

**Architecture:** ⚠️ Monolith design (EngineCoordinator 55KB, FfmpegEncoder 49KB) makes maintenance risky. Strong candidate for decomposition.

**Testing:** ❌ Critical absence of unit tests for the core pipeline. Only 10 integration tests for ClipExporter. Refactoring is effectively blind.

**Performance:** ⚠️ Acceptable for current workloads (1080p60), but bottlenecks identified in export I/O, lock contention, and heap allocation rate.

**Security:** ✅ Basic protections are adequate for a desktop app with local-only IPC. Named pipe ACL could be hardened.

**Stability:** ⚠️ Several race conditions and resource leaks identified (D3D11 context dispose, hotkey thread, named pipe buffers, encoder output queue).
