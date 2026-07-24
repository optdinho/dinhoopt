import type { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const registerFns = {
    registerSystemCleanerIpc: vi.fn(),
    registerBrowserCleanerIpc: vi.fn(),
    registerAppCleanerIpc: vi.fn(),
    registerGamingCleanerIpc: vi.fn(),
    registerRecycleBinIpc: vi.fn(),
    registerShortcutCleanerIpc: vi.fn(),
    registerEnvironmentCleanerIpc: vi.fn(),
    registerDatabaseOptimizerIpc: vi.fn(),
    registerRegistryCleanerIpc: vi.fn(),
    registerContextMenuCleanerIpc: vi.fn(),
    registerStartupManagerIpc: vi.fn(),
    registerDebloaterIpc: vi.fn(),
    registerDiskAnalyzerIpc: vi.fn(),
    registerDiskTrimIpc: vi.fn(),
    registerDuplicateFinderIpc: vi.fn(),
    registerLargeFileFinderIpc: vi.fn(),
    registerEmptyFolderCleanerIpc: vi.fn(),
    registerNetworkCleanupIpc: vi.fn(),
    registerMalwareScannerIpc: vi.fn(),
    registerUninstallLeftoversIpc: vi.fn(),
    registerComplianceAuditorIpc: vi.fn(),
    registerVulnerabilityScannerIpc: vi.fn(),
    registerPrivacyShieldIpc: vi.fn(),
    registerDriverManagerIpc: vi.fn(),
    registerDriverAgentIpc: vi.fn(),
    registerPerfMonitorIpc: vi.fn(),
    registerProgramUninstallerIpc: vi.fn(),
    registerServiceManagerIpc: vi.fn(),
    registerFirewallAuditIpc: vi.fn(),
    registerSoftwareUpdaterIpc: vi.fn(),
    registerStartupSafetyIpc: vi.fn(),
    registerProgramSafetyIpc: vi.fn(),
    registerFileShredderIpc: vi.fn(),
    registerGameModeIpc: vi.fn(),
    registerWindowsTweaksIpc: vi.fn(),
    registerLicenseIpc: vi.fn(),
    registerBenchmarkIpc: vi.fn(),
    registerPowerPlansIpc: vi.fn(),
    registerLoggerIpc: vi.fn(),
    registerHostsEditorIpc: vi.fn(),
    registerWinSxSCleanerIpc: vi.fn(),
  }
  const ipcHandle = vi.fn()
  const ipcOn = vi.fn()
  const appEmit = vi.fn()

  return {
    registerFns,
    refreshGameDetector: vi.fn(),
    ipcHandle,
    ipcOn,
    appEmit,
    execFile: vi.fn(),
    mkdirSync: vi.fn(),
    isAbsolute: vi.fn((p: string) => /^(?:\/|[A-Za-z]:\\)/.test(p)),
    shellOpenPath: vi.fn(),
    showItemInFolder: vi.fn(),
    showOpenDialog: vi.fn(),
    validateSettingsPartial: vi.fn(),
    validateHistoryEntry: vi.fn(),
    getSettings: vi.fn(),
    setSettings: vi.fn(),
    getOnboardingComplete: vi.fn(),
    setOnboardingComplete: vi.fn(),
    isAdmin: vi.fn(),
    getHistory: vi.fn(),
    addHistoryEntry: vi.fn(),
    clearHistory: vi.fn(),
    getMemoryInfo: vi.fn(),
    getMemoryProcesses: vi.fn(),
    optimizeMemory: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    installUpdate: vi.fn(),
    getUpdateStatus: vi.fn(),
    getBackupDir: vi.fn(() => 'C:\\backup'),
    flushSettings: vi.fn(),
    setAutoDownload: vi.fn(),
    updateCheckInterval: vi.fn(),
    appGetPath: vi.fn((_: string) => 'C:\\dinho.exe'),
    appReleaseSingleInstanceLock: vi.fn(),
    appExit: vi.fn(),
    psUtf8: vi.fn((s: string) => s),
  }
})

