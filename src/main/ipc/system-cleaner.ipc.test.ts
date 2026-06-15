import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

const mockScanDirectory = vi.fn()
const mockScanFile = vi.fn()
const mockScanMultipleDirectories = vi.fn()
const mockResolveChildSubdirs = vi.fn()
const mockCleanItems = vi.fn()
const mockScanWithFileMask = vi.fn()
vi.mock('../services/file-utils', () => ({
  scanDirectory: (...args: unknown[]) => mockScanDirectory(...args),
  scanFile: (...args: unknown[]) => mockScanFile(...args),
  scanMultipleDirectories: (...args: unknown[]) => mockScanMultipleDirectories(...args),
  resolveChildSubdirs: (...args: unknown[]) => mockResolveChildSubdirs(...args),
  cleanItems: (...args: unknown[]) => mockCleanItems(...args),
  scanWithFileMask: (...args: unknown[]) => mockScanWithFileMask(...args),
}))

const mockCacheItems = vi.fn()
vi.mock('../services/scan-cache', () => ({
  cacheItems: (...args: unknown[]) => mockCacheItems(...args),
}))

const mockIsAdmin = vi.fn()
vi.mock('../services/elevation', () => ({
  isAdmin: (...args: unknown[]) => mockIsAdmin(...args),
}))

const mockSystemCleanTargets = vi.fn()
const mockSingleFileCleanTargets = vi.fn()
const mockProtectedEventLogs = vi.fn()
vi.mock('../platform', () => ({
  getPlatform: () => ({
    paths: {
      systemCleanTargets: () => mockSystemCleanTargets(),
      singleFileCleanTargets: () => mockSingleFileCleanTargets(),
      protectedEventLogs: () => mockProtectedEventLogs(),
    },
  }),
}))

vi.mock('../services/ipc-validation', () => ({
  validateStringArray: (input: unknown) => {
    if (!Array.isArray(input)) return null
    if (!input.every((v: unknown) => typeof v === 'string')) return null
    return input as string[]
  },
}))

const mockGetImportedRules = vi.fn()
vi.mock('./winapp2-rules-store', () => ({
  getImportedRules: (...args: unknown[]) => mockGetImportedRules(...args),
}))

import { registerSystemCleanerIpc } from './system-cleaner.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

const mockSend = vi.fn()
function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: mockSend } }
}

describe('registerSystemCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProtectedEventLogs.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([])
    mockIsAdmin.mockReturnValue(true)
  })

  it('registers SYSTEM_SCAN and SYSTEM_CLEAN handlers', () => {
    registerSystemCleanerIpc(() => null)
    const channels = mockHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('cleaner:system:scan')
    expect(channels).toContain('cleaner:system:clean')
  })
})

