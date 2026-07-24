import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { validateGameModeConfig as realValidateGameModeConfig } from './game-mode/validation'

// ─── Mock external dependencies ──────────────────────────────────────

const execFileAsyncMock = vi.fn()
execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

vi.mock('child_process', () => ({
  execFile: Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: execFileAsyncMock,
  }),
}))

const fsExistsSync = vi.fn<(...args: unknown[]) => boolean>()
const fsReadFileSync = vi.fn<(...args: unknown[]) => string>()
const fsWriteFileSync = vi.fn<(...args: unknown[]) => void>()
const fsUnlinkSync = vi.fn<(...args: unknown[]) => void>()

vi.mock('node:fs', () => ({
  existsSync: fsExistsSync,
  readFileSync: fsReadFileSync,
  writeFileSync: fsWriteFileSync,
  unlinkSync: fsUnlinkSync,
}))

vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    app: {
      isPackaged: false,
      getPath: () => '/mock/userData',
    },
    ipcMain: {
      handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
        return handler
      }),
      _handlers: handlers,
    },
    powerSaveBlocker: {
      start: vi.fn(() => 42),
      stop: vi.fn(),
      isStarted: vi.fn(() => true),
    },
    BrowserWindow: vi.fn(),
  }
})

const mockGetPlatform = vi.fn()
vi.mock('../platform', () => ({
  getPlatform: mockGetPlatform,
}))

const mockIsAdmin = vi.fn()
vi.mock('../services/elevation', () => ({
  isAdmin: mockIsAdmin,
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: execFileAsyncMock,
  psUtf8: (cmd: string) => cmd,
}))

const mockGetDetectedGame = vi.fn()
const mockIsDetectorRunning = vi.fn()
const mockStartGameDetector = vi.fn()
const mockStopGameDetector = vi.fn()
const mockSuppressCurrentGame = vi.fn()
vi.mock('../services/game-detector', () => ({
  getDetectedGame: mockGetDetectedGame,
  isDetectorRunning: mockIsDetectorRunning,
  startGameDetector: mockStartGameDetector,
  stopGameDetector: mockStopGameDetector,
  suppressCurrentGame: mockSuppressCurrentGame,
}))

const mockRunGameModeAudit = vi.fn()
vi.mock('../services/game-mode-audit', () => ({
  runGameModeAudit: mockRunGameModeAudit,
}))

const mockLogger = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }
vi.mock('../services/logger.service', () => ({
  getLogger: () => mockLogger,
}))

const mockGetSettings = vi.fn()
vi.mock('../services/settings-store', () => ({
  getSettings: mockGetSettings,
}))

const mockIsGameCompatible = vi.fn()
vi.mock('@shared/service-safety-kb', () => ({
  isGameCompatible: mockIsGameCompatible,
}))

import { IPC } from '@shared/channels'
import type { GameModeConfig, GameModeSnapshot } from '@shared/types'
import { ipcMain, powerSaveBlocker } from 'electron'
import type { GameAutoEvent, GameDetectorCallbacks } from '../services/game-detector'
import type { WindowGetter } from './index'

// ─── Helpers ─────────────────────────────────────────────────────────

const VALID_SERVICE_NAMES = new Set(['WSearch', 'SysMain', 'wuauserv', 'Spooler', 'DiagTrack'])
const REGISTRY_PATH_RE =
  /^Microsoft\.PowerShell\.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{[0-9A-Fa-f\-]+}$/
const ALLOWED_REGISTRY_TWEAK_PATHS = new Set([
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
  'HKCU:\\System\\GameConfigStore',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
])
const ALLOWED_REGISTRY_TWEAK_NAMES = new Set([
  'AppCaptureEnabled',
  'GameDVR_Enabled',
  'GameDVR_FSEBehaviorMode',
  'GameDVR_HonorUserFSEBehaviorMode',
  'GameDVR_DXGIHonorFSEWindowsCompatible',
  'GameDVR_EFSEFeatureFlags',
  'EnableTransparency',
])

function makeValidSnapshot(): GameModeSnapshot {
  return {
    activatedAt: '2026-06-14T10:30:00.000Z',
    active: true,
    services: [{ name: 'WSearch', originalStartType: 'Automatic', wasRunning: true }],
    killedProcesses: [{ pid: 1234, name: 'chrome.exe' }],
    originalPowerPlanGuid: '381b4222-f694-41f0-9685-ff5bb260df2e',
    originalFocusAssistState: 1,
    powerSaveBlockerId: 42,
    originalTimerResolution: 156250,
    nagleInterfaces: [
      {
        path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{abc12345-1234-5678-9abc-def012345678}',
        originalTcpNoDelay: null,
        originalTcpAckFrequency: 2,
      },
    ],
    registryTweaks: [
      {
        path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
        name: 'AppCaptureEnabled',
        originalValue: 1,
      },
    ],
    gameProcessPriorities: [{ name: 'cs2.exe', pid: 5678, originalPriority: 'Normal' }],
  }
}

function configurePsMock(scriptContains: string, stdout: string): void {
  execFileAsyncMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
    const full = (args as string[]).join(' ')
    if (full.includes(scriptContains)) {
      return Promise.resolve({ stdout, stderr: '' })
    }
    return Promise.resolve({ stdout: '', stderr: '' })
  })
}

function setMockSnapshot(snapshot: GameModeSnapshot | null): void {
  if (snapshot) {
    fsExistsSync.mockReturnValue(true)
    fsReadFileSync.mockReturnValue(JSON.stringify(snapshot))
  } else {
    fsExistsSync.mockReturnValue(false)
    fsReadFileSync.mockReturnValue('')
  }
}

function setDefaultMocks(): void {
  mockIsAdmin.mockReturnValue(true)
  mockGetDetectedGame.mockReturnValue(null)
  mockIsGameCompatible.mockReturnValue(true)
  mockGetPlatform.mockReturnValue({
    network: { flushDnsCache: vi.fn().mockResolvedValue(true) },
  })
  execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
  fsExistsSync.mockReturnValue(false)
  fsReadFileSync.mockReturnValue('')
  fsWriteFileSync.mockReset()
  fsUnlinkSync.mockReset()
  setMockSnapshot(null)
}