vi.mock('electron', () => ({
  BrowserWindow: class {},
  app: {
    getPath: (p: string) => mocks.appGetPath(p),
    releaseSingleInstanceLock: (...args: unknown[]) => mocks.appReleaseSingleInstanceLock(...args),
    exit: (...args: unknown[]) => mocks.appExit(...args),
    emit: (...args: unknown[]) => mocks.appEmit(...args),
  },
  dialog: {
    showOpenDialog: (...args: unknown[]) => mocks.showOpenDialog(...args),
  },
  ipcMain: {
    handle: (...args: unknown[]) => mocks.ipcHandle(...args),
    on: (...args: unknown[]) => mocks.ipcOn(...args),
  },
  shell: {
    showItemInFolder: (...args: unknown[]) => mocks.showItemInFolder(...args),
    openPath: (...args: unknown[]) => mocks.shellOpenPath(...args),
  },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => ({
    log: vi.fn(),
  }),
}))

vi.mock('@shared/channels', () => ({
  RENDERER_LOG: 'renderer-log',
  IPC: {
    CLEANER_OPEN_LOCATION: 'cleaner:open-location',
    PLATFORM_INFO: 'platform:info',
    SETTINGS_GET: 'settings:get',
    SETTINGS_SET: 'settings:set',
    SETTINGS_SELECT_BACKUP_DIR: 'settings:select-backup-dir',
    SETTINGS_OPEN_BACKUP_DIR: 'settings:open-backup-dir',
    ONBOARDING_GET: 'onboarding:get',
    ONBOARDING_SET: 'onboarding:set',
    ELEVATION_CHECK: 'elevation:check',
    ELEVATION_RELAUNCH: 'elevation:relaunch',
    MEMORY_INFO: 'memory:info',
    MEMORY_OPTIMIZE: 'memory:optimize',
    MEMORY_PROGRESS: 'memory:progress',
    HISTORY_GET: 'history:get',
    HISTORY_ADD: 'history:add',
    HISTORY_CLEAR: 'history:clear',
    UPDATER_CHECK: 'updater:check',
    UPDATER_DOWNLOAD: 'updater:download',
    UPDATER_INSTALL: 'updater:install',
    UPDATER_GET_STATUS: 'updater:get-status',
  },
}))

vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]) => mocks.execFile(...args),
}))

vi.mock('node:fs', () => ({
  mkdirSync: (...args: unknown[]) => mocks.mkdirSync(...args),
}))

vi.mock('node:path', () => ({
  isAbsolute: (p: string) => mocks.isAbsolute(p),
}))

vi.mock('../services/exec-utf8', () => ({
  psUtf8: (s: string) => mocks.psUtf8(s),
}))

vi.mock('../services/auto-updater', () => ({
  checkForUpdates: (...args: unknown[]) => mocks.checkForUpdates(...args),
  downloadUpdate: (...args: unknown[]) => mocks.downloadUpdate(...args),
  installUpdate: (...args: unknown[]) => mocks.installUpdate(...args),
  getUpdateStatus: (...args: unknown[]) => mocks.getUpdateStatus(...args),
  setAutoDownload: (...args: unknown[]) => mocks.setAutoDownload(...args),
  updateCheckInterval: (...args: unknown[]) => mocks.updateCheckInterval(...args),
}))

vi.mock('../services/backup-dir', () => ({
  getBackupDir: () => mocks.getBackupDir(),
}))

vi.mock('../services/elevation', () => ({
  isAdmin: (...args: unknown[]) => mocks.isAdmin(...args),
}))

vi.mock('../services/history-store', () => ({
  addHistoryEntry: (...args: unknown[]) => mocks.addHistoryEntry(...args),
  clearHistory: (...args: unknown[]) => mocks.clearHistory(...args),
  getHistory: (...args: unknown[]) => mocks.getHistory(...args),
}))

vi.mock('../services/ipc-validation', () => ({
  validateHistoryEntry: (...args: unknown[]) => mocks.validateHistoryEntry(...args),
  validateSettingsPartial: (...args: unknown[]) => mocks.validateSettingsPartial(...args),
}))

vi.mock('../services/memory-optimizer', () => ({
  getMemoryInfo: (...args: unknown[]) => mocks.getMemoryInfo(...args),
  getMemoryProcesses: (...args: unknown[]) => mocks.getMemoryProcesses(...args),
  optimizeMemory: (...args: unknown[]) => mocks.optimizeMemory(...args),
}))

