import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  autoUpdaterOn: vi.fn(),
  autoUpdaterCheck: vi.fn(),
  autoUpdaterDownload: vi.fn(),
  autoUpdaterQuitAndInstall: vi.fn(),
  settings: { autoUpdate: true, autoRestart: false, updateCheckIntervalHours: 24 },
  logger: { info: vi.fn(), error: vi.fn(), warning: vi.fn(), success: vi.fn() },
  browserWindows: [] as Array<Record<string, unknown>>,
  isPackaged: true,
  isBusyForUpdate: vi.fn(() => false),
  getBusyReasons: vi.fn(() => [] as Array<{ key: string; label: string }>),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.isPackaged
    },
  },
  BrowserWindow: {
    getAllWindows: () => mocks.browserWindows,
  },
}))

vi.mock('electron-updater', () => ({
  autoUpdater: {
    on: (...args: unknown[]) => mocks.autoUpdaterOn(...args),
    checkForUpdates: (...args: unknown[]) => mocks.autoUpdaterCheck(...args),
    downloadUpdate: (...args: unknown[]) => mocks.autoUpdaterDownload(...args),
    quitAndInstall: (...args: unknown[]) => mocks.autoUpdaterQuitAndInstall(...args),
    autoDownload: false,
    autoInstallOnAppQuit: true,
  },
}))

vi.mock('./logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('./settings-store', () => ({
  getSettings: () => mocks.settings,
}))

vi.mock('./update-install-guard', () => ({
  isBusyForUpdate: mocks.isBusyForUpdate,
  getBusyReasons: mocks.getBusyReasons,
}))

vi.mock('./env-sanitize', () => ({
  getSecret: () => undefined,
}))

vi.mock('@shared/channels', () => ({
  IPC: { UPDATER_STATUS: 'updater:status' },
}))

import { autoUpdater as mockAutoUpdater } from 'electron-updater'
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  initAutoUpdater,
  installUpdate,
  setAutoDownload,
  UPDATE_DEFERRED_RETRY_MS,
  updateCheckInterval,
} from './auto-updater'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.autoUpdaterCheck.mockResolvedValue(undefined as never)
  mocks.autoUpdaterDownload.mockResolvedValue(undefined as never)
  mocks.browserWindows = []
  mocks.isPackaged = true
  mocks.settings.autoUpdate = true
  mocks.settings.autoRestart = false
  mocks.settings.updateCheckIntervalHours = 24
  mocks.isBusyForUpdate.mockReturnValue(false)
  mocks.getBusyReasons.mockReturnValue([])
  mockAutoUpdater.autoDownload = false
})

afterEach(() => {
  mocks.isPackaged = true
  updateCheckInterval(0)
  vi.useRealTimers()
})

function getHandler(event: string): (...args: unknown[]) => void {
  return mocks.autoUpdaterOn.mock.calls.find((c) => c[0] === event)?.[1] as (...args: unknown[]) => void
}

describe('getUpdateStatus', () => {
  it('returns initial idle state', () => {
    const status = getUpdateStatus()
    expect(status.state).toBe('idle')
  })
})

