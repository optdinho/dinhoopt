import { activePublishCount } from '../ipc/clips.ipc'
import { isEngineCapturing } from '../ipc/clips-engine-connection'
import { runningClipJobCount } from './clip-encode-job'
import { getActiveScanControllers } from './malware-scanner.service'
import { BUSY_PROBE_KEYS, type BusyProbe, type BusyReason, registerBusyProbe } from './update-install-guard'

/**
 * Human-readable labels for each busy signal. These are i18n keys, not
 * sentences: the renderer translates them, so a pt user is not told the app is
 * "recording a clip" in English.
 */
const BUSY_LABELS = {
  recording: 'busyClipRecording',
  clipEncoding: 'busyClipEncoding',
  clipPublishing: 'busyClipPublishing',
  malwareScan: 'busyMalwareScan',
} as const

/** Turns a boolean source into a probe carrying the given label key. */
function fromFlag(isActive: () => boolean, key: string, label: string): BusyProbe {
  return (): BusyReason | null => (isActive() ? { key, label } : null)
}

/**
 * Registers the busy signals the updater must not interrupt.
 *
 * Deliberately narrow: these are the operations where a `quitAndInstall()`
 * destroys work the user cannot get back. Signals that merely mean "something
 * is running" are excluded, because they would defer updates forever for no
 * reason — the engine process idling between recordings, the game detector
 * polling, the malware file watcher monitoring, cached scan results and the
 * loaded Yara engine are all idle, not busy.
 *
 * Call once at startup, before the first update check.
 */
export function registerUpdateBusyProbes(): void {
  registerBusyProbe(
    BUSY_PROBE_KEYS.recording,
    fromFlag(isEngineCapturing, BUSY_PROBE_KEYS.recording, BUSY_LABELS.recording),
  )

  registerBusyProbe(
    BUSY_PROBE_KEYS.malwareScan,
    fromFlag(() => getActiveScanControllers().size > 0, BUSY_PROBE_KEYS.malwareScan, BUSY_LABELS.malwareScan),
  )

  registerBusyProbe(
    BUSY_PROBE_KEYS.clipEncode,
    fromFlag(() => runningClipJobCount() > 0, BUSY_PROBE_KEYS.clipEncode, BUSY_LABELS.clipEncoding),
  )

  registerBusyProbe(
    BUSY_PROBE_KEYS.publishing,
    fromFlag(() => activePublishCount() > 0, BUSY_PROBE_KEYS.publishing, BUSY_LABELS.clipPublishing),
  )
}
