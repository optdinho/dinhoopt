import { createJsonStore } from './store-base'

interface AmdGpuCache {
  /** True when a previous run saw a GPU with the AMD vendor id (0x1002). */
  amdDetected: boolean
}

/**
 * The AMD/VCN detection for clip enhancement (sr_amf/frc_amf) normally comes from
 * the C# engine over the named pipe, which only answers while the engine is
 * running. Without a cache, opening the clip editor with the engine stopped
 * reports "no AMD GPU" and the Aprimorar dropdown stays disabled.
 *
 * Persisting the last known result keeps the feature usable across restarts and
 * while the engine is down. A stale positive is harmless: a machine whose GPU was
 * swapped simply gets a failing ffmpeg invocation on a non-AMD box, and the next
 * successful engine scan overwrites the value.
 */
const store = createJsonStore<AmdGpuCache>({
  name: 'clips-amd-gpu.json',
  defaults: { amdDetected: false },
})

/** Reads the persisted detection, returning false when absent or unreadable. */
export function loadAmdGpuCache(): boolean {
  const data = store.load()
  return data.amdDetected === true
}

/** Persists a detection result. Best-effort: a failed write must never break IPC. */
export function rememberAmdDetection(amdDetected: boolean): void {
  try {
    store.save({ amdDetected })
  } catch {
    /* cache is an optimization, not a hard requirement */
  }
}

/**
 * Resolves AMD availability for enhancement gating.
 *
 * The in-memory flag (`null` = never scanned) wins when it is already positive so
 * a fresh scan is never discarded; otherwise the persisted cache is consulted.
 */
export function resolveAmdAvailable(inMemory: boolean | null): boolean {
  if (inMemory === true) return true
  return loadAmdGpuCache()
}
