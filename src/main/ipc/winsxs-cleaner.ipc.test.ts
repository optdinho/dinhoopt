import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mocks ──

const mockHandle = vi.fn()
const mockSend = vi.fn()
const mockSpawn = vi.fn()

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

let spawnEventCallbacks: Record<string, (chunk: Buffer) => void> = {}
let spawnCloseCallback: ((code: number) => void) | null = null

function resetSpawnMocks(): void {
  spawnEventCallbacks = {}
  spawnCloseCallback = null
}

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => {
    mockSpawn(...args)
    return {
      stdout: {
        on: (_event: string, cb: (chunk: Buffer) => void) => {
          spawnEventCallbacks.data = cb
        },
      },
      on: (event: string, cb: unknown) => {
        if (event === 'close') spawnCloseCallback = cb as (code: number) => void
      },
    }
  },
}))

const mockExecFileAsync = vi.fn()
vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args),
}))

const mockIsAdmin = vi.fn()
vi.mock('../services/elevation', () => ({
  isAdmin: () => mockIsAdmin(),
}))

import { CleanerType } from '@shared/enums'
import { registerWinSxSCleanerIpc } from './winsxs-cleaner.ipc'

// ── Helpers ──

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: mockSend } } as never
}

function mockDestroyedWindow() {
  return { isDestroyed: () => true, webContents: { send: mockSend } }
}

// ── Helpers ──

describe('registerWinSxSCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSpawnMocks()
  })

  it('registers WINSXS_ANALYZE and WINSXS_CLEAN handlers', () => {
    registerWinSxSCleanerIpc(() => null)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('winsxs:analyze')
    expect(channels).toContain('winsxs:clean')
  })
})