describe('initAutoUpdater', () => {
  it('registers event handlers on autoUpdater', () => {
    initAutoUpdater()
    expect(mocks.autoUpdaterOn).toHaveBeenCalledWith('checking-for-update', expect.any(Function))
    expect(mocks.autoUpdaterOn).toHaveBeenCalledWith('update-available', expect.any(Function))
    expect(mocks.autoUpdaterOn).toHaveBeenCalledWith('update-not-available', expect.any(Function))
    expect(mocks.autoUpdaterOn).toHaveBeenCalledWith('download-progress', expect.any(Function))
    expect(mocks.autoUpdaterOn).toHaveBeenCalledWith('update-downloaded', expect.any(Function))
    expect(mocks.autoUpdaterOn).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it('checks for updates on startup', () => {
    initAutoUpdater()
    expect(mocks.autoUpdaterCheck).toHaveBeenCalled()
  })

  it('does nothing when app is not packaged', () => {
    mocks.isPackaged = false
    initAutoUpdater()
    expect(mocks.autoUpdaterOn).not.toHaveBeenCalled()
    expect(mocks.autoUpdaterCheck).not.toHaveBeenCalled()
  })

  it('sets autoDownload from daemon mode', () => {
    initAutoUpdater({ daemon: true })
    expect(mockAutoUpdater.autoDownload).toBe(true)
  })

  it('sets autoDownload from settings', () => {
    mocks.settings.autoUpdate = false
    initAutoUpdater()
    expect(mockAutoUpdater.autoDownload).toBe(false)
  })

  it('broadcasts checking state', () => {
    initAutoUpdater()
    const handler = getHandler('checking-for-update')
    handler()
    expect(getUpdateStatus()).toEqual({ state: 'checking' })
  })

  it('broadcasts available state', () => {
    initAutoUpdater()
    const handler = getHandler('update-available')
    handler({ version: '2.0.0' })
    expect(getUpdateStatus()).toEqual({ state: 'available', version: '2.0.0' })
  })

  it('broadcasts not-available state', () => {
    initAutoUpdater()
    const handler = getHandler('update-not-available')
    handler()
    expect(getUpdateStatus()).toEqual({ state: 'not-available' })
  })

  it('broadcasts download progress', () => {
    initAutoUpdater()
    const handler = getHandler('download-progress')
    handler({ percent: 45.7 })
    expect(getUpdateStatus()).toEqual({ state: 'downloading', progress: 46 })
  })

  it('broadcasts downloaded state and auto-installs in daemon mode', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    initAutoUpdater({ daemon: true })
    const handler = getHandler('update-downloaded')
    handler({ version: '2.0.0' })
    expect(getUpdateStatus()).toEqual({ state: 'downloaded', version: '2.0.0' })
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledWith(true, true)
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('Installing v2.0.0'))
    writeSpy.mockRestore()
  })

  it('broadcasts downloaded state and auto-restarts in GUI mode with setting', () => {
    mocks.settings.autoRestart = true
    initAutoUpdater()
    const handler = getHandler('update-downloaded')
    handler({ version: '2.0.0' })
    expect(getUpdateStatus()).toEqual({ state: 'downloaded', version: '2.0.0' })
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('broadcasts downloaded state without restart in GUI mode when setting disabled', () => {
    mocks.settings.autoRestart = false
    initAutoUpdater()
    const handler = getHandler('update-downloaded')
    handler({ version: '2.0.0' })
    expect(getUpdateStatus()).toEqual({ state: 'downloaded', version: '2.0.0' })
    expect(mocks.autoUpdaterQuitAndInstall).not.toHaveBeenCalled()
  })

  it('defers the restart while work is in progress instead of killing it', () => {
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    mocks.getBusyReasons.mockReturnValue([{ key: 'recording', label: 'clipRecording' }])
    initAutoUpdater()
    const handler = getHandler('update-downloaded')
    handler({ version: '2.0.0' })
    expect(mocks.autoUpdaterQuitAndInstall).not.toHaveBeenCalled()
    expect(getUpdateStatus()).toEqual({
      state: 'deferred',
      version: '2.0.0',
      deferredReasons: [{ key: 'recording', label: 'clipRecording' }],
    })
  })

  it('defers even with several reasons in flight', () => {
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    mocks.getBusyReasons.mockReturnValue([
      { key: 'recording', label: 'clipRecording' },
      { key: 'clipEncode', label: 'clipEncoding' },
    ])
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })
    expect(getUpdateStatus().deferredReasons).toHaveLength(2)
  })

  it('logs why the restart was deferred', () => {
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    mocks.getBusyReasons.mockReturnValue([{ key: 'recording', label: 'clipRecording' }])
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })
    expect(mocks.logger.info).toHaveBeenCalledWith('auto-updater', expect.stringContaining('recording'))
  })

  it('installs on the retry tick once the app goes idle', () => {
    vi.useFakeTimers()
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })
    expect(mocks.autoUpdaterQuitAndInstall).not.toHaveBeenCalled()

    mocks.isBusyForUpdate.mockReturnValue(false)
    vi.advanceTimersByTime(UPDATE_DEFERRED_RETRY_MS + 10)

    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('keeps waiting while the app is still busy', () => {
    vi.useFakeTimers()
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })

    vi.advanceTimersByTime(UPDATE_DEFERRED_RETRY_MS * 3)

    expect(mocks.autoUpdaterQuitAndInstall).not.toHaveBeenCalled()
    expect(getUpdateStatus().state).toBe('deferred')
  })

  it('refreshes the reported reasons when the blocking work changes', () => {
    vi.useFakeTimers()
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    mocks.getBusyReasons.mockReturnValue([
      { key: 'recording', label: 'busyClipRecording' },
      { key: 'malwareScan', label: 'busyMalwareScan' },
    ])
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })
    expect(getUpdateStatus().deferredReasons).toHaveLength(2)

    // The scan finishes but a recording is still running: a list frozen at
    // defer time would keep telling the user the scan is the reason.
    mocks.getBusyReasons.mockReturnValue([{ key: 'recording', label: 'busyClipRecording' }])
    vi.advanceTimersByTime(UPDATE_DEFERRED_RETRY_MS + 10)

    expect(getUpdateStatus().deferredReasons).toEqual([{ key: 'recording', label: 'busyClipRecording' }])
    expect(mocks.autoUpdaterQuitAndInstall).not.toHaveBeenCalled()
  })

  it('does not re-broadcast when the reasons are unchanged', () => {
    vi.useFakeTimers()
    const winSend = vi.fn()
    mocks.browserWindows = [{ isDestroyed: () => false, webContents: { send: winSend } }]
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    mocks.getBusyReasons.mockReturnValue([{ key: 'recording', label: 'busyClipRecording' }])
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })

    const broadcastsAfterDefer = winSend.mock.calls.length
    vi.advanceTimersByTime(UPDATE_DEFERRED_RETRY_MS * 3)

    expect(winSend).toHaveBeenCalledTimes(broadcastsAfterDefer)
  })

  it('stops polling after the deferred install goes through', () => {
    vi.useFakeTimers()
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })

    mocks.isBusyForUpdate.mockReturnValue(false)
    vi.advanceTimersByTime(UPDATE_DEFERRED_RETRY_MS + 10)
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(UPDATE_DEFERRED_RETRY_MS * 3)
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('never starts a retry timer when the app is idle', () => {
    vi.useFakeTimers()
    mocks.settings.autoRestart = true
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(UPDATE_DEFERRED_RETRY_MS * 3)
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('does not defer the daemon install: the headless mode has no user work to lose', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    mocks.isBusyForUpdate.mockReturnValue(true)
    initAutoUpdater({ daemon: true })
    getHandler('update-downloaded')({ version: '2.0.0' })
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledWith(true, true)
    writeSpy.mockRestore()
  })

  it('does not defer when the user disabled auto-restart', () => {
    mocks.settings.autoRestart = false
    mocks.isBusyForUpdate.mockReturnValue(true)
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })
    expect(getUpdateStatus().state).toBe('downloaded')
    expect(getUpdateStatus().deferredReasons).toBeUndefined()
  })

  it('a second download while deferred keeps the newer version and does not stack timers', () => {
    vi.useFakeTimers()
    mocks.settings.autoRestart = true
    mocks.isBusyForUpdate.mockReturnValue(true)
    initAutoUpdater()
    getHandler('update-downloaded')({ version: '2.0.0' })
    getHandler('update-downloaded')({ version: '2.1.0' })
    expect(getUpdateStatus().version).toBe('2.1.0')

    mocks.isBusyForUpdate.mockReturnValue(false)
    vi.advanceTimersByTime(UPDATE_DEFERRED_RETRY_MS + 10)
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledTimes(1)
  })

  it('broadcasts error state', () => {
    initAutoUpdater()
    const handler = getHandler('error')
    handler(new Error('connection failed'))
    expect(getUpdateStatus()).toEqual({ state: 'error', error: 'connection failed' })
  })

  it('handles error with null message', () => {
    initAutoUpdater()
    const handler = getHandler('error')
    handler(null)
    expect(getUpdateStatus()).toEqual({ state: 'error', error: 'Update failed' })
  })

  it('handles error with undefined error', () => {
    initAutoUpdater()
    const handler = getHandler('error')
    handler(undefined)
    expect(getUpdateStatus()).toEqual({ state: 'error', error: 'Update failed' })
  })

  it('logs error when startup check fails', async () => {
    mocks.autoUpdaterCheck.mockRejectedValueOnce(new Error('startup fail'))
    initAutoUpdater()
    await vi.waitFor(() => {
      expect(mocks.logger.error).toHaveBeenCalledWith('auto-updater', 'Check failed: startup fail')
    })
  })
})

