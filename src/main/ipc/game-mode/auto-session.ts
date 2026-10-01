import { getLogger } from '../../services/logger.service'
import { ensureClipCaptureStarted, stopClipCapture, stopEngineProcess } from '../clips-engine-connection'

/**
 * The detector polls every 30s, so a single missed poll is not evidence that the
 * game is gone — launchers hand off between processes and FiveM respawns
 * GTAProcess.  Tearing the session down on the first miss cut recordings short
 * and left Game Mode tweaks applied, so the exit is only acted upon after this
 * much continuous silence.
 */
export const GAME_EXIT_GRACE_MS = 5 * 60 * 1000

export interface ExitGraceOptions {
  onElapsed: () => Promise<void>
  /** Re-checked at the deadline: a game seen again cancels the teardown. */
  isGameAbsent: () => boolean
  graceMs?: number
}

let graceTimer: ReturnType<typeof setTimeout> | null = null
let recording = false

export function isExitGracePending(): boolean {
  return graceTimer !== null
}

export function isSessionRecording(): boolean {
  return recording
}

function clearGraceTimer(): void {
  if (graceTimer === null) return
  clearTimeout(graceTimer)
  graceTimer = null
}

/**
 * Starts the clips engine and capture for a game-detected session.  Never
 * throws: the caller is a fire-and-forget detector callback.
 */
export async function startAutoRecording(): Promise<void> {
  try {
    const result = await ensureClipCaptureStarted()
    if (!result.success) {
      getLogger().error('game-mode', `Auto clip recording failed to start: ${result.error ?? 'unknown error'}`)
      recording = false
      return
    }
    recording = true
    getLogger().success('game-mode', 'Auto clip recording started for the detected game')
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    getLogger().error('game-mode', `Auto clip recording threw while starting: ${reason}`)
    recording = false
  }
}

/**
 * Stops capture and the engine for a session.  Idempotent, so a manual
 * deactivation followed by the grace deadline cannot double-stop.
 */
export async function stopAutoRecording(): Promise<void> {
  if (!recording) return
  recording = false
  try {
    const result = await stopClipCapture()
    if (!result.success) {
      getLogger().warning('game-mode', `Auto clip recording did not stop cleanly: ${result.error ?? 'unknown error'}`)
    } else {
      getLogger().success('game-mode', 'Auto clip recording stopped')
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    getLogger().warning('game-mode', `Auto clip recording threw while stopping: ${reason}`)
  }
  stopEngineProcess()
}

/** Schedules the teardown, replacing any grace period already in flight. */
export function armGameExitGrace(options: ExitGraceOptions): void {
  const graceMs = options.graceMs ?? GAME_EXIT_GRACE_MS
  clearGraceTimer()
  graceTimer = setTimeout(() => {
    graceTimer = null
    void runGraceExpiry(options)
  }, graceMs)
  getLogger().info(
    'game-mode',
    `Game not detected — Game Mode and clip recording stop in ${Math.round(graceMs / 1000)}s unless it comes back`,
  )
}

async function runGraceExpiry(options: ExitGraceOptions): Promise<void> {
  if (!options.isGameAbsent()) {
    getLogger().info('game-mode', 'Exit grace period elapsed but a game is present again — teardown cancelled')
    return
  }
  await options.onElapsed()
}

export function cancelGameExitGrace(): void {
  if (graceTimer === null) return
  clearGraceTimer()
  getLogger().info('game-mode', 'Game detected again — exit grace period cancelled')
}

export function resetAutoSession(): void {
  clearGraceTimer()
  recording = false
}
