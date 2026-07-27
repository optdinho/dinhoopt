import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──

const mockHandle = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn((...args: unknown[]) => mockHandle(...args)) },
}))

const mockLogger = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }
vi.mock('../services/logger.service', () => ({
  getLogger: () => mockLogger,
}))

const mockScanRegistry = vi.fn()
const mockFixRegistryEntries = vi.fn()
const mockCollectBackupTargets = vi.fn()
vi.mock('../services/registry-cleaner.service', () => ({
  scanRegistry: (...args: unknown[]) => mockScanRegistry(...args),
  fixRegistryEntries: (...args: unknown[]) => mockFixRegistryEntries(...args),
  collectBackupTargets: (...args: unknown[]) => mockCollectBackupTargets(...args),
}))

const mockValidateStringArray = vi.fn()
vi.mock('../services/ipc-validation', () => ({
  validateStringArray: (...args: unknown[]) => mockValidateStringArray(...args),
}))

const mockGetSettings = vi.fn()
const mockUpdateRegistryIgnoredTweaks = vi.fn()
vi.mock('../services/settings-store', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateRegistryIgnoredTweaks: (...args: unknown[]) => mockUpdateRegistryIgnoredTweaks(...args),
}))

vi.mock('@shared/registry-tweaks', () => ({
  applyIgnoredTweaks: (entries: unknown[]) => entries as [],
}))

vi.mock('./sender-validation', () => ({
  validateSender: vi.fn(() => true),
}))

import { IPC } from '@shared/channels'
import type { RegistryEntry } from '@shared/types'
import {
  collectBackupTargets,
  fixRegistryEntries,
  registerRegistryCleanerIpc,
  scanRegistry,
} from './registry-cleaner.ipc'

// ── Helpers ──

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } }
}