const originalPlatform = process.platform
beforeEach(() => {
  vi.clearAllMocks()
  setDefaultMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

// ─── Import after mocks ──────────────────────────────────────────────

let activateGameMode: typeof import('./game-mode.ipc').activateGameMode
let deactivateGameMode: typeof import('./game-mode.ipc').deactivateGameMode
let getGameModeStatus: typeof import('./game-mode.ipc').getGameModeStatus
let registerGameModeIpc: typeof import('./game-mode.ipc').registerGameModeIpc
let initGameDetector: typeof import('./game-mode.ipc').initGameDetector
let refreshGameDetector: typeof import('./game-mode.ipc').refreshGameDetector

beforeEach(async () => {
  const mod = await import('./game-mode.ipc')
  activateGameMode = mod.activateGameMode
  deactivateGameMode = mod.deactivateGameMode
  getGameModeStatus = mod.getGameModeStatus
  registerGameModeIpc = mod.registerGameModeIpc
  initGameDetector = mod.initGameDetector
  refreshGameDetector = mod.refreshGameDetector
})

// ═══════════════════════════════════════════════════════════════════════
// activateGameMode
// ═══════════════════════════════════════════════════════════════════════

describe('activateGameMode', () => {
  const onProgress = vi.fn()

  beforeEach(() => {
    onProgress.mockReset()
  })

  it('returns succeeded=0 for empty enabledOptimizations', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: [] as string[],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
    expect(onProgress).not.toHaveBeenCalled()
  })

  it('handles nullable id in enabledOptimizations', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: ['', 'mem-clear-standby'] as GameModeConfig['enabledOptimizations'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('activates service optimizations', async () => {
    mockIsAdmin.mockReturnValue(true)
    execFileAsyncMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
      const full = (args as string[]).join(' ')
      if (full.includes('Get-Service')) {
        return Promise.resolve({ stdout: JSON.stringify({ StartType: 'Automatic', Status: 'Running' }), stderr: '' })
      }
      // Stop-Service, Set-Service, or other ps() calls
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['svc-wsearch'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('requires admin for service optimizations', async () => {
    mockIsAdmin.mockReturnValue(false)

    const result = await activateGameMode(
      {
        enabledOptimizations: ['svc-wsearch'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.optimizationId).toBe('svc-wsearch')
    expect(result.errors[0]?.reason).toMatch(/Administrator/)
  })

  it('skips service incompatible with detected game', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockGetDetectedGame.mockReturnValue('fivem')
    mockIsGameCompatible.mockReturnValue(false)

    const result = await activateGameMode(
      {
        enabledOptimizations: ['svc-diagtrack'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    // failed counts errors.length, which includes the skipped incompatible entry
    expect(result.failed).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.reason).toMatch(/incompatible/)
    expect(fsWriteFileSync).not.toHaveBeenCalled()
  })

  it('catches non-Error thrown during service optimization', async () => {
    mockIsAdmin.mockReturnValue(true)
    execFileAsyncMock.mockRejectedValue('string error')

    const result = await activateGameMode(
      {
        enabledOptimizations: ['svc-wsearch'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toBe('Unknown error')
  })

  it('kills browser processes', async () => {
    execFileAsyncMock.mockImplementation((_cmd: unknown) => {
      return Promise.resolve({ stdout: '"chrome.exe","4321"\n"firefox.exe","5321"\n"csrss.exe","4"\n', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-browsers'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(result.failed).toBe(0)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('kills chat processes', async () => {
    execFileAsyncMock.mockImplementation((_cmd: unknown) => {
      return Promise.resolve({ stdout: '"Discord.exe","4321"\n"Teams.exe","5321"\n', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-chat'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('kills updater processes', async () => {
    execFileAsyncMock.mockImplementation((_cmd: unknown) => {
      return Promise.resolve({ stdout: '"GoogleUpdate.exe","4321"\n', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-updaters'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('kills custom processes', async () => {
    execFileAsyncMock.mockImplementation((_cmd: unknown) => {
      return Promise.resolve({ stdout: '"spotify.exe","4321"\n', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-custom'],
        customProcessKillList: ['spotify.exe'],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('succeeds proc-kill-custom with empty kill list', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-custom'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('catches process kill errors', async () => {
    mockIsAdmin.mockReturnValue(true)
    execFileAsyncMock.mockImplementation((cmd: unknown) => {
      if ((cmd as string) === 'tasklist') {
        return Promise.resolve({ stdout: '"chrome.exe","4321"\n', stderr: '' })
      }
      if ((cmd as string) === 'taskkill') {
        return Promise.reject(new Error('Access denied'))
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-browsers'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('handles non-Error in process kill catch', async () => {
    execFileAsyncMock.mockImplementation((cmd: unknown) => {
      if ((cmd as string) === 'tasklist') {
        return Promise.resolve({ stdout: '"chrome.exe","4321"\n', stderr: '' })
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-browsers'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('handles tasklist enumeration failure', async () => {
    execFileAsyncMock.mockImplementation((cmd: unknown) => {
      if ((cmd as string) === 'tasklist') {
        return Promise.reject(new Error('Enumeration failed'))
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-browsers'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    // tasklist fails, error added to r.errors, then thrown, caught by outer catch
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('clears standby memory', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: ['mem-clear-standby'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('enables focus assist', async () => {
    configurePsMock('NOC_GLOBAL_SETTING_TOASTS_ENABLED', '1')

    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-focus-assist'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('enables focus assist when initial PowerShell call fails', async () => {
    let callCount = 0
    execFileAsyncMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
      const full = (args as string[]).join(' ')
      callCount++
      // First ps() call (get original state) fails
      if (full.includes('NOC_GLOBAL_SETTING_TOASTS_ENABLED') && callCount <= 1) {
        return Promise.reject(new Error('PowerShell error'))
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-focus-assist'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('captures and sets high performance power plan', async () => {
    configurePsMock('powercfg /GETACTIVESCHEME', '381b4222-f694-41f0-9685-ff5bb260df2e')

    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-power-plan'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('handles power plan capture failure', async () => {
    execFileAsyncMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
      const full = (args as string[]).join(' ')
      if (full.includes('powercfg /GETACTIVESCHEME')) {
        return Promise.reject(new Error('powercfg not found'))
      }
      if (full.includes('powercfg')) {
        return Promise.resolve({ stdout: '', stderr: '' })
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-power-plan'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('prevents display sleep', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-prevent-sleep'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-display-sleep')
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('disables game bar', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-disable-game-bar'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('disables fullscreen optimizations', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-disable-fse-opt'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('disables transparency', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-disable-transparency'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('applies timer resolution', async () => {
    configurePsMock('wPeriodMin', '156250')

    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-timer-resolution'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('handles timer resolution capture failure', async () => {
    let callCount = 0
    execFileAsyncMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
      const full = (args as string[]).join(' ')
      callCount++
      // First timer resolution call (capture) fails
      if (full.includes('timeGetDevCaps') || full.includes('wPeriodMin')) {
        if (callCount <= 1) return Promise.reject(new Error('PowerShell error'))
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['sys-timer-resolution'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('sets game CPU priority (with detected game)', async () => {
    mockGetDetectedGame.mockReturnValue('cs2.exe')
    const psMock = execFileAsyncMock
    let callCount = 0
    psMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
      const full = (args as string[]).join(' ')
      callCount++
      if (full.includes('Get-Process -Name')) {
        if (callCount <= 1) {
          return Promise.resolve({ stdout: 'Normal\n', stderr: '' })
        }
        return Promise.resolve({ stdout: '{"Id":5678,"PriorityClass":"Normal"}', stderr: '' })
      }
      if (full.includes('PriorityClass')) {
        return Promise.resolve({ stdout: '', stderr: '' })
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['cpu-game-priority'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('handles missing detected game for CPU priority', async () => {
    mockGetDetectedGame.mockReturnValue(null)

    const result = await activateGameMode(
      {
        enabledOptimizations: ['cpu-game-priority'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('handles CPU priority JSON parse failure', async () => {
    mockGetDetectedGame.mockReturnValue('cs2.exe')
    let callCount = 0
    execFileAsyncMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
      const full = (args as string[]).join(' ')
      callCount++
      if (full.includes('Get-Process -Name')) {
        if (callCount <= 1) return Promise.resolve({ stdout: 'Normal\n', stderr: '' })
        return Promise.resolve({ stdout: 'not-json', stderr: '' })
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['cpu-game-priority'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
  })

  it('can flush DNS cache', async () => {
    const mockFlushDns = vi.fn().mockResolvedValue(true)
    mockGetPlatform.mockReturnValue({
      network: { flushDnsCache: mockFlushDns },
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['net-flush-dns'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(mockFlushDns).toHaveBeenCalled()
  })

  it('throws error when DNS flush fails', async () => {
    const mockFlushDns = vi.fn().mockResolvedValue(false)
    mockGetPlatform.mockReturnValue({
      network: { flushDnsCache: mockFlushDns },
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['net-flush-dns'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/DNS flush failed/)
  })

  it('handles DNS flush when flushDnsCache is undefined', async () => {
    mockGetPlatform.mockReturnValue({
      network: {},
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['net-flush-dns'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
  })

  it('disables Nagle algorithm', async () => {
    mockIsAdmin.mockReturnValue(true)
    configurePsMock(
      'Tcpip\\Parameters\\Interfaces',
      '[{"Path":"Microsoft.PowerShell.Core\\\\Registry::HKEY_LOCAL_MACHINE\\\\SYSTEM\\\\CurrentControlSet\\\\Services\\\\Tcpip\\\\Parameters\\\\Interfaces\\\\{abc}","TcpNoDelay":0,"TcpAckFrequency":2}]',
    )

    const result = await activateGameMode(
      {
        enabledOptimizations: ['net-disable-nagle'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('requires admin for Nagle optimization', async () => {
    mockIsAdmin.mockReturnValue(false)

    const result = await activateGameMode(
      {
        enabledOptimizations: ['net-disable-nagle'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/Administrator/)
  })

  it('handles non-Error throw in main catch block', async () => {
    mockIsAdmin.mockReturnValue(true)
    execFileAsyncMock.mockImplementation((cmd: unknown) => {
      if ((cmd as string) === 'powershell.exe') {
        // Throw a non-Error value
        // eslint-disable-next-line no-throw-literal
        throw 'string error'
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['svc-wsearch'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toBe('Unknown error')
  })

  it('calls onProgress with correct progress values', async () => {
    const progress = vi.fn()

    await activateGameMode(
      {
        enabledOptimizations: ['mem-clear-standby', 'sys-focus-assist'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      progress,
    )

    expect(progress).toHaveBeenCalledTimes(2)
    expect(progress).toHaveBeenCalledWith({
      phase: 'activating',
      current: 1,
      total: 2,
      currentLabel: 'mem-clear-standby',
    })
    expect(progress).toHaveBeenCalledWith({
      phase: 'activating',
      current: 2,
      total: 2,
      currentLabel: 'sys-focus-assist',
    })
  })

  it('writes snapshot only when succeeded > 0', async () => {
    mockIsAdmin.mockReturnValue(false) // all will fail

    const result = await activateGameMode(
      {
        enabledOptimizations: ['svc-wsearch'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    // snapshot should not be written when nothing succeeded
    const writeCalls = fsWriteFileSync.mock.calls.filter((c) => String(c[0]).includes('snapshot'))
    expect(writeCalls).toHaveLength(0)
  })

  it('handles error from process.kill falling back to taskkill', async () => {
    execFileAsyncMock.mockImplementation((cmd: unknown, _args: unknown[]) => {
      if ((cmd as string) === 'tasklist') {
        return Promise.resolve({ stdout: '"chrome.exe","4321"\n', stderr: '' })
      }
      if ((cmd as string) === 'taskkill') {
        return Promise.resolve({ stdout: '', stderr: '' })
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })
    // process.kill throws, so fallback to taskkill should be used
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('process.kill failed')
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-browsers'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(1)
    expect(result.errors).toHaveLength(0)
  })

  it('handles error with non-Error in taskkill fallback', async () => {
    execFileAsyncMock.mockImplementation((cmd: unknown) => {
      if ((cmd as string) === 'tasklist') {
        return Promise.resolve({ stdout: '"chrome.exe","4321"\n', stderr: '' })
      }
      if ((cmd as string) === 'taskkill') {
        return Promise.reject('string error from taskkill' as unknown as Error)
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })
    vi.spyOn(process, 'kill').mockImplementation(() => {
      throw new Error('process.kill failed')
    })

    const result = await activateGameMode(
      {
        enabledOptimizations: ['proc-kill-browsers'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toMatch(/Failed to kill/)
  })

  it('skips unknown optimization IDs silently', async () => {
    const result = await activateGameMode(
      {
        enabledOptimizations: ['unknown-opt'] as unknown as GameModeConfig['enabledOptimizations'],
        customProcessKillList: [] as string[],
      } as GameModeConfig,
      onProgress,
    )

    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// deactivateGameMode
// ═══════════════════════════════════════════════════════════════════════

describe('deactivateGameMode', () => {
  const onProgress = vi.fn()

  beforeEach(() => {
    onProgress.mockReset()
  })

  it('returns restored=0 when no snapshot exists', async () => {
    setMockSnapshot(null)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('restores services, power plan, focus assist, timer, power blocker, nagle, game priority, registry tweaks', async () => {
    setMockSnapshot(makeValidSnapshot())
    mockGetDetectedGame.mockReturnValue(null)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
    expect(result.failed).toBe(0)
    // power blocker should have been stopped
    expect(powerSaveBlocker.stop).toHaveBeenCalledWith(42)
    // snapshot should be deleted on full success
    expect(fsUnlinkSync).toHaveBeenCalled()
  })

  it('handles non-Error throw in restore step', async () => {
    setMockSnapshot(makeValidSnapshot())
    // All execFileAsync calls fail with a string (non-Error)
    execFileAsyncMock.mockRejectedValue('string error' as unknown as Error)

    const result = await deactivateGameMode(onProgress)

    // Some steps (powerSaveBlocker, gamePriority) don't call execFileAsync or
    // catch internally, so they still succeed. But at least one should fail.
    expect(result.failed).toBeGreaterThan(0)
    expect(result.errors.some((e) => e.reason === 'Unknown error')).toBe(true)
    // residual should be written with active=false
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('persists residual snapshot on partial failure', async () => {
    const snap = makeValidSnapshot()
    snap.registryTweaks = [
      {
        path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
        name: 'AppCaptureEnabled',
        originalValue: 1,
      },
    ]
    setMockSnapshot(snap)
    execFileAsyncMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
      const full = (args as string[]).join(' ')
      // Make Set-ItemProperty for registry restoration fail
      if (full.includes('Set-ItemProperty') && full.includes('AppCaptureEnabled')) {
        return Promise.reject(new Error('Registry access denied'))
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await deactivateGameMode(onProgress)

    expect(result.failed).toBeGreaterThan(0)
    // residual should be written
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('does not try to restore power plan when GUID is null', async () => {
    const snap = makeValidSnapshot()
    snap.originalPowerPlanGuid = null
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('does not try to restore focus assist when state is null', async () => {
    const snap = makeValidSnapshot()
    snap.originalFocusAssistState = null
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('does not try to restore timer resolution when value is null', async () => {
    const snap = makeValidSnapshot()
    snap.originalTimerResolution = null
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('does not try to stop powerSaveBlocker when ids are null', async () => {
    const snap = makeValidSnapshot()
    snap.powerSaveBlockerId = null
    setMockSnapshot(snap)
    // activePowerBlockerId is module-level; we can't easily reset it,
    // but the code checks the snapshot's ID first

    const result = await deactivateGameMode(onProgress)

    // Should not fail
    expect(result.restored).toBeGreaterThan(0)
  })

  it('skips nagle restoration when no nagle interfaces exist', async () => {
    const snap = makeValidSnapshot()
    snap.nagleInterfaces = []
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('skips game priority restoration when no entries exist', async () => {
    const snap = makeValidSnapshot()
    snap.gameProcessPriorities = []
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('skips registry tweaks restoration when no tweaks exist', async () => {
    const snap = makeValidSnapshot()
    snap.registryTweaks = []
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('calls onProgress with progress values', async () => {
    setMockSnapshot(makeValidSnapshot())
    const progress = vi.fn()

    await deactivateGameMode(progress)

    expect(progress).toHaveBeenCalled()
    expect(progress.mock.calls[0]?.[0]).toMatchObject({
      phase: 'deactivating',
      current: 1,
    })
  })

  it('restores Nagle interfaces with null originalTcpNoDelay (removes property)', async () => {
    const snap = makeValidSnapshot()
    // Minimal snapshot with only Nagle interfaces (empty arrays for everything else)
    snap.services = []
    snap.killedProcesses = []
    snap.originalPowerPlanGuid = null
    snap.originalFocusAssistState = null
    snap.powerSaveBlockerId = null
    snap.originalTimerResolution = null
    snap.registryTweaks = []
    snap.gameProcessPriorities = []
    snap.nagleInterfaces = [
      {
        path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{abc12345-1234-5678-9abc-def012345678}',
        originalTcpNoDelay: null,
        originalTcpAckFrequency: null,
      },
    ]
    setMockSnapshot(snap)
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBe(1)
    expect(result.failed).toBe(0)
  })

  it('restores registry tweak with null originalValue (removes property)', async () => {
    const snap = makeValidSnapshot()
    snap.registryTweaks = [
      {
        path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
        name: 'AppCaptureEnabled',
        originalValue: null,
      },
    ]
    setMockSnapshot(snap)
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('restores game priority', async () => {
    const snap = makeValidSnapshot()
    snap.gameProcessPriorities = [{ name: 'cs2.exe', pid: 5678, originalPriority: 'Normal' }]
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('handles Nagle restoration failure and logs it', async () => {
    const snap = makeValidSnapshot()
    snap.nagleInterfaces = [
      {
        path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{abc12345-1234-5678-9abc-def012345678}',
        originalTcpNoDelay: 1,
        originalTcpAckFrequency: 2,
      },
    ]
    setMockSnapshot(snap)
    let nagleCallCount = 0
    execFileAsyncMock.mockImplementation((_cmd: unknown, args: unknown[]) => {
      const full = (args as string[]).join(' ')
      if (full.includes('TcpNoDelay')) {
        nagleCallCount++
        if (nagleCallCount > 1) {
          return Promise.reject(new Error('Nagle restore failed'))
        }
      }
      if (full.includes('TcpAckFrequency')) {
        return Promise.reject(new Error('Ack frequency restore failed'))
      }
      return Promise.resolve({ stdout: '', stderr: '' })
    })

    const result = await deactivateGameMode(onProgress)

    // Some steps should have failed
    expect(result.failed).toBeGreaterThan(0)
  })

  it('restores services with various start types', async () => {
    const snap = makeValidSnapshot()
    snap.services = [
      { name: 'WSearch', originalStartType: 'Automatic', wasRunning: true },
      { name: 'SysMain', originalStartType: 'Manual', wasRunning: false },
      { name: 'wuauserv', originalStartType: 'Disabled', wasRunning: false },
      { name: 'Spooler', originalStartType: 'Boot', wasRunning: false },
      { name: 'DiagTrack', originalStartType: 'System', wasRunning: false },
    ]
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('maps numeric start types correctly', async () => {
    const snap = makeValidSnapshot()
    snap.services = [
      { name: 'WSearch', originalStartType: '2', wasRunning: false },
      { name: 'SysMain', originalStartType: '3', wasRunning: false },
      { name: 'wuauserv', originalStartType: '4', wasRunning: false },
    ]
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('restores service that was running but service type is Disabled (no start)', async () => {
    const snap = makeValidSnapshot()
    snap.services = [{ name: 'WSearch', originalStartType: 'Disabled', wasRunning: true }]
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })

  it('restores service with unknown start type (defaults to Manual)', async () => {
    const snap = makeValidSnapshot()
    snap.services = [{ name: 'WSearch', originalStartType: 'UnknownValue', wasRunning: false }]
    setMockSnapshot(snap)

    const result = await deactivateGameMode(onProgress)

    expect(result.restored).toBeGreaterThan(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// getGameModeStatus
// ═══════════════════════════════════════════════════════════════════════

describe('getGameModeStatus', () => {
  it('returns active=false when no snapshot exists', () => {
    setMockSnapshot(null)
    const status = getGameModeStatus()
    expect(status.active).toBe(false)
    expect(status.activatedAt).toBeNull()
    expect(status.pendingRestore).toBe(false)
  })

  it('returns active=true when snapshot.active is true', () => {
    setMockSnapshot(makeValidSnapshot())
    const status = getGameModeStatus()
    expect(status.active).toBe(true)
    expect(status.activatedAt).toBe('2026-06-14T10:30:00.000Z')
    expect(status.pendingRestore).toBe(false)
  })

  it('returns pendingRestore=true when snapshot.active is false', () => {
    const snap = makeValidSnapshot()
    snap.active = false
    setMockSnapshot(snap)
    const status = getGameModeStatus()
    expect(status.active).toBe(false)
    expect(status.pendingRestore).toBe(true)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// registerGameModeIpc
// ═══════════════════════════════════════════════════════════════════════

describe('registerGameModeIpc', () => {
  const mockWindow = {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => false),
  }
  const mockGetWindow = vi.fn(() => mockWindow)

  beforeEach(() => {
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        autoDetect: false,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })
  })

  it('registers all four IPC handlers', () => {
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)

    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.GAME_MODE_ACTIVATE, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.GAME_MODE_DEACTIVATE, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.GAME_MODE_STATUS, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.GAME_MODE_RUN_AUDIT, expect.any(Function))
  })

  it('GAME_MODE_ACTIVATE returns error for invalid config', async () => {
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_ACTIVATE,
    )?.[1] as (...args: unknown[]) => Promise<unknown>

    const result = await handler({}, null)
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 1,
      errors: [{ optimizationId: 'config', reason: 'Invalid config' }],
      snapshot: null,
    })
  })

  it('GAME_MODE_ACTIVATE returns error when already active', async () => {
    setMockSnapshot(makeValidSnapshot())
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_ACTIVATE,
    )?.[1] as (...args: unknown[]) => Promise<unknown>

    const config = { enabledOptimizations: [], customProcessKillList: [] }
    const result = await handler({}, config)
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 1,
      errors: [{ optimizationId: 'config', reason: 'Game Mode is already active' }],
    })
  })

  it('GAME_MODE_ACTIVATE returns error when previous deactivation left unrestored items', async () => {
    const snap = makeValidSnapshot()
    snap.active = false
    setMockSnapshot(snap)
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_ACTIVATE,
    )?.[1] as (...args: unknown[]) => Promise<unknown>

    const config = { enabledOptimizations: [], customProcessKillList: [] }
    const result = await handler({}, config)
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 1,
      errors: [{ optimizationId: 'config', reason: expect.stringContaining('unrestored') }],
    })
  })

  it('GAME_MODE_DEACTIVATE suppresses current game when auto-activated', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        autoDetect: false,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })

    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_DEACTIVATE,
    )?.[1] as (...args: unknown[]) => Promise<unknown>

    // We need autoActivated to be true or isDetectorRunning to return true
    mockIsDetectorRunning.mockReturnValue(true)

    await handler()
    expect(mockSuppressCurrentGame).toHaveBeenCalled()
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('GAME_MODE_STATUS returns status', async () => {
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_STATUS,
    )?.[1] as (...args: unknown[]) => Promise<unknown>

    const result = await handler()
    expect(result).toMatchObject({ active: false, activatedAt: null, pendingRestore: false })
  })

  it('GAME_MODE_RUN_AUDIT throws for invalid phase', async () => {
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_RUN_AUDIT,
    )?.[1] as (_event: unknown, phase: unknown) => Promise<unknown>

    await expect(handler({}, 'invalid-phase')).rejects.toThrow('Invalid audit phase')
  })

  it('GAME_MODE_RUN_AUDIT throws for non-string phase', async () => {
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_RUN_AUDIT,
    )?.[1] as (_event: unknown, phase: unknown) => Promise<unknown>

    await expect(handler({}, 123)).rejects.toThrow('Invalid audit phase')
  })

  it('GAME_MODE_RUN_AUDIT accepts valid phase values', async () => {
    mockRunGameModeAudit.mockResolvedValue({
      checks: [],
      summary: { passed: 0, warnings: 0, errors: 0 },
      timestamp: '',
    })
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_RUN_AUDIT,
    )?.[1] as (_event: unknown, phase: unknown) => Promise<unknown>

    for (const phase of ['pre-activation', 'post-activation', 'pre-deactivation', 'post-restore']) {
      const result = await handler({}, phase)
      expect(result).toBeDefined()
      expect(mockRunGameModeAudit).toHaveBeenCalledWith(phase, expect.any(Object))
    }
  })

  it('sendProgress sends IPC.GAME_MODE_PROGRESS to window', async () => {
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)
    const handler = (ipcMain.handle as ReturnType<typeof vi.fn>).mock.calls.find(
      (c: unknown[]) => (c as string[])[0] === IPC.GAME_MODE_ACTIVATE,
    )?.[1] as (_event: unknown, config: unknown) => Promise<unknown>

    await handler({}, { enabledOptimizations: ['mem-clear-standby'], customProcessKillList: [] })

    expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_PROGRESS, expect.any(Object))
  })

  it('does not send to destroyed window', () => {
    mockWindow.isDestroyed.mockReturnValue(true)
    registerGameModeIpc(mockGetWindow as unknown as WindowGetter)

    // No handler called, but the sendProgress/sendAutoEvent closures are created
    // and should gracefully handle destroyed windows
    expect(mockWindow.webContents.send).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// initGameDetector
// ═══════════════════════════════════════════════════════════════════════

describe('initGameDetector', () => {
  const mockWindow = {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => false),
  }
  const mockGetWindow = vi.fn(() => mockWindow)

  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: ['mem-clear-standby'],
        customProcessKillList: [] as string[],
        autoDetect: false,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })
  })

  it('does nothing on non-Windows platforms', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })

    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), vi.fn())

    expect(mockStartGameDetector).not.toHaveBeenCalled()
    expect(mockStopGameDetector).not.toHaveBeenCalled()
    Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  })

  it('stops the detector when autoDetect is disabled', () => {
    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), vi.fn())

    expect(mockStopGameDetector).toHaveBeenCalled()
    expect(mockStartGameDetector).not.toHaveBeenCalled()
  })

  it('starts the detector when autoDetect is enabled', () => {
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: ['mem-clear-standby'],
        customProcessKillList: [] as string[],
        autoDetect: true,
        autoDeactivate: true,
        customGameProcesses: ['mygame.exe'],
        gameProfiles: {},
      },
    })

    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), vi.fn())

    expect(mockStartGameDetector).toHaveBeenCalledWith(
      expect.objectContaining({
        onGameDetected: expect.any(Function),
        onGameExited: expect.any(Function),
      }),
      ['mygame.exe'],
    )
  })

  it('onGameDetected activates Game Mode with profile override', async () => {
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: ['mem-clear-standby'],
        customProcessKillList: [] as string[],
        autoDetect: true,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {
          'cs2.exe': { gameName: 'CS2', enabledOptimizations: ['sys-power-plan'] },
        },
      },
    })
    setMockSnapshot(null) // no active snapshot

    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), vi.fn())
    const callbacks = mockStartGameDetector.mock.calls[0]?.[0] as GameDetectorCallbacks
    await callbacks.onGameDetected('cs2.exe')

    // Should have activated with the profile's optimizations
    expect(fsWriteFileSync).toHaveBeenCalled()
  })

  it('onGameDetected does not activate when snapshot exists', async () => {
    setMockSnapshot(makeValidSnapshot())
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: ['mem-clear-standby'],
        customProcessKillList: [] as string[],
        autoDetect: true,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })

    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), vi.fn())
    const callbacks = mockStartGameDetector.mock.calls[0]?.[0] as GameDetectorCallbacks
    const writeCallsBefore = fsWriteFileSync.mock.calls.length
    await callbacks.onGameDetected('cs2.exe')

    // Should NOT have activated (snapshot already exists)
    expect(fsWriteFileSync.mock.calls.length).toBe(writeCallsBefore)
  })

  it('onGameDetected does not activate when enabledOptimizations is empty', async () => {
    setMockSnapshot(null)
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        autoDetect: true,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })

    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), vi.fn())
    const callbacks = mockStartGameDetector.mock.calls[0]?.[0] as GameDetectorCallbacks
    await callbacks.onGameDetected('cs2.exe')

    expect(fsWriteFileSync).not.toHaveBeenCalled()
  })

  it('onGameExited deactivates Game Mode when autoActivated and autoDeactivate is true', async () => {
    setMockSnapshot(makeValidSnapshot())
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: ['mem-clear-standby'],
        customProcessKillList: [] as string[],
        autoDetect: true,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })
    const sendAutoEvent = (event: GameAutoEvent): void => {
      mockWindow.webContents.send(IPC.GAME_MODE_AUTO_EVENT, event)
    }

    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), sendAutoEvent)
    const callbacks = mockStartGameDetector.mock.calls[0]?.[0] as GameDetectorCallbacks

    // First detect a game
    await callbacks.onGameDetected('cs2.exe')

    // Then game exits
    await callbacks.onGameExited()

    // The game-exited sendAutoEvent should have been sent
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_AUTO_EVENT, {
      type: 'game-exited',
      processName: null,
    })
  })

  it('onGameExited does nothing when autoActivated is false', async () => {
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        autoDetect: true,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })
    const sendAutoEvent = (event: GameAutoEvent): void => {
      mockWindow.webContents.send(IPC.GAME_MODE_AUTO_EVENT, event)
    }

    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), sendAutoEvent)
    const callbacks = mockStartGameDetector.mock.calls[0]?.[0] as GameDetectorCallbacks

    await callbacks.onGameExited()

    // Should do nothing since autoActivated was never set to true
    expect(fsWriteFileSync).not.toHaveBeenCalled()
    expect(mockWindow.webContents.send).not.toHaveBeenCalled()
  })

  it('onGameExited sends event even when autoDeactivate is false', async () => {
    setMockSnapshot(null)
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: ['mem-clear-standby'],
        customProcessKillList: [] as string[],
        autoDetect: true,
        autoDeactivate: false,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })
    const sendAutoEvent = (event: GameAutoEvent): void => {
      mockWindow.webContents.send(IPC.GAME_MODE_AUTO_EVENT, event)
    }

    initGameDetector(mockGetWindow as unknown as WindowGetter, vi.fn(), sendAutoEvent)
    const callbacks = mockStartGameDetector.mock.calls[0]?.[0] as GameDetectorCallbacks

    // First trigger onGameDetected to set autoActivated=true
    await callbacks.onGameDetected('cs2.exe')

    // Then game exits — autoActivated is true, so it won't early-return
    await callbacks.onGameExited()
    // Should still send the event even though autoDeactivate is false
    expect(mockWindow.webContents.send).toHaveBeenCalledWith(IPC.GAME_MODE_AUTO_EVENT, {
      type: 'game-exited',
      processName: null,
    })
  })
})

// ═══════════════════════════════════════════════════════════════════════
// refreshGameDetector
// ═══════════════════════════════════════════════════════════════════════

describe('refreshGameDetector', () => {
  const mockWindow = {
    webContents: { send: vi.fn() },
    isDestroyed: vi.fn(() => false),
  }
  const mockGetWindow = vi.fn(() => mockWindow)

  it('creates sendProgress and sendAutoEvent closures and calls initGameDetector', () => {
    mockGetSettings.mockReturnValue({
      gameMode: {
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        autoDetect: false,
        autoDeactivate: true,
        customGameProcesses: [],
        gameProfiles: {},
      },
    })

    refreshGameDetector(mockGetWindow as unknown as WindowGetter)

    expect(mockStopGameDetector).toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Snapshot validation (security-critical)
// ═══════════════════════════════════════════════════════════════════════

function validateSnapshot(raw: unknown): boolean {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return false
  const s = raw as Record<string, unknown>

  if (typeof s.activatedAt !== 'string' || s.activatedAt.length > 50) return false

  if ('active' in s && typeof s.active !== 'boolean') return false

  if (!Array.isArray(s.services)) return false
  for (const svc of s.services) {
    if (typeof svc !== 'object' || svc === null) return false
    const sv = svc as Record<string, unknown>
    if (typeof sv.name !== 'string' || !VALID_SERVICE_NAMES.has(sv.name)) return false
    if (typeof sv.originalStartType !== 'string' || !/^[A-Za-z0-9]{1,20}$/.test(sv.originalStartType)) return false
    if (typeof sv.wasRunning !== 'boolean') return false
  }

  if (!Array.isArray(s.killedProcesses)) return false
  for (const p of s.killedProcesses) {
    if (typeof p !== 'object' || p === null) return false
    const pv = p as Record<string, unknown>
    if (typeof pv.pid !== 'number' || !Number.isInteger(pv.pid)) return false
    if (typeof pv.name !== 'string' || pv.name.length > 260) return false
  }

  if (s.originalPowerPlanGuid !== null) {
    if (typeof s.originalPowerPlanGuid !== 'string') return false
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.originalPowerPlanGuid)) return false
  }

  if (s.originalFocusAssistState !== null) {
    if (typeof s.originalFocusAssistState !== 'number') return false
    if (
      !Number.isInteger(s.originalFocusAssistState) ||
      s.originalFocusAssistState < 0 ||
      s.originalFocusAssistState > 1
    )
      return false
  }

  if (s.powerSaveBlockerId !== null) {
    if (typeof s.powerSaveBlockerId !== 'number' || !Number.isInteger(s.powerSaveBlockerId)) return false
  }

  if (s.originalTimerResolution !== null) {
    if (
      typeof s.originalTimerResolution !== 'number' ||
      !Number.isInteger(s.originalTimerResolution) ||
      s.originalTimerResolution < 0
    )
      return false
  }

  if (!Array.isArray(s.nagleInterfaces)) return false
  for (const iface of s.nagleInterfaces) {
    if (typeof iface !== 'object' || iface === null) return false
    const iv = iface as Record<string, unknown>
    if (typeof iv.path !== 'string' || !REGISTRY_PATH_RE.test(iv.path)) return false
    if (
      iv.originalTcpNoDelay !== null &&
      (typeof iv.originalTcpNoDelay !== 'number' ||
        !Number.isInteger(iv.originalTcpNoDelay) ||
        iv.originalTcpNoDelay < 0 ||
        iv.originalTcpNoDelay > 1)
    )
      return false
    if (
      iv.originalTcpAckFrequency !== null &&
      (typeof iv.originalTcpAckFrequency !== 'number' ||
        !Number.isInteger(iv.originalTcpAckFrequency) ||
        iv.originalTcpAckFrequency < 0 ||
        iv.originalTcpAckFrequency > 255)
    )
      return false
  }

  if (!Array.isArray(s.registryTweaks)) return false
  for (const tweak of s.registryTweaks) {
    if (typeof tweak !== 'object' || tweak === null) return false
    const tv = tweak as Record<string, unknown>
    if (typeof tv.path !== 'string' || !ALLOWED_REGISTRY_TWEAK_PATHS.has(tv.path)) return false
    if (typeof tv.name !== 'string' || !ALLOWED_REGISTRY_TWEAK_NAMES.has(tv.name)) return false
    if (tv.originalValue !== null && (typeof tv.originalValue !== 'number' || !Number.isInteger(tv.originalValue)))
      return false
  }

  if (!Array.isArray(s.gameProcessPriorities)) return false
  for (const gp of s.gameProcessPriorities) {
    if (typeof gp !== 'object' || gp === null) return false
    const gv = gp as Record<string, unknown>
    if (typeof gv.name !== 'string' || gv.name.length > 260) return false
    if (typeof gv.pid !== 'number' || !Number.isInteger(gv.pid) || gv.pid < 0) return false
    if (typeof gv.originalPriority !== 'string' || !/^[A-Za-z]{1,20}$/.test(gv.originalPriority)) return false
  }

  return true
}

function validSnapshot() {
  return {
    activatedAt: '2026-06-14T10:30:00.000Z',
    active: true,
    services: [
      { name: 'WSearch', originalStartType: 'Automatic', wasRunning: true },
      { name: 'SysMain', originalStartType: 'Manual', wasRunning: false },
    ],
    killedProcesses: [{ pid: 1234, name: 'chrome.exe' }],
    originalPowerPlanGuid: '381b4222-f694-41f0-9685-ff5bb260df2e',
    originalFocusAssistState: 1,
    powerSaveBlockerId: 0,
    originalTimerResolution: 156250,
    nagleInterfaces: [
      {
        path: 'Microsoft.PowerShell.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{abc12345-1234-5678-9abc-def012345678}',
        originalTcpNoDelay: null,
        originalTcpAckFrequency: 1,
      },
    ],
    registryTweaks: [
      {
        path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
        name: 'AppCaptureEnabled',
        originalValue: 1,
      },
      { path: 'HKCU:\\System\\GameConfigStore', name: 'GameDVR_Enabled', originalValue: 1 },
    ],
    gameProcessPriorities: [{ name: 'cs2.exe', pid: 5678, originalPriority: 'Normal' }],
  }
}

describe('snapshot validation', () => {
  it('accepts a valid snapshot', () => {
    expect(validateSnapshot(validSnapshot())).toBe(true)
  })

  it('accepts a minimal snapshot with empty arrays', () => {
    expect(
      validateSnapshot({
        activatedAt: '2026-01-01T00:00:00Z',
        active: true,
        services: [],
        killedProcesses: [],
        originalPowerPlanGuid: null,
        originalFocusAssistState: null,
        powerSaveBlockerId: null,
        originalTimerResolution: null,
        nagleInterfaces: [],
        registryTweaks: [],
        gameProcessPriorities: [],
      }),
    ).toBe(true)
  })

  it('accepts a snapshot without active field (backward compat)', () => {
    expect(
      validateSnapshot({
        activatedAt: '2026-01-01T00:00:00Z',
        services: [],
        killedProcesses: [],
        originalPowerPlanGuid: null,
        originalFocusAssistState: null,
        powerSaveBlockerId: null,
        originalTimerResolution: null,
        nagleInterfaces: [],
        registryTweaks: [],
        gameProcessPriorities: [],
      }),
    ).toBe(true)
  })

  it('rejects snapshot with non-boolean active', () => {
    const snap = validSnapshot()
    Object.assign(snap, { active: 'yes' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects null / non-object', () => {
    expect(validateSnapshot(null)).toBe(false)
    expect(validateSnapshot('string')).toBe(false)
    expect(validateSnapshot([])).toBe(false)
  })

  it('rejects missing activatedAt', () => {
    const snap = validSnapshot()
    delete (snap as Record<string, unknown>).activatedAt
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects activatedAt longer than 50 characters', () => {
    const snap = validSnapshot()
    snap.activatedAt = 'x'.repeat(51)
    expect(validateSnapshot(snap)).toBe(false)
  })

  // ── Service validation ──

  it('rejects services with names not in allowlist', () => {
    const snap = validSnapshot()
    snap.services[0]!.name = 'EvilService'
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects services with non-object entries', () => {
    const snap = validSnapshot()
    snap.services = ['not-an-object'] as never
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects null service entry', () => {
    const snap = validSnapshot()
    snap.services = [null] as never
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects services with injection in originalStartType', () => {
    const snap = validSnapshot()
    snap.services[0]!.originalStartType = "Automatic'; Get-Content C:\\secrets"
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects services with empty originalStartType', () => {
    const snap = validSnapshot()
    snap.services[0]!.originalStartType = ''
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects services with non-boolean wasRunning', () => {
    const snap = validSnapshot()
    Object.assign(snap.services[0]!, { wasRunning: 'true' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects services array when services is not an array', () => {
    const snap = validSnapshot()
    Object.assign(snap, { services: 'not-array' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  // ── Killed processes validation ──

  it('rejects killed process with non-integer PID', () => {
    const snap = validSnapshot()
    snap.killedProcesses[0]!.pid = 1.5
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects killed process with overly long name', () => {
    const snap = validSnapshot()
    snap.killedProcesses[0]!.name = 'x'.repeat(261)
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects killed process with null entry', () => {
    const snap = validSnapshot()
    snap.killedProcesses = [null] as never
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects when killedProcesses is not an array', () => {
    const snap = validSnapshot()
    Object.assign(snap, { killedProcesses: 'not-array' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  // ── Power plan GUID validation ──

  it('rejects invalid power plan GUID format', () => {
    const snap = validSnapshot()
    snap.originalPowerPlanGuid = 'not-a-guid'
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects power plan GUID with injection', () => {
    const snap = validSnapshot()
    snap.originalPowerPlanGuid = '381b4222-f694-41f0-9685-ff5bb260df2e; rm -rf /'
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects non-string power plan GUID', () => {
    const snap = validSnapshot()
    Object.assign(snap, { originalPowerPlanGuid: 123 })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('accepts null power plan GUID', () => {
    const snap = validSnapshot()
    snap.originalPowerPlanGuid = null as never
    expect(validateSnapshot(snap)).toBe(true)
  })

  // ── Focus Assist validation ──

  it('rejects Focus Assist state outside 0-1 range', () => {
    const snap = validSnapshot()
    snap.originalFocusAssistState = 999
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects Focus Assist state that is non-integer', () => {
    const snap = validSnapshot()
    snap.originalFocusAssistState = 0.5
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects Focus Assist state that is a string', () => {
    const snap = validSnapshot()
    Object.assign(snap, { originalFocusAssistState: '0; malicious-command' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects Focus Assist state that is negative', () => {
    const snap = validSnapshot()
    snap.originalFocusAssistState = -1
    expect(validateSnapshot(snap)).toBe(false)
  })

  // ── powerSaveBlockerId validation ──

  it('rejects non-integer powerSaveBlockerId', () => {
    const snap = validSnapshot()
    Object.assign(snap, { powerSaveBlockerId: 'string' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects float powerSaveBlockerId', () => {
    const snap = validSnapshot()
    snap.powerSaveBlockerId = 1.5
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('accepts null powerSaveBlockerId', () => {
    const snap = validSnapshot()
    snap.powerSaveBlockerId = null as never
    expect(validateSnapshot(snap)).toBe(true)
  })

  // ── Timer resolution validation ──

  it('rejects negative timer resolution', () => {
    const snap = validSnapshot()
    snap.originalTimerResolution = -1
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects non-integer timer resolution', () => {
    const snap = validSnapshot()
    snap.originalTimerResolution = 1.5
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects string timer resolution', () => {
    const snap = validSnapshot()
    Object.assign(snap, { originalTimerResolution: '156250' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('accepts null timer resolution', () => {
    const snap = validSnapshot()
    snap.originalTimerResolution = null as never
    expect(validateSnapshot(snap)).toBe(true)
  })

  // ── Nagle interface validation ──

  it('rejects nagle interface with arbitrary registry path', () => {
    const snap = validSnapshot()
    snap.nagleInterfaces[0]!.path = "HKLM:\\SOFTWARE\\Evil'; Get-Content C:\\secrets"
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects nagle interface with path traversal', () => {
    const snap = validSnapshot()
    snap.nagleInterfaces[0]!.path = '..\\..\\..\\evil'
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects nagle TcpNoDelay values outside 0-1', () => {
    const snap = validSnapshot()
    snap.nagleInterfaces[0]!.originalTcpNoDelay = 42 as never
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects nagle TcpAckFrequency as string', () => {
    const snap = validSnapshot()
    Object.assign(snap.nagleInterfaces[0]!, { originalTcpAckFrequency: '1; malicious' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects nagle TcpAckFrequency outside 0-255 range', () => {
    const snap = validSnapshot()
    snap.nagleInterfaces[0]!.originalTcpAckFrequency = 300
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects nagle TcpAckFrequency as negative', () => {
    const snap = validSnapshot()
    snap.nagleInterfaces[0]!.originalTcpAckFrequency = -1
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects nagle interface with null entry', () => {
    const snap = validSnapshot()
    snap.nagleInterfaces = [null] as never
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects nagle interface with non-object entry', () => {
    const snap = validSnapshot()
    snap.nagleInterfaces = ['string-entry'] as never
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects when nagleInterfaces is not an array', () => {
    const snap = validSnapshot()
    Object.assign(snap, { nagleInterfaces: 'not-array' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  // ── Registry tweaks validation ──

  it('accepts valid registry tweaks with null originalValue', () => {
    const snap = validSnapshot()
    snap.registryTweaks = [
      {
        path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
        name: 'AppCaptureEnabled',
        originalValue: null as unknown as number,
      },
    ]
    expect(validateSnapshot(snap)).toBe(true)
  })

  it('rejects registry tweaks with path not in allowlist', () => {
    const snap = validSnapshot()
    snap.registryTweaks = [
      { path: "HKLM:\\SOFTWARE\\Evil'; Get-Content C:\\secrets", name: 'AppCaptureEnabled', originalValue: 0 },
    ]
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects registry tweaks with name not in allowlist', () => {
    const snap = validSnapshot()
    snap.registryTweaks = [
      { path: 'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR', name: 'EvilKey', originalValue: 0 },
    ]
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects registry tweaks with non-integer originalValue', () => {
    const snap = validSnapshot()
    snap.registryTweaks = [{ path: 'HKCU:\\System\\GameConfigStore', name: 'GameDVR_Enabled', originalValue: 1.5 }]
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects registry tweaks with string originalValue', () => {
    const snap = validSnapshot()
    snap.registryTweaks = [
      {
        path: 'HKCU:\\System\\GameConfigStore',
        name: 'GameDVR_Enabled',
        originalValue: '1; malicious' as unknown as number,
      },
    ]
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects registry tweaks with null entry', () => {
    const snap = validSnapshot()
    snap.registryTweaks = [null] as never
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects when registryTweaks is not an array', () => {
    const snap = validSnapshot()
    Object.assign(snap, { registryTweaks: 'not-array' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  // ── Game process priorities validation ──

  it('rejects game process priority with null entry', () => {
    const snap = validSnapshot()
    snap.gameProcessPriorities = [null] as never
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects when gameProcessPriorities is not an array', () => {
    const snap = validSnapshot()
    Object.assign(snap, { gameProcessPriorities: 'not-array' })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects game process priority with overly long name', () => {
    const snap = validSnapshot()
    snap.gameProcessPriorities[0]!.name = 'x'.repeat(261)
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects game process priority with non-integer pid', () => {
    const snap = validSnapshot()
    snap.gameProcessPriorities[0]!.pid = 1.5
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects game process priority with negative pid', () => {
    const snap = validSnapshot()
    snap.gameProcessPriorities[0]!.pid = -1
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects game process priority with non-string originalPriority', () => {
    const snap = validSnapshot()
    Object.assign(snap.gameProcessPriorities[0]!, { originalPriority: 123 })
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects game process priority with invalid originalPriority format', () => {
    const snap = validSnapshot()
    snap.gameProcessPriorities[0]!.originalPriority = 'High; malicious'
    expect(validateSnapshot(snap)).toBe(false)
  })

  it('rejects game process priority with non-object entry', () => {
    const snap = validSnapshot()
    snap.gameProcessPriorities = ['string-entry'] as never
    expect(validateSnapshot(snap)).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// IPC config validation (security-critical)
// ═══════════════════════════════════════════════════════════════════════

const VALID_OPTIMIZATION_IDS = new Set([
  'svc-wsearch',
  'svc-sysmain',
  'svc-wuauserv',
  'svc-spooler',
  'svc-diagtrack',
  'proc-kill-browsers',
  'proc-kill-chat',
  'proc-kill-updaters',
  'proc-kill-custom',
  'mem-clear-standby',
  'sys-focus-assist',
  'sys-power-plan',
  'sys-prevent-sleep',
  'sys-disable-game-bar',
  'sys-disable-fse-opt',
  'sys-disable-transparency',
  'sys-timer-resolution',
  'cpu-game-priority',
  'net-flush-dns',
  'net-disable-nagle',
])
const PROCESS_NAME_RE = /^[A-Za-z0-9._\- ]+$/

function validateGameModeConfig(input: unknown): boolean {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) return false
  const obj = input as Record<string, unknown>

  if (!Array.isArray(obj.enabledOptimizations)) return false
  if (obj.enabledOptimizations.length > 30) return false
  if (!obj.enabledOptimizations.every((v: unknown) => typeof v === 'string' && VALID_OPTIMIZATION_IDS.has(v as string)))
    return false

  if (!Array.isArray(obj.customProcessKillList)) return false
  if (obj.customProcessKillList.length > 50) return false
  if (
    !obj.customProcessKillList.every(
      (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100 && PROCESS_NAME_RE.test(v as string),
    )
  )
    return false

  if ('autoDetect' in obj && typeof obj.autoDetect !== 'boolean') return false
  if ('autoDeactivate' in obj && typeof obj.autoDeactivate !== 'boolean') return false

  if ('customGameProcesses' in obj) {
    if (!Array.isArray(obj.customGameProcesses)) return false
    if (obj.customGameProcesses.length > 50) return false
    if (
      !obj.customGameProcesses.every(
        (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100 && PROCESS_NAME_RE.test(v as string),
      )
    )
      return false
  }

  if ('gameProfiles' in obj) {
    if (typeof obj.gameProfiles !== 'object' || obj.gameProfiles === null || Array.isArray(obj.gameProfiles))
      return false
    const profileKeys = Object.keys(obj.gameProfiles as Record<string, unknown>)
    if (profileKeys.length > 30) return false
    for (const key of profileKeys) {
      if (!PROCESS_NAME_RE.test(key)) return false
      const profile = (obj.gameProfiles as Record<string, unknown>)[key] as Record<string, unknown>
      if (typeof profile !== 'object' || profile === null) return false
      if (typeof profile.gameName !== 'string' || profile.gameName.length > 100) return false
      if (!Array.isArray(profile.enabledOptimizations)) return false
      if (profile.enabledOptimizations.length > 30) return false
      if (
        !profile.enabledOptimizations.every(
          (v: unknown) => typeof v === 'string' && VALID_OPTIMIZATION_IDS.has(v as string),
        )
      )
        return false
    }
  }

  return true
}

describe('IPC config validation', () => {
  it('accepts valid config', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: ['svc-wsearch', 'net-flush-dns'],
        customProcessKillList: ['spotify.exe'],
      }),
    ).toBe(true)
  })

  it('accepts empty arrays', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
      }),
    ).toBe(true)
  })

  it('rejects null', () => {
    expect(validateGameModeConfig(null)).toBe(false)
  })

  it('rejects config with unknown optimization IDs', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: ['inject-command'],
        customProcessKillList: [] as string[],
      }),
    ).toBe(false)
  })

  it('rejects config with shell injection in process names', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: ['evil.exe; rm -rf /'],
      }),
    ).toBe(false)
  })

  it('rejects config with pipe in process names', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: ['evil.exe | cat /etc/passwd'],
      }),
    ).toBe(false)
  })

  it('rejects config with backtick in process names', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: ['evil`malicious`'],
      }),
    ).toBe(false)
  })

  it('rejects config without required fields', () => {
    expect(validateGameModeConfig({ enabledOptimizations: [] })).toBe(false)
    expect(validateGameModeConfig({ customProcessKillList: [] })).toBe(false)
  })

  it('rejects config with empty string in process kill list', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [''],
      }),
    ).toBe(false)
  })

  it('rejects config with process name exceeding 100 chars', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: ['x'.repeat(101)],
      }),
    ).toBe(false)
  })

  it('rejects config with non-array enabledOptimizations', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: 'not-array',
        customProcessKillList: [] as string[],
      }),
    ).toBe(false)
  })

  it('rejects config with more than 30 enabledOptimizations', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: Array(31).fill('mem-clear-standby'),
        customProcessKillList: [] as string[],
      }),
    ).toBe(false)
  })

  it('rejects config with more than 50 customProcessKillList', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: Array(51).fill('proc.exe'),
      }),
    ).toBe(false)
  })

  it('rejects non-array customProcessKillList', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: 'not-array',
      }),
    ).toBe(false)
  })

  it('accepts config with autoDetect boolean', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        autoDetect: true,
        autoDeactivate: false,
      }),
    ).toBe(true)
  })

  it('rejects config with non-boolean autoDetect', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        autoDetect: 'yes',
      }),
    ).toBe(false)
  })

  it('rejects config with non-boolean autoDeactivate', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        autoDeactivate: 'yes',
      }),
    ).toBe(false)
  })

  it('accepts valid customGameProcesses', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        customGameProcesses: ['mygame.exe'],
      }),
    ).toBe(true)
  })

  it('rejects non-array customGameProcesses', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        customGameProcesses: 'not-array',
      }),
    ).toBe(false)
  })

  it('rejects customGameProcesses with more than 50 items', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        customGameProcesses: Array(51).fill('proc.exe'),
      }),
    ).toBe(false)
  })

  it('rejects customGameProcesses with empty string', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        customGameProcesses: [''],
      }),
    ).toBe(false)
  })

  it('accepts valid gameProfiles', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: {
          'cs2.exe': { gameName: 'CS2', enabledOptimizations: ['sys-power-plan'] },
        },
      }),
    ).toBe(true)
  })

  it('rejects non-object gameProfiles', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: 'not-object',
      }),
    ).toBe(false)
  })

  it('rejects array gameProfiles', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: [],
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with more than 30 keys', () => {
    const profiles: Record<string, unknown> = {}
    for (let i = 0; i < 31; i++) profiles[`game${i}.exe`] = { gameName: `Game ${i}`, enabledOptimizations: [] }
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: profiles,
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with invalid key name', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: { 'cs2.exe; rm -rf': { gameName: 'CS2', enabledOptimizations: [] } },
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with non-object profile value', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: { 'cs2.exe': 'not-object' },
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with null profile value', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: { 'cs2.exe': null },
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with missing gameName', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: { 'cs2.exe': { enabledOptimizations: [] } },
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with gameName exceeding 100 chars', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: { 'cs2.exe': { gameName: 'x'.repeat(101), enabledOptimizations: [] } },
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with non-array enabledOptimizations', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: { 'cs2.exe': { gameName: 'CS2', enabledOptimizations: 'not-array' } },
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with more than 30 enabledOptimizations', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: { 'cs2.exe': { gameName: 'CS2', enabledOptimizations: Array(31).fill('mem-clear-standby') } },
      }),
    ).toBe(false)
  })

  it('rejects gameProfiles with invalid optimization ID in profile', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: [] as string[],
        gameProfiles: { 'cs2.exe': { gameName: 'CS2', enabledOptimizations: ['invalid-opt'] } },
      }),
    ).toBe(false)
  })

  it('rejects non-string process name with special chars', () => {
    expect(
      validateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: ['proc<>.exe'],
      }),
    ).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════
// validateGameModeConfig (real) — full branch coverage
// ═══════════════════════════════════════════════════════════════════════

describe('validateGameModeConfig (real)', () => {
  const validOpts = ['svc-wsearch', 'net-flush-dns']
  const validKill = ['spotify.exe']
  const validBase = { enabledOptimizations: validOpts, customProcessKillList: validKill }

  it('returns valid object for nullish optimizations', () => {
    const result = realValidateGameModeConfig({ enabledOptimizations: [], customProcessKillList: [] })
    expect(result).not.toBeNull()
    expect(result).not.toBe(false)
  })

  it('returns null for null input', () => {
    expect(realValidateGameModeConfig(null)).toBeNull()
  })

  it('returns null for non-object input (string)', () => {
    expect(realValidateGameModeConfig('string')).toBeNull()
  })

  it('returns null for non-object input (number)', () => {
    expect(realValidateGameModeConfig(42)).toBeNull()
  })

  it('returns null for array input', () => {
    expect(realValidateGameModeConfig([])).toBeNull()
  })

  it('returns null when enabledOptimizations is not an array', () => {
    expect(realValidateGameModeConfig({ enabledOptimizations: 'not-array', customProcessKillList: [] })).toBeNull()
  })

  it('returns null when enabledOptimizations length > 30', () => {
    expect(
      realValidateGameModeConfig({
        enabledOptimizations: Array(31).fill('mem-clear-standby'),
        customProcessKillList: [],
      }),
    ).toBeNull()
  })

  it('returns null when enabledOptimizations contains non-string', () => {
    expect(realValidateGameModeConfig({ enabledOptimizations: [123], customProcessKillList: [] })).toBeNull()
  })

  it('returns null when enabledOptimizations contains invalid ID', () => {
    expect(
      realValidateGameModeConfig({ enabledOptimizations: ['inject-command'], customProcessKillList: [] }),
    ).toBeNull()
  })

  it('returns null when customProcessKillList is not an array', () => {
    expect(realValidateGameModeConfig({ enabledOptimizations: [], customProcessKillList: 'not-array' })).toBeNull()
  })

  it('returns null when customProcessKillList length > 50', () => {
    expect(
      realValidateGameModeConfig({
        enabledOptimizations: [],
        customProcessKillList: Array(51).fill('proc.exe'),
      }),
    ).toBeNull()
  })

  it('returns null when process kill entry is non-string', () => {
    expect(realValidateGameModeConfig({ enabledOptimizations: [], customProcessKillList: [42] })).toBeNull()
  })

  it('returns null when process kill entry is empty string', () => {
    expect(realValidateGameModeConfig({ enabledOptimizations: [], customProcessKillList: [''] })).toBeNull()
  })

  it('returns null when process kill entry exceeds 100 chars', () => {
    expect(
      realValidateGameModeConfig({ enabledOptimizations: [], customProcessKillList: ['x'.repeat(101)] }),
    ).toBeNull()
  })

  it('returns null when process kill entry has invalid chars', () => {
    expect(
      realValidateGameModeConfig({ enabledOptimizations: [], customProcessKillList: ['evil.exe; rm -rf /'] }),
    ).toBeNull()
  })

  it('returns null when autoDetect is present but not boolean', () => {
    expect(realValidateGameModeConfig({ ...validBase, autoDetect: 'yes' })).toBeNull()
  })

  it('returns null when autoDeactivate is present but not boolean', () => {
    expect(realValidateGameModeConfig({ ...validBase, autoDeactivate: 'yes' })).toBeNull()
  })

  it('returns null when customGameProcesses is not an array', () => {
    expect(realValidateGameModeConfig({ ...validBase, customGameProcesses: 'not-array' })).toBeNull()
  })

  it('returns null when customGameProcesses length > 50', () => {
    expect(realValidateGameModeConfig({ ...validBase, customGameProcesses: Array(51).fill('game.exe') })).toBeNull()
  })

  it('returns null when customGameProcesses has empty string', () => {
    expect(realValidateGameModeConfig({ ...validBase, customGameProcesses: [''] })).toBeNull()
  })

  it('returns null when customGameProcesses entry is non-string', () => {
    expect(realValidateGameModeConfig({ ...validBase, customGameProcesses: [42] })).toBeNull()
  })

  it('returns null when customGameProcesses entry has invalid chars', () => {
    expect(realValidateGameModeConfig({ ...validBase, customGameProcesses: ['game<>.exe'] })).toBeNull()
  })

  it('returns null when gameProfiles is an array', () => {
    expect(realValidateGameModeConfig({ ...validBase, gameProfiles: [] })).toBeNull()
  })

  it('returns null when gameProfiles is null', () => {
    expect(realValidateGameModeConfig({ ...validBase, gameProfiles: null })).toBeNull()
  })

  it('returns null when gameProfiles is a string', () => {
    expect(realValidateGameModeConfig({ ...validBase, gameProfiles: 'not-object' })).toBeNull()
  })

  it('returns null when gameProfiles has > 30 keys', () => {
    const profiles: Record<string, unknown> = {}
    for (let i = 0; i < 31; i++) profiles[`g${i}.exe`] = { gameName: `G${i}`, enabledOptimizations: [] }
    expect(realValidateGameModeConfig({ ...validBase, gameProfiles: profiles })).toBeNull()
  })

  it('returns null when gameProfiles key has invalid chars', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe; rm': { gameName: 'CS2', enabledOptimizations: [] } },
      }),
    ).toBeNull()
  })

  it('returns null when profile value is not an object', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe': 'not-object' },
      }),
    ).toBeNull()
  })

  it('returns null when profile value is null', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe': null },
      }),
    ).toBeNull()
  })

  it('returns null when profile gameName is missing', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe': { enabledOptimizations: [] } },
      }),
    ).toBeNull()
  })

  it('returns null when profile gameName is not a string', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe': { gameName: 123, enabledOptimizations: [] } },
      }),
    ).toBeNull()
  })

  it('returns null when profile gameName exceeds 100 chars', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe': { gameName: 'x'.repeat(101), enabledOptimizations: [] } },
      }),
    ).toBeNull()
  })

  it('returns null when profile enabledOptimizations is not an array', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe': { gameName: 'CS2', enabledOptimizations: 'not-array' } },
      }),
    ).toBeNull()
  })

  it('returns null when profile enabledOptimizations length > 30', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: {
          'cs2.exe': { gameName: 'CS2', enabledOptimizations: Array(31).fill('mem-clear-standby') },
        },
      }),
    ).toBeNull()
  })

  it('returns null when profile has invalid optimization ID', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe': { gameName: 'CS2', enabledOptimizations: ['invalid-opt'] } },
      }),
    ).toBeNull()
  })

  it('returns null when profile enabledOptimizations contains non-string', () => {
    expect(
      realValidateGameModeConfig({
        ...validBase,
        gameProfiles: { 'cs2.exe': { gameName: 'CS2', enabledOptimizations: [null] } },
      }),
    ).toBeNull()
  })

  it('returns valid config for complete valid input with all optional fields', () => {
    const result = realValidateGameModeConfig({
      enabledOptimizations: validOpts,
      customProcessKillList: validKill,
      autoDetect: true,
      autoDeactivate: false,
      customGameProcesses: ['mygame.exe'],
      gameProfiles: {
        'cs2.exe': { gameName: 'Counter-Strike 2', enabledOptimizations: ['sys-power-plan'] },
      },
    })
    expect(result).not.toBeNull()
    expect(result).not.toBe(false)
    if (result) {
      expect(result.enabledOptimizations).toEqual(validOpts)
      expect(result.customProcessKillList).toEqual(validKill)
    }
  })
})

// ═══════════════════════════════════════════════════════════════════════
// Optimization ID consistency
// ═══════════════════════════════════════════════════════════════════════

describe('optimization ID consistency', () => {
  const SERVICE_MAP_KEYS = new Set(['svc-wsearch', 'svc-sysmain', 'svc-wuauserv', 'svc-spooler', 'svc-diagtrack'])

  it('SERVICE_MAP keys are a subset of valid optimization IDs', () => {
    for (const key of SERVICE_MAP_KEYS) {
      expect(VALID_OPTIMIZATION_IDS.has(key)).toBe(true)
    }
  })

  it('all valid optimization IDs are known strings', () => {
    expect(VALID_OPTIMIZATION_IDS.size).toBe(20)
  })

  it('all VALID_SERVICE_NAMES correspond to SERVICE_MAP values', () => {
    const expectedServices = new Set(['WSearch', 'SysMain', 'wuauserv', 'Spooler', 'DiagTrack'])
    expect(VALID_SERVICE_NAMES).toEqual(expectedServices)
  })
})
