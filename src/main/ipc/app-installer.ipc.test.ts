import type { AppInstallerApp, AppInstallProgress } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  listAvailableApps: vi.fn(),
  installApps: vi.fn(),
  cancelAppInstall: vi.fn(),
  resetAppInstallCancel: vi.fn(),
  webContentsSend: vi.fn(),
  getWindow: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('../services/app-installer', () => ({
  listAvailableApps: (...args: unknown[]) => mocks.listAvailableApps(...args),
  installApps: (...args: unknown[]) => mocks.installApps(...args),
  cancelAppInstall: (...args: unknown[]) => mocks.cancelAppInstall(...args),
  resetAppInstallCancel: (...args: unknown[]) => mocks.resetAppInstallCancel(...args),
}))

import { IPC } from '@shared/channels'
import { registerAppInstallerIpc } from './app-installer.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockWindow(): void {
  const win = { isDestroyed: () => false, webContents: { send: mocks.webContentsSend } }
  mocks.getWindow.mockReturnValue(win)
}

describe('registerAppInstallerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow()
  })

  it('registers all three IPC handlers', () => {
    registerAppInstallerIpc(mocks.getWindow)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain(IPC.APP_INSTALLER_LIST_AVAILABLE)
    expect(channels).toContain(IPC.APP_INSTALLER_INSTALL)
    expect(channels).toContain(IPC.APP_INSTALLER_CANCEL)
    expect(channels.length).toBe(3)
  })
})

describe('APP_INSTALLER_LIST_AVAILABLE handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow()
    registerAppInstallerIpc(mocks.getWindow)
  })

  const app: AppInstallerApp = {
    id: 'Mozilla.Firefox',
    name: 'Firefox',
    description: 'Browser',
    category: 'browser',
    isInstalled: false,
  }

  it('returns the list result on success', async () => {
    mocks.listAvailableApps.mockResolvedValue({ apps: [app], wingetAvailable: true })
    const result = await getHandler(IPC.APP_INSTALLER_LIST_AVAILABLE)()
    expect(result).toEqual({ apps: [app], wingetAvailable: true })
    expect(mocks.logger.info).toHaveBeenCalledWith('app-installer', 'Found 1 apps, winget available: true')
  })

  it('returns empty result on failure', async () => {
    mocks.listAvailableApps.mockRejectedValue(new Error('boom'))
    const result = await getHandler(IPC.APP_INSTALLER_LIST_AVAILABLE)()
    expect(result).toEqual({ apps: [], wingetAvailable: false })
    expect(mocks.logger.error).toHaveBeenCalledWith('app-installer', 'List failed: boom')
  })
})

describe('APP_INSTALLER_INSTALL handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow()
    registerAppInstallerIpc(mocks.getWindow)
  })

  it('returns empty result when no app IDs provided', async () => {
    const result = await getHandler(IPC.APP_INSTALLER_INSTALL)(null)
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
    expect(mocks.logger.warning).toHaveBeenCalledWith('app-installer', 'No app IDs provided for install')
  })

  it('returns empty result for empty array', async () => {
    const result = await getHandler(IPC.APP_INSTALLER_INSTALL)(undefined, [])
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
  })

  it('filters non-string and oversized IDs before installing', async () => {
    mocks.installApps.mockResolvedValue({ succeeded: 1, failed: 0, errors: [] })
    const result = await getHandler(IPC.APP_INSTALLER_INSTALL)(undefined, [
      'Mozilla.Firefox',
      42,
      'x'.repeat(300),
      '',
      'Google.Chrome',
    ])
    expect(result).toEqual({ succeeded: 1, failed: 0, errors: [] })
    expect(mocks.installApps).toHaveBeenCalledWith(['Mozilla.Firefox', 'Google.Chrome'], expect.any(Function))
  })

  it('forwards install progress to the renderer window', async () => {
    mocks.installApps.mockImplementation(async (_ids: string[], onProgress: (p: AppInstallProgress) => void) => {
      onProgress({
        phase: 'installing',
        current: 1,
        total: 1,
        currentApp: 'Mozilla.Firefox',
        percent: 0,
        status: 'in-progress',
      })
      return { succeeded: 1, failed: 0, errors: [] }
    })
    await getHandler(IPC.APP_INSTALLER_INSTALL)(undefined, ['Mozilla.Firefox'])
    expect(mocks.webContentsSend).toHaveBeenCalledWith(IPC.APP_INSTALLER_PROGRESS, {
      phase: 'installing',
      current: 1,
      total: 1,
      currentApp: 'Mozilla.Firefox',
      percent: 0,
      status: 'in-progress',
    })
  })

  it('logs success after install completes', async () => {
    mocks.installApps.mockResolvedValue({ succeeded: 1, failed: 1, errors: [] })
    await getHandler(IPC.APP_INSTALLER_INSTALL)(undefined, ['Mozilla.Firefox', 'Google.Chrome'])
    expect(mocks.logger.success).toHaveBeenCalledWith('app-installer', 'Install complete: 1 succeeded, 1 failed')
  })
})

describe('APP_INSTALLER_CANCEL handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockWindow()
    registerAppInstallerIpc(mocks.getWindow)
  })

  it('cancels and resets the install flag', () => {
    getHandler(IPC.APP_INSTALLER_CANCEL)()
    expect(mocks.cancelAppInstall).toHaveBeenCalled()
    expect(mocks.resetAppInstallCancel).toHaveBeenCalled()
  })
})
