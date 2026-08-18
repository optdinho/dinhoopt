---
name: debug-runtime
description: >
  Runtime debugging patterns for DiNho Optimizer: JSONL log analysis,
  tick RAM field interpretation, frame drop diagnosis, restart loop
  troubleshooting, A/V sync debugging, and memory analysis.
origin: project
date_added: 2026-08-17
---

# Debug Runtime — DiNho Optimizer

## JSONL Log Location

```
%TEMP%/DiNhoClips/logs/YYYY-MM-DD.jsonl
```

Each line is a JSON object with timestamp, subsystem, and message fields.

## Key Log Subsystems

| Subsystem | Source | What It Logs |
|-----------|--------|-------------|
| `RAM` | `EngineCoordinator.Capture.cs` | Memory tick every ~2s: proc, gcManaged, allocated, native, managedRetained, loh, gen2, gen01, committed, pinned |
| `FfmpegEncoder` | `FfmpegEncoder.cs` | Codec init, frame encoding, drops, restarts, GPU busy |
| `FfmpegAacEncoder` | `FfmpegAacEncoder.cs` | AAC encoding, PCM bytes written, errors |
| `WGC` | `WgcCaptureSource.cs` | WGC capture session, frame arrival, dirty regions |
| `ReplayBuffer` | `ReplayBuffer.cs` | Buffer state, spill, trim, disk I/O |
| `ClipExporter` | `ClipExporter.cs` | Export pipeline, mux, thumbnail, A/V sync |

## RAM Tick Fields

```
[RAM] video=7200frames (~114MB) | audio=5625pkts (~2,8MB) | total≈116,9MB | duracao=120,0s | proc=1189MB | gcManaged=987MB | allocated=4219MB | native=1389MB | managedRetained=144MB | loh=256MB | gen2=512MB | gen01=128MB | committed=3072MB | pinned=0MB
```

| Field | Meaning | Healthy Range |
|-------|---------|--------------|
| `video` | Frames in ring buffer | Matches replaySec × fps |
| `audio` | Audio packets in ring buffer | Matches replaySec × sampleRate/1024 |
| `total` | Ring buffer size (video + audio) | Should match configured buffer limit |
| `proc` | Working set (Process.WorkingSet64) | Stable plateau, no monotonic growth |
| `gcManaged` | .NET managed heap | Stable, drops on GC cycles |
| `allocated` | Total allocated (monotonic) | Growth without ceiling = churn |
| `native` | proc − gcManaged | ~1-1.5GB steady (WGC/NVENC/driver) |
| `managedRetained` | gcManaged − ring − poolIdle | ≈ ring + pool (~370MB) |
| `loh` | Large Object Heap | <500MB steady; spiking during export = normal |
| `gen2` | Gen 2 heap | Stable = long-lived objects |
| `gen01` | Gen 0+1 heap | Fluctuates = normal ephemeral allocs |
| `committed` | OS-committed memory | Slightly > managed total |
| `pinned` | Pinned object count | 0 = healthy; >0 = possible LOH fragmentation |

## Frame Drop Diagnosis

### GPU Busy (0x887A000A)

```
GPU busy (0x887A000A) — frame dropped
```

**Cause:** `Map(DoNotWait)` returned `DXGI_ERROR_WAS_STILL_DRAWING` — GPU overloaded.
**Fix:** `TryMapWithBusyRetry` retries with blocking `Map(Flags.None)`.
**Expected:** 0 consecutive drops; watchdog triggers after ~3s sustained.

### Timeout Drop (Success=false)

```
Frame dropped (Success=false) width=0 height=0
```

**Cause:** WGC didn't deliver a frame within `captureTimeout` (fps + 5ms margin).
**Expected:** Isolated timeouts are jitter (deferred by `ShouldDeferTimeoutDrop`).
**Action:** Only worry if consecutive (stall) or sustained.

### Capture Recovered

