import { IPC } from '@shared/channels'
import type { UpdateStatus } from '@shared/types'
import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import { getSecret } from './env-sanitize'
import { getLogger } from './logger.service'
import { getSettings } from './settings-store'
import { type BusyReason, getBusyReasons, isBusyForUpdate } from './update-install-guard'

/**
 * How often a deferred install re-checks whether the app went idle.
 *
 * Short enough that the update lands shortly after a recording stops, long
 * enough that the check is free: it only reads booleans that already live in
 * this process, it makes no request and touches no disk.
 */
export const UPDATE_DEFERRED_RETRY_MS = 15_000

let status: UpdateStatus = { state: 'idle' }
let daemonMode = false
let checkInterval: ReturnType<typeof setInterval> | null = null
let deferredRetry: ReturnType<typeof setInterval> | null = null

function broadcast(s: UpdateStatus): void {
  status = s
  if (daemonMode) {
    const ts = new Date().toISOString()
    const detail = s.version ? ` v${s.version}` : ''
    const progress = s.progress != null ? ` ${s.progress}%` : ''
    const error = s.error ? ` — ${s.error}` : ''
    process.stdout.write(`[${ts}] [updater] ${s.state}${detail}${progress}${error}\n`)
    return
  }
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    // isDestroyed() returns false while the render frame is mid-teardown,
    // so .send() still throws "Render frame was disposed before WebFrameMain
    // could be accessed". Swallow it — there's no recipient anyway, and the
    // unhandled stack trace was the loudest signal in issue #148, masking
    // the actual renderer crash.
    try {
      win.webContents.send(IPC.UPDATER_STATUS, s)
    } catch {
      /* renderer gone — nothing to deliver to */
    }
  }
}

interface InitOptions {
  daemon?: boolean
}

export function initAutoUpdater(opts: InitOptions = {}): void {
  if (!app.isPackaged) return

  daemonMode = opts.daemon === true

  // Route updater diagnostics into the structured JSONL logger.
  autoUpdater.logger = {
    info: (m) => void getLogger().info('Updater', String(m)),
    warn: (m) => void getLogger().warning('Updater', String(m)),
    error: (m) => void getLogger().error('Updater', String(m)),
  }

  // GH_TOKEN was sanitized out of process.env by env-sanitize.ts.
  // electron-updater reads process.env.GH_TOKEN lazily at request time,
  // so we restore it just before each check and clear it after.
  const ghToken = getSecret('GH_TOKEN')
  if (ghToken) process.env.GH_TOKEN = ghToken

  const settings = getSettings()
  autoUpdater.autoDownload = daemonMode || settings.autoUpdate
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    broadcast({ state: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    broadcast({ state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', () => {
    broadcast({ state: 'not-available' })
  })

  autoUpdater.on('download-progress', (prog) => {
    broadcast({ state: 'downloading', progress: Math.round(prog.percent) })
  })

  autoUpdater.on('update-downloaded', (info) => {
    if (daemonMode) {
      broadcast({ state: 'downloaded', version: info.version })
      process.stdout.write(`[${new Date().toISOString()}] [updater] Installing v${info.version} and restarting...\n`)
      autoUpdater.quitAndInstall(true, true)
      return
    }
    // GUI mode: auto-restart if the user opted in
    const current = getSettings()
    if (!current.autoRestart) {
      broadcast({ state: 'downloaded', version: info.version })
      return
    }
    // `quitAndInstall(true, true)` is a hard kill with no prompt. Restarting
    // over a live recording or a running ffmpeg re-encode would throw away
    // work the user cannot recover, so defer until the guard reports idle.
    if (isBusyForUpdate()) {
      deferInstall(info.version)
      return
    }
    broadcast({ state: 'downloaded', version: info.version })
    getLogger().info('auto-updater', `Installing v${info.version} and restarting...`)
    autoUpdater.quitAndInstall(true, true)
  })

  autoUpdater.on('error', (err) => {
    broadcast({ state: 'error', error: err?.message || 'Update failed' })
  })

  // Check on startup
  autoUpdater.checkForUpdates().catch((err) => {
    getLogger().error('auto-updater', `Check failed: ${err?.message || err}`)
  })

  // Periodic background checks
  startPeriodicChecks(settings.updateCheckIntervalHours)
}

function startPeriodicChecks(intervalHours: number): void {
  if (checkInterval) clearInterval(checkInterval)
  if (intervalHours <= 0) return
  const ms = intervalHours * 60 * 60 * 1000
  checkInterval = setInterval(() => {
    const ghToken = getSecret('GH_TOKEN')
    if (ghToken) process.env.GH_TOKEN = ghToken
    const settings = getSettings()
    autoUpdater.autoDownload = daemonMode || settings.autoUpdate
    autoUpdater.checkForUpdates().catch((err) => {
      getLogger().error('auto-updater', `Periodic check failed: ${err?.message || err}`)
    })
  }, ms)
}

/** Drops a pending deferred install. Called on quit and when one goes through. */
export function cancelDeferredInstall(): void {
  if (deferredRetry) {
    clearInterval(deferredRetry)
    deferredRetry = null
  }
}

/**
 * Holds a downloaded update back while the app is busy, and installs it as soon
 * as the guard clears.
 *
 * Deferring rather than cancelling is the point: the update is already on disk,
 * so the only question is when to restart. Polling on a short timer means the
 * install still happens on its own — the user does not have to notice a badge
 * and click anything, and nothing is lost if the app is busy for hours.
 */
function deferInstall(version: string): void {
  const reasons: BusyReason[] = getBusyReasons()
  broadcast({ state: 'deferred', version, deferredReasons: reasons })
  getLogger().info(
    'auto-updater',
    `Deferring install of v${version}, busy with: ${reasons.map((r) => r.key).join(', ')}`,
  )

  // Re-register rather than stack timers: a second download while already
  // deferred must not leave two pollers racing to call quitAndInstall.
  cancelDeferredInstall()
  deferredRetry = setInterval(() => {
    if (isBusyForUpdate()) {
      // Refresh the reported reasons. A multi-hour defer can outlive the work
      // that blocked it and pick up new work, and a stale list would tell the
      // user the update is waiting on something that already finished.
      const current = getBusyReasons()
      if (current.map((r) => r.key).join(',') !== reasons.map((r) => r.key).join(',')) {
        broadcast({ state: 'deferred', version, deferredReasons: current })
      }
      return
    }
    cancelDeferredInstall()
    getLogger().info('auto-updater', `App went idle, installing deferred v${version}`)
    autoUpdater.quitAndInstall(true, true)
  }, UPDATE_DEFERRED_RETRY_MS)
}

/** Call when the user changes updateCheckIntervalHours at runtime */
export function updateCheckInterval(hours: number): void {
  if (!app.isPackaged) return
  startPeriodicChecks(hours)
}

export function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return Promise.resolve()
  const ghToken = getSecret('GH_TOKEN')
  if (ghToken) process.env.GH_TOKEN = ghToken
  return autoUpdater.checkForUpdates().then(() => {})
}

export function downloadUpdate(): Promise<void> {
  if (!app.isPackaged) return Promise.resolve()
  return autoUpdater.downloadUpdate().then(() => {})
}

export function installUpdate(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall(true, true)
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export function setAutoDownload(enabled: boolean): void {
  if (app.isPackaged) {
    autoUpdater.autoDownload = enabled
  }
}