vi.mock('../services/settings-store', () => ({
  flushSettings: (...args: unknown[]) => mocks.flushSettings(...args),
  getOnboardingComplete: (...args: unknown[]) => mocks.getOnboardingComplete(...args),
  getSettings: (...args: unknown[]) => mocks.getSettings(...args),
  setOnboardingComplete: (...args: unknown[]) => mocks.setOnboardingComplete(...args),
  setSettings: (...args: unknown[]) => mocks.setSettings(...args),
}))

// Individual IPC module mocks
// GetWindow-taking functions (28 total)
vi.mock('./system-cleaner.ipc', () => ({
  registerSystemCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerSystemCleanerIpc(...a),
}))
vi.mock('./browser-cleaner.ipc', () => ({
  registerBrowserCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerBrowserCleanerIpc(...a),
}))
vi.mock('./app-cleaner.ipc', () => ({
  registerAppCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerAppCleanerIpc(...a),
}))
vi.mock('./gaming-cleaner.ipc', () => ({
  registerGamingCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerGamingCleanerIpc(...a),
}))
vi.mock('./shortcut-cleaner.ipc', () => ({
  registerShortcutCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerShortcutCleanerIpc(...a),
}))
vi.mock('./environment-cleaner.ipc', () => ({
  registerEnvironmentCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerEnvironmentCleanerIpc(...a),
}))
vi.mock('./database-optimizer.ipc', () => ({
  registerDatabaseOptimizerIpc: (...a: unknown[]) => mocks.registerFns.registerDatabaseOptimizerIpc(...a),
}))
vi.mock('./registry-cleaner.ipc', () => ({
  registerRegistryCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerRegistryCleanerIpc(...a),
}))
vi.mock('./context-menu-cleaner.ipc', () => ({
  registerContextMenuCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerContextMenuCleanerIpc(...a),
}))
vi.mock('./debloater.ipc', () => ({
  registerDebloaterIpc: (...a: unknown[]) => mocks.registerFns.registerDebloaterIpc(...a),
}))
vi.mock('./disk-analyzer.ipc', () => ({
  registerDiskAnalyzerIpc: (...a: unknown[]) => mocks.registerFns.registerDiskAnalyzerIpc(...a),
}))
vi.mock('./disk-trim.ipc', () => ({
  registerDiskTrimIpc: (...a: unknown[]) => mocks.registerFns.registerDiskTrimIpc(...a),
}))
vi.mock('./duplicate-finder.ipc', () => ({
  registerDuplicateFinderIpc: (...a: unknown[]) => mocks.registerFns.registerDuplicateFinderIpc(...a),
}))
vi.mock('./large-file-finder.ipc', () => ({
  registerLargeFileFinderIpc: (...a: unknown[]) => mocks.registerFns.registerLargeFileFinderIpc(...a),
}))
vi.mock('./empty-folder-cleaner.ipc', () => ({
  registerEmptyFolderCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerEmptyFolderCleanerIpc(...a),
}))
vi.mock('./malware-scanner.ipc', () => ({
  registerMalwareScannerIpc: (...a: unknown[]) => mocks.registerFns.registerMalwareScannerIpc(...a),
}))
vi.mock('./uninstall-leftovers.ipc', () => ({
  registerUninstallLeftoversIpc: (...a: unknown[]) => mocks.registerFns.registerUninstallLeftoversIpc(...a),
}))
vi.mock('./compliance-auditor.ipc', () => ({
  registerComplianceAuditorIpc: (...a: unknown[]) => mocks.registerFns.registerComplianceAuditorIpc(...a),
}))
vi.mock('./vulnerability-scanner.ipc', () => ({
  registerVulnerabilityScannerIpc: (...a: unknown[]) => mocks.registerFns.registerVulnerabilityScannerIpc(...a),
}))
vi.mock('./privacy-shield.ipc', () => ({
  registerPrivacyShieldIpc: (...a: unknown[]) => mocks.registerFns.registerPrivacyShieldIpc(...a),
}))
vi.mock('./driver-manager.ipc', () => ({
  registerDriverManagerIpc: (...a: unknown[]) => mocks.registerFns.registerDriverManagerIpc(...a),
}))
vi.mock('./driver-agent.ipc', () => ({
  registerDriverAgentIpc: (...a: unknown[]) => mocks.registerFns.registerDriverAgentIpc(...a),
}))
vi.mock('./perf-monitor.ipc', () => ({
  registerPerfMonitorIpc: (...a: unknown[]) => mocks.registerFns.registerPerfMonitorIpc(...a),
}))
vi.mock('./program-uninstaller.ipc', () => ({
  registerProgramUninstallerIpc: (...a: unknown[]) => mocks.registerFns.registerProgramUninstallerIpc(...a),
}))
vi.mock('./service-manager.ipc', () => ({
  registerServiceManagerIpc: (...a: unknown[]) => mocks.registerFns.registerServiceManagerIpc(...a),
}))
vi.mock('./firewall-audit.ipc', () => ({
  registerFirewallAuditIpc: (...a: unknown[]) => mocks.registerFns.registerFirewallAuditIpc(...a),
}))
vi.mock('./software-updater.ipc', () => ({
  registerSoftwareUpdaterIpc: (...a: unknown[]) => mocks.registerFns.registerSoftwareUpdaterIpc(...a),
}))
vi.mock('./file-shredder.ipc', () => ({
  registerFileShredderIpc: (...a: unknown[]) => mocks.registerFns.registerFileShredderIpc(...a),
}))
vi.mock('./windows-tweaks.ipc', () => ({
  registerWindowsTweaksIpc: (...a: unknown[]) => mocks.registerFns.registerWindowsTweaksIpc(...a),
}))
vi.mock('./benchmark.ipc', () => ({
  registerBenchmarkIpc: (...a: unknown[]) => mocks.registerFns.registerBenchmarkIpc(...a),
}))
vi.mock('./hosts-editor.ipc', () => ({
  registerHostsEditorIpc: (...a: unknown[]) => mocks.registerFns.registerHostsEditorIpc(...a),
}))
vi.mock('./winsxs-cleaner.ipc', () => ({
  registerWinSxSCleanerIpc: (...a: unknown[]) => mocks.registerFns.registerWinSxSCleanerIpc(...a),
}))