describe('SYSTEM_SCAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockProtectedEventLogs.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([])
    mockIsAdmin.mockReturnValue(true)
  })

  it('returns empty results when no targets defined', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([])
    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toEqual([])
  })

  it('scans each system target and caches items', async () => {
    mockSystemCleanTargets.mockReturnValue([
      { path: '/tmp/cache', subcategory: 'Temp Cache', needsAdmin: false, childSubdir: undefined },
      { path: '/tmp/logs', subcategory: 'Logs', needsAdmin: false, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockScanDirectory.mockImplementation((_path: string, _cat: string, sub: string) =>
      Promise.resolve({
        category: 'system',
        subcategory: sub,
        items: sub === 'Logs' ? [] : [{ id: '1', path: '/tmp/cache/file', size: 500 }],
        totalSize: 500,
        itemCount: 1,
      }),
    )

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(1)
    expect(mockCacheItems).toHaveBeenCalledTimes(1)
  })

  it('skips targets that require admin when not elevated', async () => {
    mockIsAdmin.mockReturnValue(false)
    mockSystemCleanTargets.mockReturnValue([
      { path: '/admin-only', subcategory: 'Admin Target', needsAdmin: true, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = (await handler()) as Array<{ subcategory: string }>
    expect(results).toHaveLength(1)
    expect(results[0]!.subcategory).toBe('__elevation_required')
  })

  it('filters protected event log files', async () => {
    mockProtectedEventLogs.mockReturnValue(['protected.evtx'])
    mockSystemCleanTargets.mockReturnValue([
      { path: '/logs/event', subcategory: 'Event Log Archives', needsAdmin: false, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockScanDirectory.mockResolvedValue({
      category: 'system',
      subcategory: 'Event Log Archives',
      items: [
        { id: '1', path: '/logs/event/protected.evtx', size: 1000 },
        { id: '2', path: '/logs/event/normal.evtx', size: 500 },
      ],
      totalSize: 1500,
      itemCount: 2,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = (await handler()) as Array<{ items: Array<{ path: string }>; totalSize: number; itemCount: number }>
    expect(results).toHaveLength(1)
    expect(results[0]!.items).toHaveLength(1)
    expect(results[0]!.items[0]!.path).toContain('normal.evtx')
    expect(results[0]!.totalSize).toBe(500)
  })

  it('sends progress during scan', async () => {
    mockSystemCleanTargets.mockReturnValue([
      { path: '/tmp/test', subcategory: 'Test', needsAdmin: false, childSubdir: undefined },
    ])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockScanDirectory.mockResolvedValue({
      category: 'system',
      subcategory: 'Test',
      items: [],
      totalSize: 0,
      itemCount: 0,
    })

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerSystemCleanerIpc(() => mockWindow() as any)
    const handler = getHandler('cleaner:system:scan')
    await handler()
    expect(mockSend).toHaveBeenCalledWith(
      'scan:progress',
      expect.objectContaining({
        phase: 'scanning',
        category: 'system',
      }),
    )
  })

  it('scans single file targets', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([
      { path: '/tmp/dump.dmp', subcategory: 'Memory Dumps', needsAdmin: false },
      { path: '/tmp/missing.dmp', subcategory: 'Missing Dumps', needsAdmin: false },
    ])
    mockScanFile
      .mockResolvedValueOnce({
        category: 'system',
        subcategory: 'Memory Dumps',
        items: [{ id: '1', path: '/tmp/dump.dmp', size: 100 }],
        totalSize: 100,
        itemCount: 1,
      })
      .mockRejectedValueOnce(new Error('Not found'))

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(1)
  })

  it('scans winapp2 imported rules', async () => {
    mockSystemCleanTargets.mockReturnValue([])
    mockSingleFileCleanTargets.mockReturnValue([])
    mockGetImportedRules.mockReturnValue([
      { path: '${LOCALAPPDATA}\\Temp', fileMask: '*', recurse: true, subcategory: 'Winapp2 Temp' },
    ])
    mockScanWithFileMask.mockResolvedValue({
      category: 'system',
      subcategory: 'Winapp2 Temp',
      items: [{ id: 'w1', path: '/tmp/winapp2/file', size: 200 }],
      totalSize: 200,
      itemCount: 1,
    })

    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:scan')
    const results = await handler()
    expect(results).toHaveLength(1)
    expect(mockScanWithFileMask).toHaveBeenCalled()
  })
})

describe('SYSTEM_CLEAN handler', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects invalid input', async () => {
    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:clean')
    const result = (await handler({}, null)) as {
      totalCleaned: number
      filesDeleted: number
      filesSkipped: number
      errors: unknown[]
      needsElevation: boolean
    }
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
  })

  it('calls cleanItems with valid IDs and progress callback', async () => {
    mockCleanItems.mockResolvedValue({
      totalCleaned: 5000,
      filesDeleted: 10,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
    registerSystemCleanerIpc(() => null)
    const handler = getHandler('cleaner:system:clean')
    const result = await handler({}, ['id-1', 'id-2'])
    expect(mockCleanItems).toHaveBeenCalledWith(['id-1', 'id-2'], expect.any(Function))
    expect((result as { filesDeleted: number }).filesDeleted).toBe(10)
  })
})
