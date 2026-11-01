/**
 * Hardware acceleration stays ON by default. This module decides when the app
 * must fall back to software rendering after a GPU process failure, and
 * performs that fallback by relaunching once with the software flags.
 *
 * History: commit 6e1cb35 (2026-06-15) shipped `--disable-gpu` unconditionally
 * to work around a black screen on Windows 25H2, where the GPU process died
 * with error_code=18 on an RTX 5050 under Electron 43 / Chromium 134. The
 * workaround cost every user hardware video decode: playing a 1080p60 AV1 clip
 * in the clip editor dropped 26% of frames (174 of 660) and fell 3.2 s behind
 * real time, while the same file played with 0 dropped frames once the GPU was
 * re-enabled (measured 2026-11-01 on Electron 45.2.1). The fallback is now
 * conditional: it only fires when the GPU process actually fails, so healthy
 * machines keep hardware decode.
 */

/** Flags that put Chromium back on software rendering (the old workaround). */
export const SOFTWARE_RENDER_FLAGS: readonly string[] = ['--disable-gpu', '--enable-unsafe-swiftshader']

/**
 * A GPU crash this soon after start is the black-screen scenario: the window
 * never paints because the compositor never comes up.
 */
export const STARTUP_GPU_CRASH_WINDOW_MS = 60_000

/**
 * Chromium restarts a crashed GPU process on its own, so a single late crash
 * is not fatal; two failures mean it is not recovering and the UI is at risk.
 */
export const GPU_CRASH_RELAUNCH_THRESHOLD = 2

export interface GpuProcessGoneDetails {
  type: string
  reason: string
  exitCode: number
}

export interface GpuFallbackDecision {
  /** True when this process was already relaunched in software mode. */
  alreadyInSoftwareMode: boolean
  /** Milliseconds since this process started tracking the GPU process. */
  uptimeMs: number
  /** GPU failures observed in this process, including the current one. */
  gpuCrashCount: number
  isPackaged: boolean
  /** True once a relaunch was scheduled, or while the app is shutting down. */
  relaunchBlocked: boolean
}

/**
 * Whether a GPU process exit warrants relaunching the app in software mode.
 *
 * Deliberately conservative: a clean exit is a normal shutdown, dev runs are
 * skipped (electron-vite owns the process — relaunching would kill the dev
 * server), and a relaunch is never scheduled twice.
 */
export function shouldRelaunchInSoftwareMode(details: GpuProcessGoneDetails, decision: GpuFallbackDecision): boolean {
  if (details.type !== 'GPU') return false
  if (!decision.isPackaged) return false
  if (decision.alreadyInSoftwareMode || decision.relaunchBlocked) return false
  if (details.reason === 'clean-exit') return false
  return decision.uptimeMs <= STARTUP_GPU_CRASH_WINDOW_MS || decision.gpuCrashCount >= GPU_CRASH_RELAUNCH_THRESHOLD
}

/** App arguments for the software-mode relaunch (argv[0] is the executable). */
export function softwareRenderArgs(argv: readonly string[]): string[] {
  return [...argv.slice(1), ...SOFTWARE_RENDER_FLAGS]
}

export interface GpuFallbackDeps {
  /** process.argv of the current process. */
  argv: readonly string[]
  isPackaged: boolean
  now: () => number
  relaunch: (args: string[]) => void
  quit: () => void
  log: (message: string) => void
}

export interface GpuFallback {
  handleChildProcessGone(details: GpuProcessGoneDetails): void
  /** Called from `before-quit` so a shutdown is never mistaken for a failure. */
  markQuitting(): void
}

export function createGpuFallback(deps: GpuFallbackDeps): GpuFallback {
  const startedAt = deps.now()
  let gpuCrashCount = 0
  let scheduled = false
  let quitting = false

  return {
    handleChildProcessGone(details) {
      if (details.type !== 'GPU') return

      gpuCrashCount += 1
      const reason = `GPU process gone (reason=${details.reason}, exitCode=${details.exitCode}, crash #${gpuCrashCount})`

      const relaunch = shouldRelaunchInSoftwareMode(details, {
        alreadyInSoftwareMode: deps.argv.includes('--disable-gpu'),
        uptimeMs: deps.now() - startedAt,
        gpuCrashCount,
        isPackaged: deps.isPackaged,
        relaunchBlocked: scheduled || quitting,
      })
      if (!relaunch) {
        deps.log(`${reason}; keeping hardware acceleration`)
        return
      }

      scheduled = true
      deps.log(`${reason}; relaunching with ${SOFTWARE_RENDER_FLAGS.join(' ')}`)
      deps.relaunch(softwareRenderArgs(deps.argv))
      deps.quit()
    },

    markQuitting() {
      quitting = true
    },
  }
}