// No-arg functions (14 total)
vi.mock('./recycle-bin.ipc', () => ({
  registerRecycleBinIpc: (...a: unknown[]) => mocks.registerFns.registerRecycleBinIpc(...a),
}))
vi.mock('./startup-manager.ipc', () => ({
  registerStartupManagerIpc: (...a: unknown[]) => mocks.registerFns.registerStartupManagerIpc(...a),
}))
vi.mock('./network-cleanup.ipc', () => ({
  registerNetworkCleanupIpc: (...a: unknown[]) => mocks.registerFns.registerNetworkCleanupIpc(...a),
}))
vi.mock('./startup-safety.ipc', () => ({
  registerStartupSafetyIpc: (...a: unknown[]) => mocks.registerFns.registerStartupSafetyIpc(...a),
}))
vi.mock('./program-safety.ipc', () => ({
  registerProgramSafetyIpc: (...a: unknown[]) => mocks.registerFns.registerProgramSafetyIpc(...a),
}))
vi.mock('./license.ipc', () => ({
  registerLicenseIpc: (...a: unknown[]) => mocks.registerFns.registerLicenseIpc(...a),
}))
vi.mock('./power-plans.ipc', () => ({
  registerPowerPlansIpc: (...a: unknown[]) => mocks.registerFns.registerPowerPlansIpc(...a),
}))
vi.mock('./logger.ipc', () => ({ registerLoggerIpc: (...a: unknown[]) => mocks.registerFns.registerLoggerIpc(...a) }))
// game-mode.ipc exports both registerGameModeIpc and refreshGameDetector
vi.mock('./game-mode.ipc', () => ({
  registerGameModeIpc: (...a: unknown[]) => mocks.registerFns.registerGameModeIpc(...a),
  refreshGameDetector: (...a: unknown[]) => mocks.refreshGameDetector(...a),
}))

import { registerCleanerIpc } from './index'