describe('broadcast in GUI mode', () => {
  it('sends status to all windows', () => {
    const win1Send = vi.fn()
    const win2Send = vi.fn()
    mocks.browserWindows = [
      { isDestroyed: () => false, webContents: { send: win1Send } },
      { isDestroyed: () => false, webContents: { send: win2Send } },
    ]
    initAutoUpdater()
    const handler = getHandler('checking-for-update')
    handler()
    expect(win1Send).toHaveBeenCalledWith('updater:status', { state: 'checking' })
    expect(win2Send).toHaveBeenCalledWith('updater:status', { state: 'checking' })
  })

  it('skips destroyed windows', () => {
    const liveSend = vi.fn()
    mocks.browserWindows = [
      { isDestroyed: () => true, webContents: { send: vi.fn() } },
      { isDestroyed: () => false, webContents: { send: liveSend } },
    ]
    initAutoUpdater()
    const handler = getHandler('checking-for-update')
    handler()
    expect(liveSend).toHaveBeenCalled()
  })

  it('handles disposed webContents gracefully', () => {
    const badSend = vi.fn().mockImplementation(() => {
      throw new Error('Render frame was disposed')
    })
    mocks.browserWindows = [{ isDestroyed: () => false, webContents: { send: badSend } }]
    initAutoUpdater()
    const handler = getHandler('checking-for-update')
    expect(() => handler()).not.toThrow()
  })

  it('writes to stdout in daemon mode instead of sending to windows', () => {
    const writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const winSend = vi.fn()
    mocks.browserWindows = [{ isDestroyed: () => false, webContents: { send: winSend } }]
    initAutoUpdater({ daemon: true })
    const handler = getHandler('checking-for-update')
    handler()
    expect(writeSpy).toHaveBeenCalledWith(expect.stringContaining('[updater] checking'))
    expect(winSend).not.toHaveBeenCalled()
    writeSpy.mockRestore()
  })
})