```
Captura recuperada após N drops
```

**Meaning:** Watchdog detected sustained drops, reinitialized capture pipeline.
**Healthy:** Should resolve within 1-2 reinit cycles.

## Restart Loop Diagnosis

```
restarting ffmpeg (attempt N, window=X/Y → A/B, cause=reader:stdout_eof, gpuFails=0)
```

| Field | Meaning |
|-------|---------|
| `attempt N` | Current restart attempt (max 10) |
| `window=X/Y` | Sliding window of recent attempts |
| `cause` | Why ffmpeg exited: `reader:stdout_eof`, `reader:timeout`, `codec:not_found` |
| `gpuFails` | Consecutive GPU probe failures |

**Common causes:**
- `codec:not_found` — invalid ffmpeg args (check for removed/renamed options)
- `reader:stdout_eof` — ffmpeg crashed immediately (usually bad args)
- `reader:timeout` — ffmpeg hung (pipe blocked, stdin full)

**Healthy:** 0 restarts; occasional 1-restart is normal during codec fallback.

## A/V Sync Debugging

### DriftMonitor Output

```
[DriftMonitor] drift=+45ms (audio ahead) — within tolerance
[DriftMonitor] drift=-150ms (audio behind) — WARNING: exceeds 125ms threshold
```

**Thresholds:**
- <30ms: imperceptible
- 30-125ms: detectable but acceptable
- 125-185ms: noticeable
- >185ms: unacceptable

### SAVE Diagnostic

```
[PTS] Pre-sync: video=300s audio=300.5s
[PTS] Post-sync: trueDuration=299.8s framesWithDur=300 gapsRemoved=0
[SAVE START] → C:\Users\...\clip.mp4
[SAVE OK] — 15.4MB saved
```

**Key:** `video≈audio` in Pre-sync = healthy. Large gap = alt-tab freeze in ring buffer.

## Memory Analysis

### Leak vs Plateau

```
# LEAK (monotonic growth, never drops):
proc=1800MB → proc=2100MB → proc=2400MB → proc=2700MB

# HEALTHY PLATEAU (GC steps, stable):
proc=2650MB → proc=2650MB → proc=2593MB (GC) → proc=2593MB → proc=2530MB (GC)
```

### FFASE 3 Breakdown

- `loh` high + stable → LOH fragmentation (consider `GCSettings.LargeObjectHeapCompactionMode`)
- `gen2` high + stable → long-lived objects retained (expected for ring buffer + pool)
- `gen01` fluctuating → normal ephemeral allocs
- `pinned` >0 → objects blocking LOH compaction (investigate with `dotnet-dump`)
- `committed` >> `gcManaged` + `native` → possible uncommitted virtual memory (not a leak)

## Common Debug Commands

```bash
# View live logs
Get-Content "%TEMP%/DiNhoClips/logs/$(Get-Date -Format yyyy-MM-dd).jsonl" -Tail 50 -Wait

# Count restarts today
(Get-Content "*.jsonl" | Select-String "restarting ffmpeg").Count

# Find GPU busy spikes
Select-String "*.jsonl" | Select-String "GPU busy" | Measure-Object

# Check engine process
Get-Process "DiNho.Capture.Poc" | Select-Object Id, WorkingSet64, CPU

# Force engine stop (if orphaned)
Get-Process "DiNho.Capture.Poc" | Stop-Process -Force
```

## Debug Workflow

1. **Check JSONL for today** — look for `restarting ffmpeg`, `GPU busy`, `EXPORT FAILED`
2. **Check RAM tick** — is `proc` plateauing or growing? `native` vs `gcManaged` split?
3. **Check SAVE OK/FAILED** — are clips saving? Video frame count >0?
4. **Check drift** — is DriftMonitor warning? Audio ahead/behind?
5. **Check engine process** — is it alive? Working set stable?
6. **If orphaned** — kill engine process, restart app