describe('WINSXS_ANALYZE handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSpawnMocks()
  })

  it('returns elevation marker when not admin', async () => {
    mockIsAdmin.mockReturnValue(false)
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      category: CleanerType.WinSxS,
      subcategory: '__elevation_required',
      items: [],
      totalSize: 0,
      itemCount: 0,
      group: 'WinSxS Component Store',
    })
  })

  it('returns empty items when no reclaimable space', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockExecFileAsync.mockResolvedValue({
      stdout: [
        'Component Store (WinSxS) information:',
        'Actual Size of Component Store : 8.00 GB',
        'Backups and Disabled Features : 0.00 GB',
        'Cache and Temporary Data : 0.00 GB',
        'Number of Reclaimable Packages : 0',
        'Component Store Cleanup Recommended : No',
      ].join('\n'),
    })
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      category: CleanerType.WinSxS,
      subcategory: 'WinSxS Component Store',
      items: [],
      totalSize: 0,
      itemCount: 0,
    })
  })

  it('returns reclaimable space when packages exist', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockExecFileAsync.mockResolvedValue({
      stdout: [
        'Component Store (WinSxS) information:',
        'Actual Size of Component Store : 8.15 GB',
        'Backups and Disabled Features : 1.10 GB',
        'Cache and Temporary Data : 0.98 GB',
        'Date of Last Cleanup : 2024-01-15 10:30:45',
        'Number of Reclaimable Packages : 42',
        'Component Store Cleanup Recommended : Yes',
      ].join('\n'),
    })
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    // Verify /English flag is passed to DISM for locale-independent parsing
    expect(mockExecFileAsync).toHaveBeenCalledWith(
      'cmd.exe',
      expect.arrayContaining([expect.stringMatching(/DISM \/English /)]),
      expect.any(Object),
    )

    const expectedBytes = Math.round(1.1 * 1024 * 1024 * 1024) + Math.round(0.98 * 1024 * 1024 * 1024)
    expect(result).toMatchObject({
      category: CleanerType.WinSxS,
      subcategory: 'WinSxS Component Store',
      totalSize: expectedBytes,
      itemCount: 1,
    })
    const items = (result as { items: { id: string; size: number; category: string }[] }).items
    expect(items).toHaveLength(1)
    expect(items[0]!.id).toBe('winsxs')
    expect(items[0]!.size).toBe(expectedBytes)
    expect(items[0]!.category).toBe(CleanerType.WinSxS)
  })

  it('handles parse errors gracefully', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockExecFileAsync.mockRejectedValue(new Error('DISM command not found'))
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      category: CleanerType.WinSxS,
      items: [],
      totalSize: 0,
      itemCount: 0,
    })
  })

  it('parses comma decimal separators', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockExecFileAsync.mockResolvedValue({
      stdout: [
        'Component Store (WinSxS) information:',
        'Backups and Disabled Features : 1,5 GB',
        'Cache and Temporary Data : 0,75 GB',
        'Number of Reclaimable Packages : 3',
        'Component Store Cleanup Recommended : Yes',
      ].join('\n'),
    })
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    const expected = Math.round(1.5 * 1024 * 1024 * 1024) + Math.round(0.75 * 1024 * 1024 * 1024)
    expect(result).toMatchObject({
      totalSize: expected,
      itemCount: 1,
    })
  })

  it('parses MB values', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockExecFileAsync.mockResolvedValue({
      stdout: [
        'Component Store (WinSxS) information:',
        'Backups and Disabled Features : 0.00 GB',
        'Cache and Temporary Data : 512 MB',
        'Number of Reclaimable Packages : 1',
        'Component Store Cleanup Recommended : Yes',
      ].join('\n'),
    })
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      totalSize: 512 * 1024 * 1024,
      itemCount: 1,
    })
  })

  it('handles null window (destroyed) without crashing', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockExecFileAsync.mockResolvedValue({
      stdout: [
        'Component Store (WinSxS) information:',
        'Backups and Disabled Features : 0.00 GB',
        'Cache and Temporary Data : 0.00 GB',
        'Number of Reclaimable Packages : 0',
        'Component Store Cleanup Recommended : No',
      ].join('\n'),
    })
    registerWinSxSCleanerIpc(() => mockDestroyedWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      category: CleanerType.WinSxS,
      totalSize: 0,
      itemCount: 0,
    })
  })

  it('handles null window in catch block', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockExecFileAsync.mockRejectedValue(new Error('DISM error'))
    registerWinSxSCleanerIpc(() => mockDestroyedWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      category: CleanerType.WinSxS,
      items: [],
      totalSize: 0,
      itemCount: 0,
    })
  })

  it('handles non-Error rejection in catch', async () => {
    mockIsAdmin.mockReturnValue(true)
    mockExecFileAsync.mockRejectedValue('string error')
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      category: CleanerType.WinSxS,
      items: [],
      totalSize: 0,
      itemCount: 0,
    })
  })

  it('sends no progress when not-admin and window destroyed', async () => {
    mockIsAdmin.mockReturnValue(false)
    registerWinSxSCleanerIpc(() => mockDestroyedWindow())

    const handler = getHandler('winsxs:analyze')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      subcategory: '__elevation_required',
    })
    expect(mockSend).not.toHaveBeenCalled()
  })
})

