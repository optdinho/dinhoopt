/**
 * Gate that keeps the auto-updater from killing work in progress.
 *
 * `quitAndInstall()` is a hard process kill: no "are you sure", no graceful
 * handoff. If it lands while the engine is capturing a clip or while ffmpeg is
 * re-encoding, the user silently loses minutes of unsaved work. So the
 * automatic restart consults this guard and defers instead.
 *
 * Signals are contributed as probes rather than imported directly: the clips
 * modules pull in the named-pipe layer, ffmpeg and electron, and importing them
 * from the updater would create a cycle and make both harder to test. Whoever
 * owns a signal registers it once, and the updater only ever sees a boolean.
 */

/** One reason the app is not safe to restart right now. */
export interface BusyReason {
  /** Stable identifier, see {@link BUSY_PROBE_KEYS}. */
  key: string
  /** Short human-readable explanation, used to build the renderer message. */
  label: string
}

/** Returns the reason while busy, or null while idle. */
export type BusyProbe = () => BusyReason | null

/**
 * The signals we actually guard. Keep in sync with the probes registered in
 * `update-install-guard.probes.ts`.
 */
export const BUSY_PROBE_KEYS = {
  /** Clips engine is capturing a recording. */
  recording: 'recording',
  /** A malware scan holds an AbortController. */
  malwareScan: 'malwareScan',
  /** ffmpeg is re-encoding a clip (trim/merge). */
  clipEncode: 'clipEncode',
  /** A clip is being uploaded. */
  publishing: 'publishing',
} as const

const probes = new Map<string, BusyProbe>()

/**
 * Registers (or replaces) the probe for a key.
 *
 * Replacing is deliberate: a re-register is how a probe changes behaviour
 * without ever reporting the same key twice.
 */
export function registerBusyProbe(key: string, probe: BusyProbe): void {
  probes.set(key, probe)
}

/** Forgets a probe. Unknown keys are ignored. */
export function unregisterBusyProbe(key: string): void {
  probes.delete(key)
}

/** Drops every probe. Test-only helper. */
export function resetBusyProbes(): void {
  probes.clear()
}

function isReason(value: unknown): value is BusyReason {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Partial<BusyReason>
  return typeof candidate.key === 'string' && typeof candidate.label === 'string'
}

/**
 * Every reason the app is busy, in registration order.
 *
 * A probe that throws or returns a malformed value is skipped rather than
 * allowed to break the check: a crash inside a probe must never be the reason
 * the updater installs over live work, nor the reason it silently gives up.
 */
export function getBusyReasons(): BusyReason[] {
  const reasons: BusyReason[] = []
  for (const probe of probes.values()) {
    let result: unknown
    try {
      result = probe()
    } catch {
      continue
    }
    if (isReason(result)) reasons.push(result)
  }
  return reasons
}

/** True when at least one probe reports work in progress. */
export function isBusyForUpdate(): boolean {
  return getBusyReasons().length > 0
}