describe('checkForUpdates', () => {
  it('calls autoUpdater.checkForUpdates', async () => {
    await checkForUpdates()
    expect(mocks.autoUpdaterCheck).toHaveBeenCalled()
  })

  it('rejects when check fails (no .catch in exported function)', async () => {
    mocks.autoUpdaterCheck.mockRejectedValueOnce(new Error('network error'))
    await expect(checkForUpdates()).rejects.toThrow('network error')
  })

  it('resolves immediately when app is not packaged', async () => {
    mocks.isPackaged = false
    await expect(checkForUpdates()).resolves.toBeUndefined()
    expect(mocks.autoUpdaterCheck).not.toHaveBeenCalled()
  })
})

describe('downloadUpdate', () => {
  it('calls autoUpdater.downloadUpdate', async () => {
    await downloadUpdate()
    expect(mocks.autoUpdaterDownload).toHaveBeenCalled()
  })

  it('resolves immediately when app is not packaged', async () => {
    mocks.isPackaged = false
    await expect(downloadUpdate()).resolves.toBeUndefined()
    expect(mocks.autoUpdaterDownload).not.toHaveBeenCalled()
  })
})

describe('installUpdate', () => {
  it('calls quitAndInstall', () => {
    installUpdate()
    expect(mocks.autoUpdaterQuitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('does nothing when app is not packaged', () => {
    mocks.isPackaged = false
    installUpdate()
    expect(mocks.autoUpdaterQuitAndInstall).not.toHaveBeenCalled()
  })
})

describe('setAutoDownload', () => {
  it('sets autoDownload on packaged build', () => {
    setAutoDownload(true)
    expect(mockAutoUpdater.autoDownload).toBe(true)
  })

  it('does nothing when app is not packaged', () => {
    mocks.isPackaged = false
    setAutoDownload(true)
    expect(mockAutoUpdater.autoDownload).toBe(false)
  })
})

describe('updateCheckInterval', () => {
  it('restarts periodic checks with new interval', () => {
    vi.useFakeTimers()
    mocks.settings.updateCheckIntervalHours = 24
    initAutoUpdater()
    expect(mocks.autoUpdaterCheck).toHaveBeenCalledTimes(1)
    updateCheckInterval(1)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(mocks.autoUpdaterCheck).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('does nothing when app is not packaged', () => {
    mocks.isPackaged = false
    vi.useFakeTimers()
    updateCheckInterval(1)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(mocks.autoUpdaterCheck).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})

describe('startPeriodicChecks', () => {
  it('does not set interval when hours is zero', () => {
    mocks.settings.updateCheckIntervalHours = 0
    vi.useFakeTimers()
    initAutoUpdater()
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000)
    expect(mocks.autoUpdaterCheck).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('does not set interval when hours is negative', () => {
    mocks.settings.updateCheckIntervalHours = -1
    vi.useFakeTimers()
    initAutoUpdater()
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000)
    expect(mocks.autoUpdaterCheck).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('clears previous interval when restarted', () => {
    vi.useFakeTimers()
    mocks.settings.updateCheckIntervalHours = 24
    initAutoUpdater()
    updateCheckInterval(1)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(mocks.autoUpdaterCheck).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('logs error when periodic check fails', async () => {
    vi.useFakeTimers()
    mocks.settings.updateCheckIntervalHours = 24
    mocks.autoUpdaterCheck.mockRejectedValue(new Error('periodic fail'))
    initAutoUpdater()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    await vi.waitFor(() => {
      expect(mocks.logger.error).toHaveBeenCalledWith('auto-updater', 'Periodic check failed: periodic fail')
    })
    vi.useRealTimers()
  })

  it('respects daemon autoDownload in periodic checks', () => {
    vi.useFakeTimers()
    initAutoUpdater({ daemon: true })
    mocks.settings.updateCheckIntervalHours = 1
    updateCheckInterval(1)
    vi.advanceTimersByTime(60 * 60 * 1000)
    expect(mockAutoUpdater.autoDownload).toBe(true)
    vi.useRealTimers()
  })
})