const getHandler = (channel: string): ((...args: unknown[]) => unknown) => {
  const call = mocks.ipcHandle.mock.calls.find((c: unknown[]) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

const getWindow: () => BrowserWindow | null = () => null

beforeEach(() => {
  vi.clearAllMocks()
})

describe('registerCleanerIpc', () => {
  describe('register*Ipc delegation calls', () => {
    const withGetWindow: Array<keyof typeof mocks.registerFns> = [
      'registerSystemCleanerIpc',
      'registerBrowserCleanerIpc',
      'registerAppCleanerIpc',
      'registerGamingCleanerIpc',
      'registerShortcutCleanerIpc',
      'registerEnvironmentCleanerIpc',
      'registerDatabaseOptimizerIpc',
      'registerRegistryCleanerIpc',
      'registerContextMenuCleanerIpc',
      'registerDebloaterIpc',
      'registerDiskAnalyzerIpc',
      'registerDiskTrimIpc',
      'registerDuplicateFinderIpc',
      'registerLargeFileFinderIpc',
      'registerEmptyFolderCleanerIpc',
      'registerMalwareScannerIpc',
      'registerUninstallLeftoversIpc',
      'registerComplianceAuditorIpc',
      'registerVulnerabilityScannerIpc',
      'registerPrivacyShieldIpc',
      'registerDriverManagerIpc',
      'registerDriverAgentIpc',
      'registerPerfMonitorIpc',
      'registerProgramUninstallerIpc',
      'registerServiceManagerIpc',
      'registerFirewallAuditIpc',
      'registerSoftwareUpdaterIpc',
      'registerFileShredderIpc',
      'registerGameModeIpc',
      'registerWindowsTweaksIpc',
      'registerBenchmarkIpc',
      'registerHostsEditorIpc',
      'registerWinSxSCleanerIpc',
      'registerNetworkCleanupIpc',
    ]
    const withoutArgs: Array<keyof typeof mocks.registerFns> = [
      'registerRecycleBinIpc',
      'registerStartupManagerIpc',
      'registerStartupSafetyIpc',
      'registerProgramSafetyIpc',
      'registerLicenseIpc',
      'registerPowerPlansIpc',
      'registerLoggerIpc',
    ]

    it('calls all 41 register*Ipc functions with correct arguments', () => {
      registerCleanerIpc(getWindow)

      for (const f of withGetWindow) {
        expect(mocks.registerFns[f]).toHaveBeenCalledWith(getWindow)
      }
      for (const f of withoutArgs) {
        expect(mocks.registerFns[f]).toHaveBeenCalledWith()
      }
    })
  })

  describe(`${'cleaner:open-location'}`, () => {
    it('opens location for an absolute path string', () => {
      registerCleanerIpc(getWindow)
      const handler = getHandler('cleaner:open-location')
      handler({}, 'C:\\Users\\file.txt')
      expect(mocks.showItemInFolder).toHaveBeenCalledWith('C:\\Users\\file.txt')
    })

    it('ignores non-string input', () => {
      registerCleanerIpc(getWindow)
      const handler = getHandler('cleaner:open-location')
      handler({}, 123)
      expect(mocks.showItemInFolder).not.toHaveBeenCalled()
    })

    it('ignores non-absolute path', () => {
      mocks.isAbsolute.mockReturnValue(false)
      registerCleanerIpc(getWindow)
      const handler = getHandler('cleaner:open-location')
      handler({}, 'relative/path.txt')
      expect(mocks.showItemInFolder).not.toHaveBeenCalled()
    })
  })

  describe('platform:info', () => {
    it('returns platform info with win32 features', () => {
      registerCleanerIpc(getWindow)
      const handler = getHandler('platform:info')
      const result = handler() as {
        platform: string
        features: Record<string, boolean>
      }
      expect(result).toHaveProperty('platform')
      expect(result.features).toMatchObject({
        registry: expect.any(Boolean),
        debloater: expect.any(Boolean),
        drivers: expect.any(Boolean),
        bootTrace: expect.any(Boolean),
        gameMode: expect.any(Boolean),
        compliance: expect.any(Boolean),
        vulnerability: expect.any(Boolean),
        firewallAudit: expect.any(Boolean),
        contextMenu: expect.any(Boolean),
        windowsTweaks: expect.any(Boolean),
        benchmark: expect.any(Boolean),
      })
    })
  })

  describe('settings:get', () => {
    it('returns settings from store', () => {
      const settings = { theme: 'dark' }
      mocks.getSettings.mockReturnValue(settings)
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:get')
      expect(handler()).toEqual(settings)
    })
  })

  describe('settings:set', () => {
    it('validates and persists valid settings', async () => {
      const validated = { theme: 'dark' }
      mocks.validateSettingsPartial.mockReturnValue(validated)
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:set')
      const result = await handler(null, { theme: 'dark' })
      expect(mocks.setSettings).toHaveBeenCalledWith(validated)
      expect(result).toEqual({ success: true })
    })

    it('returns error for invalid settings', async () => {
      mocks.validateSettingsPartial.mockReturnValue(null)
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:set')
      const result = await handler(null, { theme: 'invalid' })
      expect(result).toEqual({ success: false, error: 'Invalid settings' })
      expect(mocks.setSettings).not.toHaveBeenCalled()
    })

    it('calls setAutoDownload when autoUpdate is boolean', async () => {
      mocks.validateSettingsPartial.mockReturnValue({ autoUpdate: true })
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:set')
      await handler(null, { autoUpdate: true })
      expect(mocks.setAutoDownload).toHaveBeenCalledWith(true)
    })

    it('calls updateCheckInterval when updateCheckIntervalHours is number', async () => {
      mocks.validateSettingsPartial.mockReturnValue({ updateCheckIntervalHours: 24 })
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:set')
      await handler(null, { updateCheckIntervalHours: 24 })
      expect(mocks.updateCheckInterval).toHaveBeenCalledWith(24)
    })

    it('flushes settings and emits language-changed when language is set', async () => {
      mocks.validateSettingsPartial.mockReturnValue({ language: 'pt-BR' })
      mocks.flushSettings.mockResolvedValue(undefined)
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:set')
      await handler(null, { language: 'pt-BR' })
      expect(mocks.flushSettings).toHaveBeenCalled()
      expect(mocks.appEmit).toHaveBeenCalledWith('dinho:language-changed')
    })

    it('flushes settings and refreshes game detector when gameMode changes', async () => {
      mocks.validateSettingsPartial.mockReturnValue({ gameMode: { autoDetect: true } })
      mocks.flushSettings.mockResolvedValue(undefined)
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:set')
      await handler(null, { gameMode: { autoDetect: true } })
      expect(mocks.flushSettings).toHaveBeenCalled()
      expect(mocks.refreshGameDetector).toHaveBeenCalledWith(getWindow)
    })

    it('handles both language and gameMode changes together', async () => {
      const validated = { language: 'en', gameMode: { autoDetect: true } }
      mocks.validateSettingsPartial.mockReturnValue(validated)
      mocks.flushSettings.mockResolvedValue(undefined)
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:set')
      await handler(null, validated)
      expect(mocks.flushSettings).toHaveBeenCalledTimes(2)
      expect(mocks.appEmit).toHaveBeenCalledWith('dinho:language-changed')
      expect(mocks.refreshGameDetector).toHaveBeenCalledWith(getWindow)
    })
  })

  describe('settings:select-backup-dir', () => {
    it('returns selected directory path', async () => {
      mocks.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['D:\\backup'] })
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:select-backup-dir')
      const result = await handler()
      expect(result).toBe('D:\\backup')
    })

    it('returns null when dialog is canceled', async () => {
      mocks.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:select-backup-dir')
      const result = await handler()
      expect(result).toBeNull()
    })
  })

  describe('settings:open-backup-dir', () => {
    it('creates backup dir and opens it', async () => {
      mocks.shellOpenPath.mockResolvedValue(undefined)
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:open-backup-dir')
      const result = await handler()
      expect(mocks.mkdirSync).toHaveBeenCalledWith('C:\\backup', { recursive: true })
      expect(mocks.shellOpenPath).toHaveBeenCalledWith('C:\\backup')
      expect(result).toBe('C:\\backup')
    })

    it('does not throw when mkdirSync fails', async () => {
      mocks.mkdirSync.mockImplementation(() => {
        throw new Error('permission denied')
      })
      mocks.shellOpenPath.mockResolvedValue(undefined)
      registerCleanerIpc(getWindow)
      const handler = getHandler('settings:open-backup-dir')
      await expect(handler()).resolves.toBe('C:\\backup')
    })
  })

  describe('onboarding:get', () => {
    it('returns onboarding status', () => {
      mocks.getOnboardingComplete.mockReturnValue(true)
      registerCleanerIpc(getWindow)
      const handler = getHandler('onboarding:get')
      expect(handler()).toBe(true)
    })
  })

  describe('onboarding:set', () => {
    it('sets onboarding to valid boolean', async () => {
      mocks.setOnboardingComplete.mockResolvedValue(undefined)
      registerCleanerIpc(getWindow)
      const handler = getHandler('onboarding:set')
      await handler(null, false)
      expect(mocks.setOnboardingComplete).toHaveBeenCalledWith(false)
    })

    it('ignores non-boolean value', async () => {
      registerCleanerIpc(getWindow)
      const handler = getHandler('onboarding:set')
      await handler(null, 'yes')
      expect(mocks.setOnboardingComplete).not.toHaveBeenCalled()
    })
  })

  describe('elevation:check', () => {
    it('returns admin status', () => {
      mocks.isAdmin.mockReturnValue(true)
      registerCleanerIpc(getWindow)
      const handler = getHandler('elevation:check')
      expect(handler()).toBe(true)
    })
  })

  describe('memory:info', () => {
    it('returns memory info and processes', async () => {
      const info = { total: 16000, used: 8000 }
      const processes = [{ name: 'test', memory: 100 }]
      mocks.getMemoryInfo.mockResolvedValue(info)
      mocks.getMemoryProcesses.mockResolvedValue(processes)
      registerCleanerIpc(getWindow)
      const handler = getHandler('memory:info')
      const result = await handler()
      expect(result).toEqual({ info, processes })
    })
  })

  describe('memory:optimize', () => {
    it('calls optimizeMemory with progress callback', async () => {
      mocks.optimizeMemory.mockImplementation(async (onProgress: (p: { percent: number; phase: string }) => void) => {
        onProgress({ percent: 50, phase: 'cleaning' })
        return { freed: 512 }
      })
      registerCleanerIpc(getWindow)
      const handler = getHandler('memory:optimize')
      const result = await handler()
      expect(result).toEqual({ freed: 512 })
    })
  })

  describe('history:get', () => {
    it('returns history', () => {
      const history = [{ id: '1', type: 'cleaner' }]
      mocks.getHistory.mockReturnValue(history)
      registerCleanerIpc(getWindow)
      const handler = getHandler('history:get')
      expect(handler()).toEqual(history)
    })
  })

  describe('history:add', () => {
    it('adds a validated entry', () => {
      const entry = { id: '1', type: 'cleaner' }
      mocks.validateHistoryEntry.mockReturnValue(entry)
      registerCleanerIpc(getWindow)
      const handler = getHandler('history:add')
      handler(null, entry)
      expect(mocks.addHistoryEntry).toHaveBeenCalledWith(entry)
    })

    it('ignores an invalid entry', () => {
      mocks.validateHistoryEntry.mockReturnValue(null)
      registerCleanerIpc(getWindow)
      const handler = getHandler('history:add')
      handler(null, { invalid: true })
      expect(mocks.addHistoryEntry).not.toHaveBeenCalled()
    })
  })

  describe('history:clear', () => {
    it('clears history', () => {
      registerCleanerIpc(getWindow)
      const handler = getHandler('history:clear')
      handler()
      expect(mocks.clearHistory).toHaveBeenCalledOnce()
    })
  })

  describe('auto-updater', () => {
    it('updater:check calls checkForUpdates', async () => {
      mocks.checkForUpdates.mockResolvedValue(undefined)
      registerCleanerIpc(getWindow)
      const handler = getHandler('updater:check')
      await handler()
      expect(mocks.checkForUpdates).toHaveBeenCalledOnce()
    })

    it('updater:download calls downloadUpdate', async () => {
      mocks.downloadUpdate.mockResolvedValue(undefined)
      registerCleanerIpc(getWindow)
      const handler = getHandler('updater:download')
      await handler()
      expect(mocks.downloadUpdate).toHaveBeenCalledOnce()
    })

    it('updater:install calls installUpdate', () => {
      registerCleanerIpc(getWindow)
      const handler = getHandler('updater:install')
      handler()
      expect(mocks.installUpdate).toHaveBeenCalledOnce()
    })

    it('updater:get-status calls getUpdateStatus', () => {
      mocks.getUpdateStatus.mockReturnValue({ status: 'up-to-date' })
      registerCleanerIpc(getWindow)
      const handler = getHandler('updater:get-status')
      const result = handler()
      expect(mocks.getUpdateStatus).toHaveBeenCalledOnce()
      expect(result).toEqual({ status: 'up-to-date' })
    })
  })
})