describe('WINSXS_CLEAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetSpawnMocks()
  })

  it('returns needsElevation when not admin', async () => {
    mockIsAdmin.mockReturnValue(false)
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:clean')
    const result = await (handler as () => Promise<unknown>)()

    expect(result).toMatchObject({
      totalCleaned: 0,
      filesDeleted: 0,
      needsElevation: true,
    })
  })

  it('spawns DISM and returns success when admin', async () => {
    mockIsAdmin.mockReturnValue(true)
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:clean')
    const promise = (handler as () => Promise<unknown>)()
    expect(mockSpawn).toHaveBeenCalled()

    const spawnCmd = mockSpawn.mock.calls[0]!
    expect(spawnCmd[0]).toBe('cmd')
    const args = spawnCmd[1] as string[]
    expect(args.join(' ')).toContain('StartComponentCleanup')
    expect(args.join(' ')).toContain('/English')

    // Simulate DISM completing successfully
    if (spawnCloseCallback) spawnCloseCallback(0)
    const result = await promise

    expect(result).toMatchObject({
      totalCleaned: 1,
      filesDeleted: 1,
      needsElevation: false,
    })
  })

  it('sends progress events during clean', async () => {
    mockIsAdmin.mockReturnValue(true)
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:clean')
    const promise = (handler as () => Promise<unknown>)()

    // Simulate DISM progress output
    const stdoutOnData = spawnEventCallbacks.data!
    expect(stdoutOnData).toBeDefined()
    stdoutOnData(Buffer.from('[=====          50.0%                 ]'))

    if (spawnCloseCallback) spawnCloseCallback(0)
    await promise

    expect(mockSend).toHaveBeenCalledWith(
      'scan:progress',
      expect.objectContaining({
        phase: 'cleaning',
        progress: 50,
      }),
    )
  })

  it('does not resend progress when percentage does not increase', async () => {
    mockIsAdmin.mockReturnValue(true)
    registerWinSxSCleanerIpc(() => mockWindow())
    mockSend.mockClear()

    const handler = getHandler('winsxs:clean')
    const promise = (handler as () => Promise<unknown>)()

    const stdoutOnData = spawnEventCallbacks.data
    expect(stdoutOnData).toBeDefined()
    stdoutOnData(Buffer.from('50.0%'))
    stdoutOnData(Buffer.from('50.0%'))

    if (spawnCloseCallback) spawnCloseCallback(0)
    await promise

    // 50% progress send + 100% from close handler = 2 calls
    expect(mockSend).toHaveBeenCalledTimes(2)
    expect(mockSend).toHaveBeenCalledWith('scan:progress', expect.objectContaining({ progress: 50 }))
  })

  it('handles spawn error gracefully', async () => {
    mockIsAdmin.mockReturnValue(true)
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:clean')
    const promise = (handler as () => Promise<unknown>)()

    expect(spawnErrorCallback).toBeDefined()
    spawnErrorCallback!(new Error('DISM not found'))

    const result = await promise
    expect(result).toMatchObject({
      totalCleaned: 0,
      filesDeleted: 0,
      errors: [{ path: 'WinSxS', reason: 'DISM not found' }],
    })
  })

  it('handles non-zero exit code', async () => {
    mockIsAdmin.mockReturnValue(true)
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:clean')
    const promise = (handler as () => Promise<unknown>)()

    expect(spawnCloseCallback).toBeDefined()
    spawnCloseCallback!(1)

    const result = await promise
    expect(result).toMatchObject({
      totalCleaned: 0,
      filesDeleted: 0,
      errors: [{ path: 'WinSxS', reason: 'DISM exited with code 1' }],
    })
  })

  it('handles null exit code (DISM timed out)', async () => {
    mockIsAdmin.mockReturnValue(true)
    registerWinSxSCleanerIpc(() => mockWindow())

    const handler = getHandler('winsxs:clean')
    const promise = (handler as () => Promise<unknown>)()

    expect(spawnCloseCallback).toBeDefined()
    spawnCloseCallback!(null)

    const result = await promise
    expect(result).toMatchObject({
      totalCleaned: 0,
      filesDeleted: 0,
      errors: [{ path: 'WinSxS', reason: 'DISM timed out after 10 minutes' }],
    })
  })

  it('handles destroyed window in clean progress', async () => {
    mockIsAdmin.mockReturnValue(true)
    registerWinSxSCleanerIpc(() => mockDestroyedWindow())

    const handler = getHandler('winsxs:clean')
    const promise = (handler as () => Promise<unknown>)()

    const stdoutOnData = spawnEventCallbacks.data
    expect(stdoutOnData).toBeDefined()
    stdoutOnData(Buffer.from('50.0%'))

    expect(spawnCloseCallback).toBeDefined()
    spawnCloseCallback!(0)

    const result = await promise
    expect(result).toMatchObject({
      totalCleaned: 1,
      filesDeleted: 1,
    })
  })
})