function makeEntry(id: string, overrides?: Partial<RegistryEntry>): RegistryEntry {
  return {
    id,
    keyPath: `HKLM\\SOFTWARE\\Test\\${id}`,
    valueName: '',
    type: 'invalid',
    risk: 'low',
    selected: false,
    issue: `Issue ${id}`,
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// registerRegistryCleanerIpc
// ─────────────────────────────────────────────────────────────────────────────

describe('registerRegistryCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
  })

  it('registers all five IPC handlers', () => {
    registerRegistryCleanerIpc(() => mockWindow() as never)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toHaveLength(5)
    expect(channels).toContain(IPC.REGISTRY_SCAN)
    expect(channels).toContain(IPC.REGISTRY_FIX)
    expect(channels).toContain(IPC.REGISTRY_SET_TWEAK_IGNORED)
    expect(channels).toContain(IPC.REGISTRY_SCAN_CANCEL)
    expect(channels).toContain(IPC.REGISTRY_FIX_CANCEL)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC.REGISTRY_SCAN
// ─────────────────────────────────────────────────────────────────────────────

describe('IPC.REGISTRY_SCAN', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
  })

  it('returns empty array when not on Windows', async () => {
    const origDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    try {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      registerRegistryCleanerIpc(() => mockWindow() as never)
      const handler = getHandler(IPC.REGISTRY_SCAN)
      const result = await handler()
      expect(result).toEqual([])
      expect(mockLogger.warning).toHaveBeenCalledWith('registry-cleaner', 'Registry scan skipped — not Windows')
    } finally {
      if (origDescriptor) {
        Object.defineProperty(process, 'platform', origDescriptor)
      }
    }
  })

  it('scans and returns entries on success', async () => {
    const entries = [makeEntry('e1'), makeEntry('e2')]
    mockScanRegistry.mockResolvedValue(entries)
    registerRegistryCleanerIpc(() => mockWindow() as never)
    const handler = getHandler(IPC.REGISTRY_SCAN)
    const result = await handler()
    expect(result).toEqual(entries)
    expect(mockScanRegistry).toHaveBeenCalledOnce()
    expect(mockScanRegistry).toHaveBeenCalledWith(expect.any(AbortSignal))
    expect(mockLogger.info).toHaveBeenCalledWith('registry-cleaner', 'Scanning registry for issues...')
    expect(mockLogger.success).toHaveBeenCalledWith('registry-cleaner', 'Registry scan complete — 2 issues found')
  })

  it('returns empty array when scan is aborted', async () => {
    mockScanRegistry.mockImplementation(async (signal: AbortSignal) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    registerRegistryCleanerIpc(() => mockWindow() as never)
    const handler = getHandler(IPC.REGISTRY_SCAN)
    const cancelHandler = getHandler(IPC.REGISTRY_SCAN_CANCEL)
    const scanPromise = handler()
    cancelHandler()
    const result = await scanPromise
    expect(result).toEqual([])
    expect(mockLogger.info).toHaveBeenCalledWith('registry-cleaner', 'Registry scan cancelled')
  })

  it('re-throws non-abort scan errors', async () => {
    const scanError = new Error('Permission denied')
    mockScanRegistry.mockRejectedValue(scanError)
    registerRegistryCleanerIpc(() => mockWindow() as never)
    const handler = getHandler(IPC.REGISTRY_SCAN)
    await expect(handler()).rejects.toThrow('Permission denied')
    expect(mockLogger.error).toHaveBeenCalledWith('registry-cleaner', 'Registry scan failed: Permission denied')
  })

  it('logs unknown error when scan throws a non-Error value', async () => {
    mockScanRegistry.mockRejectedValue('raw string error')
    registerRegistryCleanerIpc(() => mockWindow() as never)
    const handler = getHandler(IPC.REGISTRY_SCAN)
    await expect(handler()).rejects.toBe('raw string error')
    expect(mockLogger.error).toHaveBeenCalledWith('registry-cleaner', 'Registry scan failed: Unknown error')
  })

  it('cleans up old scan sessions beyond the limit of 3', async () => {
    mockScanRegistry
      .mockResolvedValueOnce([makeEntry('a1')])
      .mockResolvedValueOnce([makeEntry('b1')])
      .mockResolvedValueOnce([makeEntry('c1')])
      .mockResolvedValueOnce([makeEntry('d1')])

    registerRegistryCleanerIpc(() => mockWindow() as never)
    const handler = getHandler(IPC.REGISTRY_SCAN)

    await handler()
    await handler()
    await handler()
    await handler()

    // Only sessions 2-4 should survive. a1 should be cleaned up.
    mockValidateStringArray.mockReturnValue(['a1', 'd1'])
    mockFixRegistryEntries.mockResolvedValue({ fixed: 1, failed: 0, failures: [] })

    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    await fixHandler({}, ['a1', 'd1'])

    // a1 is gone (session 1 cleaned), d1 is in session 4
    expect(mockFixRegistryEntries).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'd1' })],
      expect.any(Function),
      expect.any(AbortSignal),
    )
    expect(mockFixRegistryEntries.mock.calls[0]![0]).toHaveLength(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC.REGISTRY_FIX
// ─────────────────────────────────────────────────────────────────────────────

describe('IPC.REGISTRY_FIX', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
  })

  it('returns empty result when not on Windows', async () => {
    const origDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    try {
      Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
      registerRegistryCleanerIpc(() => mockWindow() as never)
      const handler = getHandler(IPC.REGISTRY_FIX)
      const result = await handler({}, ['any-id'])
      expect(result).toEqual({ fixed: 0, failed: 0, failures: [] })
    } finally {
      if (origDescriptor) {
        Object.defineProperty(process, 'platform', origDescriptor)
      }
    }
  })

  it('returns empty result for invalid entry IDs', async () => {
    mockValidateStringArray.mockReturnValue(null)
    registerRegistryCleanerIpc(() => mockWindow() as never)
    const handler = getHandler(IPC.REGISTRY_FIX)
    const result = await handler({}, ['invalid'])
    expect(result).toEqual({ fixed: 0, failed: 0, failures: [] })
    expect(mockLogger.warning).toHaveBeenCalledWith('registry-cleaner', 'Fix called with invalid entry IDs')
  })

  it('fixes valid entries from scan sessions', async () => {
    const entry = makeEntry('fix-me', { selected: true })
    mockScanRegistry.mockResolvedValue([entry])
    mockValidateStringArray.mockReturnValue(['fix-me'])
    mockFixRegistryEntries.mockResolvedValue({ fixed: 1, failed: 0, failures: [] })

    registerRegistryCleanerIpc(() => mockWindow() as never)

    // Populate scan sessions
    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    await scanHandler()

    // Fix the entry
    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    const result = await fixHandler({}, ['fix-me'])

    expect(result).toEqual({ fixed: 1, failed: 0, failures: [] })
    expect(mockFixRegistryEntries).toHaveBeenCalledWith(
      [expect.objectContaining({ id: 'fix-me' })],
      expect.any(Function),
      expect.any(AbortSignal),
    )
    expect(mockLogger.success).toHaveBeenCalledWith('registry-cleaner', 'Fix complete — 1 fixed, 0 failed')
  })

  it('returns cancellation result when fix is aborted', async () => {
    const entry = makeEntry('cancel-me', { selected: true })
    mockScanRegistry.mockResolvedValue([entry])
    mockValidateStringArray.mockReturnValue(['cancel-me'])
    mockFixRegistryEntries.mockImplementation(async (_entries: unknown, _onProgress: unknown, signal: AbortSignal) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Cancelled')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })

    registerRegistryCleanerIpc(() => mockWindow() as never)

    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    await scanHandler()

    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    const cancelHandler = getHandler(IPC.REGISTRY_FIX_CANCEL)
    const fixPromise = fixHandler({}, ['cancel-me'])
    cancelHandler()
    const result = await fixPromise

    expect(result).toEqual({
      fixed: 0,
      failed: 0,
      failures: [{ issue: 'Cancelled', reason: 'Operation was cancelled by user' }],
    })
    expect(mockLogger.info).toHaveBeenCalledWith('registry-cleaner', 'Registry fix cancelled')
  })

  it('re-throws non-abort fix errors', async () => {
    const entry = makeEntry('error-me', { selected: true })
    mockScanRegistry.mockResolvedValue([entry])
    mockValidateStringArray.mockReturnValue(['error-me'])
    const fixError = new Error('Access denied')
    mockFixRegistryEntries.mockRejectedValue(fixError)

    registerRegistryCleanerIpc(() => mockWindow() as never)

    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    await scanHandler()

    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    await expect(fixHandler({}, ['error-me'])).rejects.toThrow('Access denied')
    expect(mockLogger.error).toHaveBeenCalledWith('registry-cleaner', 'Registry fix failed: Access denied')
  })

  it('logs String(err) when fix throws a non-Error value', async () => {
    const entry = makeEntry('non-err-fix', { selected: true })
    mockScanRegistry.mockResolvedValue([entry])
    mockValidateStringArray.mockReturnValue(['non-err-fix'])
    mockFixRegistryEntries.mockRejectedValue(42)

    registerRegistryCleanerIpc(() => mockWindow() as never)

    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    await scanHandler()

    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    await expect(fixHandler({}, ['non-err-fix'])).rejects.toBe(42)
    expect(mockLogger.error).toHaveBeenCalledWith('registry-cleaner', 'Registry fix failed: 42')
  })

  it('sends progress to the window during fix', async () => {
    const mockSend = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send: mockSend } }

    const entry = makeEntry('prog', { selected: true })
    mockScanRegistry.mockResolvedValue([entry])
    mockValidateStringArray.mockReturnValue(['prog'])

    registerRegistryCleanerIpc(() => win as never)

    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    await scanHandler()

    mockFixRegistryEntries.mockImplementation(
      async (_entries: unknown, onProgress: (c: number, t: number, e: string) => void) => {
        onProgress(1, 3, 'prog')
        onProgress(2, 3, 'prog')
        return { fixed: 1, failed: 0, failures: [] }
      },
    )

    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    await fixHandler({}, ['prog'])

    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith(IPC.REGISTRY_FIX_PROGRESS, { current: 1, total: 3, currentEntry: 'prog' })
    expect(mockSend).toHaveBeenCalledWith(IPC.REGISTRY_FIX_PROGRESS, { current: 2, total: 3, currentEntry: 'prog' })
  })

  it('skips progress when window is destroyed', async () => {
    const mockSend = vi.fn()
    const win = { isDestroyed: () => true, webContents: { send: mockSend } }

    const entry = makeEntry('dead-win', { selected: true })
    mockScanRegistry.mockResolvedValue([entry])
    mockValidateStringArray.mockReturnValue(['dead-win'])

    registerRegistryCleanerIpc(() => win as never)

    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    await scanHandler()

    mockFixRegistryEntries.mockImplementation(
      async (_entries: unknown, onProgress: (c: number, t: number, e: string) => void) => {
        onProgress(1, 1, 'dead-win')
        return { fixed: 1, failed: 0, failures: [] }
      },
    )

    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    await fixHandler({}, ['dead-win'])

    expect(mockSend).not.toHaveBeenCalled()
  })

  it('skips progress when window getter returns null', async () => {
    const entry = makeEntry('null-win', { selected: true })
    mockScanRegistry.mockResolvedValue([entry])
    mockValidateStringArray.mockReturnValue(['null-win'])

    registerRegistryCleanerIpc(() => null)

    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    await scanHandler()

    mockFixRegistryEntries.mockImplementation(
      async (_entries: unknown, onProgress: (c: number, t: number, e: string) => void) => {
        onProgress(1, 1, 'null-win')
        return { fixed: 1, failed: 0, failures: [] }
      },
    )

    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    await fixHandler({}, ['null-win'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC.REGISTRY_SET_TWEAK_IGNORED
// ─────────────────────────────────────────────────────────────────────────────

describe('IPC.REGISTRY_SET_TWEAK_IGNORED', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns early when signatures validation fails', () => {
    mockValidateStringArray.mockReturnValue(null)
    registerRegistryCleanerIpc(() => null)
    const handler = getHandler(IPC.REGISTRY_SET_TWEAK_IGNORED)
    const result = handler({}, ['sig1'], true)
    expect(result).toBeUndefined()
    expect(mockUpdateRegistryIgnoredTweaks).not.toHaveBeenCalled()
  })

  it('returns early when ignored is not a boolean', () => {
    mockValidateStringArray.mockReturnValue(['sig1'])
    registerRegistryCleanerIpc(() => null)
    const handler = getHandler(IPC.REGISTRY_SET_TWEAK_IGNORED)
    const result = handler({}, ['sig1'], 'yes')
    expect(result).toBeUndefined()
    expect(mockUpdateRegistryIgnoredTweaks).not.toHaveBeenCalled()
  })

  it('calls updateRegistryIgnoredTweaks with valid arguments', () => {
    mockValidateStringArray.mockReturnValue(['hkcu\\software\\test|valuename'])
    registerRegistryCleanerIpc(() => null)
    const handler = getHandler(IPC.REGISTRY_SET_TWEAK_IGNORED)
    const result = handler({}, ['hkcu\\software\\test|valuename'], true)
    expect(result).toBeUndefined()
    expect(mockUpdateRegistryIgnoredTweaks).toHaveBeenCalledWith(['hkcu\\software\\test|valuename'], true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC.REGISTRY_SCAN_CANCEL
// ─────────────────────────────────────────────────────────────────────────────

describe('IPC.REGISTRY_SCAN_CANCEL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
  })

  it('aborts an in-progress scan', async () => {
    mockScanRegistry.mockImplementation(async (signal: AbortSignal) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Aborted')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    registerRegistryCleanerIpc(() => mockWindow() as never)
    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    const cancelHandler = getHandler(IPC.REGISTRY_SCAN_CANCEL)
    const scanPromise = scanHandler()
    cancelHandler()
    const result = await scanPromise
    expect(result).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// IPC.REGISTRY_FIX_CANCEL
// ─────────────────────────────────────────────────────────────────────────────

describe('IPC.REGISTRY_FIX_CANCEL', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetSettings.mockReturnValue({ registryIgnoredTweaks: [] })
  })

  it('aborts an in-progress fix', async () => {
    const entry = makeEntry('cancel-fix', { selected: true })
    mockScanRegistry.mockResolvedValue([entry])
    mockValidateStringArray.mockReturnValue(['cancel-fix'])
    mockFixRegistryEntries.mockImplementation(async (_entries: unknown, _onProgress: unknown, signal: AbortSignal) => {
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('Cancelled')
          err.name = 'AbortError'
          reject(err)
        })
      })
    })
    registerRegistryCleanerIpc(() => mockWindow() as never)
    const scanHandler = getHandler(IPC.REGISTRY_SCAN)
    await scanHandler()
    const fixHandler = getHandler(IPC.REGISTRY_FIX)
    const cancelHandler = getHandler(IPC.REGISTRY_FIX_CANCEL)
    const fixPromise = fixHandler({}, ['cancel-fix'])
    cancelHandler()
    const result = await fixPromise
    expect(result).toEqual({
      fixed: 0,
      failed: 0,
      failures: [{ issue: 'Cancelled', reason: 'Operation was cancelled by user' }],
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Module re-exports
// ─────────────────────────────────────────────────────────────────────────────

describe('module exports', () => {
  it('re-exports scanRegistry from service', () => {
    expect(scanRegistry).toBeDefined()
    scanRegistry()
    expect(mockScanRegistry).toHaveBeenCalled()
  })

  it('re-exports fixRegistryEntries from service', () => {
    expect(fixRegistryEntries).toBeDefined()
    fixRegistryEntries([])
    expect(mockFixRegistryEntries).toHaveBeenCalled()
  })

  it('re-exports collectBackupTargets from service', () => {
    expect(collectBackupTargets).toBeDefined()
    collectBackupTargets([])
    expect(mockCollectBackupTargets).toHaveBeenCalled()
  })
})
