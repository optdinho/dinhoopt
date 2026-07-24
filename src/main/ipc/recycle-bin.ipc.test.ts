import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ──

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  existsSync: vi.fn(),
  execFileAsync: vi.fn(),
  psArgs: vi.fn((s: string) => ['-NoProfile', '-NonInteractive', '-Command', s]),
  scanDirectory: vi.fn(),
  cleanItems: vi.fn(),
  cacheItems: vi.fn(),
  randomUUID: vi.fn(),
  mockTrashPath: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
}))

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mocks.randomUUID(...args),
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  psArgs: (s: string) => mocks.psArgs(s),
}))

vi.mock('../services/file-utils', () => ({
  scanDirectory: (...args: unknown[]) => mocks.scanDirectory(...args),
  cleanItems: (...args: unknown[]) => mocks.cleanItems(...args),
}))

vi.mock('../services/scan-cache', () => ({
  cacheItems: (...args: unknown[]) => mocks.cacheItems(...args),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('../platform', () => ({
  getPlatform: () => ({
    paths: {
      trashPath: (...args: unknown[]) => mocks.mockTrashPath(...args),
    },
  }),
}))

import { registerRecycleBinIpc } from './recycle-bin.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

// ── PowerShell stdout parsing (Windows scan) ──

function parseRecycleBinScanOutput(stdout: string): { count: number; size: number } {
  const [countStr, sizeStr] = stdout.trim().split('|')
  const count = Number.parseInt(countStr!) || 0
  const size = Number.parseInt(sizeStr!) || 0
  return { count, size }
}

describe('recycle bin scan output parsing', () => {
  it('parses valid count|size output', () => {
    expect(parseRecycleBinScanOutput('42|1048576')).toEqual({ count: 42, size: 1048576 })
  })

  it('handles zero values', () => {
    expect(parseRecycleBinScanOutput('0|0')).toEqual({ count: 0, size: 0 })
  })

  it('handles empty output', () => {
    expect(parseRecycleBinScanOutput('')).toEqual({ count: 0, size: 0 })
  })

  it('handles malformed output', () => {
    expect(parseRecycleBinScanOutput('not a number')).toEqual({ count: 0, size: 0 })
  })

  it('handles output with only count', () => {
    expect(parseRecycleBinScanOutput('5|')).toEqual({ count: 5, size: 0 })
  })

  it('handles output with trailing whitespace', () => {
    expect(parseRecycleBinScanOutput('  10|2048  \n')).toEqual({ count: 10, size: 2048 })
  })

  it('handles large numbers', () => {
    expect(parseRecycleBinScanOutput('5000|10737418240')).toEqual({ count: 5000, size: 10737418240 })
  })
})

// ── Scan result structure (Windows) ──

describe('recycle bin scan result structure', () => {
  it('returns empty array when count is 0', () => {
    const { count } = parseRecycleBinScanOutput('0|0')
    const results = count === 0 ? [] : ['has items']
    expect(results).toEqual([])
  })

  it('returns single ScanResult for non-zero count', () => {
    const { count, size } = parseRecycleBinScanOutput('10|5000')
    expect(count).toBeGreaterThan(0)

    const result = {
      category: 'recycleBin',
      subcategory: 'Recycle Bin',
      items: [
        {
          id: 'test-uuid',
          path: 'Recycle Bin',
          size,
          category: 'recycleBin',
          subcategory: 'Recycle Bin',
          lastModified: Date.now(),
          selected: true,
        },
      ],
      totalSize: size,
      itemCount: count,
    }

    expect(result.category).toBe('recycleBin')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]!.path).toBe('Recycle Bin')
    expect(result.items[0]!.selected).toBe(true)
    expect(result.totalSize).toBe(5000)
    expect(result.itemCount).toBe(10)
  })
})

// ── Clean result structure ──

describe('recycle bin clean result structure', () => {
  it('reports success when remaining count is 0', () => {
    const sizeBeforeClean = 5000
    const remainingStdout = '0'
    const remaining = Number.parseInt(remainingStdout.trim()) || 0

    const result =
      remaining === 0
        ? { totalCleaned: sizeBeforeClean, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false }
        : null

    expect(result).toEqual({
      totalCleaned: 5000,
      filesDeleted: 1,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
  })

  it('reports partial clean when remaining items exist', () => {
    const sizeBeforeClean = 10000
    const remaining = 3

    const result = {
      totalCleaned: sizeBeforeClean,
      filesDeleted: 1,
      filesSkipped: remaining,
      errors: [
        { path: 'Recycle Bin', reason: `${remaining} item(s) could not be removed (may be in use or protected)` },
      ],
      needsElevation: false,
    }

    expect(result.filesSkipped).toBe(3)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]!.reason).toContain('3 item(s)')
  })

  it('reports error on clean failure', () => {
    const err = new Error('Access denied')
    const result = {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [{ path: 'Recycle Bin', reason: err.message }],
      needsElevation: false,
    }

    expect(result.totalCleaned).toBe(0)
    expect(result.errors[0]!.reason).toBe('Access denied')
  })
})

// ── macOS/Linux trash path handling ──

describe('trash path handling', () => {
  it('returns empty array when trash path does not exist', () => {
    const trashExists = false
    const results = trashExists ? ['would scan'] : []
    expect(results).toEqual([])
  })

  it('returns error result on clean failure for trash path', () => {
    const err = new Error('Permission denied')
    const result = {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [{ path: 'Trash', reason: err.message }],
      needsElevation: false,
    }
    expect(result.errors[0]!.path).toBe('Trash')
    expect(result.errors[0]!.reason).toBe('Permission denied')
  })
})

// ── State tracking ──

describe('recycle bin state tracking', () => {
  it('tracks lastScannedSize for clean operations', () => {
    let lastScannedSize = 0

    const { size } = parseRecycleBinScanOutput('100|1048576')
    lastScannedSize = size
    expect(lastScannedSize).toBe(1048576)

    const sizeBeforeClean = lastScannedSize
    lastScannedSize = 0
    expect(sizeBeforeClean).toBe(1048576)
    expect(lastScannedSize).toBe(0)
  })

  it('tracks lastScannedItemIds for macOS/Linux', () => {
    let lastScannedItemIds: string[] = []

    lastScannedItemIds = ['id-1', 'id-2', 'id-3']
    expect(lastScannedItemIds).toHaveLength(3)

    const idsToClean = lastScannedItemIds
    lastScannedItemIds = []
    expect(idsToClean).toHaveLength(3)
    expect(lastScannedItemIds).toHaveLength(0)
  })
})

// ── Remaining items count parsing ──

describe('remaining items count parsing', () => {
  it('parses valid integer', () => {
    expect(Number.parseInt('0'.trim()) || 0).toBe(0)
    expect(Number.parseInt('5'.trim()) || 0).toBe(5)
  })

  it('handles whitespace/newlines', () => {
    expect(Number.parseInt('  3  \n'.trim()) || 0).toBe(3)
  })

  it('returns 0 for non-numeric output', () => {
    expect(Number.parseInt('error'.trim()) || 0).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(Number.parseInt(''.trim()) || 0).toBe(0)
  })
})

// ═══════════════════════════════════════════════════════════════
// NEW TESTS: IPC Handler registration and full handler coverage
// ═══════════════════════════════════════════════════════════════

describe('registerRecycleBinIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers both IPC handlers', () => {
    registerRecycleBinIpc()
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('cleaner:recyclebin:scan')
    expect(channels).toContain('cleaner:recyclebin:clean')
    expect(channels.length).toBe(2)
  })
})

describe('RECYCLE_BIN_SCAN handler (macOS/Linux with trash path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockTrashPath.mockReturnValue('/Users/test/.Trash')
    mocks.randomUUID.mockReturnValue('mock-uuid')
  })

  it('returns empty array when trash path does not exist on disk', async () => {
    mocks.existsSync.mockReturnValue(false)
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:scan')
    const result = await handler()
    expect(result).toEqual([])
    expect(mocks.logger.info).toHaveBeenCalledWith('recycle-bin', 'Trash path does not exist')
    expect(mocks.scanDirectory).not.toHaveBeenCalled()
  })

  it('returns scan results when items are found', async () => {
    mocks.existsSync.mockReturnValue(true)
    const scanResult = {
      category: 'recycleBin',
      subcategory: 'Trash',
      items: [
        {
          id: 'item-1',
          path: '/Users/test/.Trash/file',
          size: 1024,
          category: 'recycleBin' as const,
          subcategory: 'Trash',
          lastModified: Date.now(),
          selected: true,
        },
      ],
      totalSize: 1024,
      itemCount: 1,
    }
    mocks.scanDirectory.mockResolvedValue(scanResult)
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:scan')
    const result = (await handler()) as Array<{ items: Array<{ id: string }> }>
    expect(result).toEqual([scanResult])
    expect(mocks.cacheItems).toHaveBeenCalledWith(scanResult.items)
    expect(mocks.logger.success).toHaveBeenCalledWith('recycle-bin', 'Found 1 items (1024 bytes)')
  })

  it('returns empty array when scan returns no items', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.scanDirectory.mockResolvedValue({
      category: 'recycleBin',
      subcategory: 'Trash',
      items: [],
      totalSize: 0,
      itemCount: 0,
    })
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:scan')
    const result = await handler()
    expect(result).toEqual([])
    expect(mocks.cacheItems).not.toHaveBeenCalled()
    expect(mocks.logger.info).toHaveBeenCalledWith('recycle-bin', 'No items found in trash')
  })

  it('returns empty array and logs error on scan failure', async () => {
    mocks.existsSync.mockReturnValue(true)
    const scanErr = new Error('Permission denied')
    mocks.scanDirectory.mockRejectedValue(scanErr)
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:scan')
    const result = await handler()
    expect(result).toEqual([])
    expect(mocks.logger.error).toHaveBeenCalledWith('recycle-bin', 'Scan failed: Error: Permission denied')
  })
})

describe('RECYCLE_BIN_SCAN handler (Windows, no trash path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockTrashPath.mockReturnValue(null)
    mocks.randomUUID.mockReturnValue('mock-uuid')
  })

  it('returns scan results from PowerShell COM', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '42|1048576' })
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:scan')
    const result = (await handler()) as Array<{
      category: string
      subcategory: string
      totalSize: number
      itemCount: number
      items: Array<{
        size: number
        path: string
        selected: boolean
        id: string
      }>
    }>
    expect(result).toHaveLength(1)
    expect(result[0]!.category).toBe('recycleBin')
    expect(result[0]!.subcategory).toBe('Recycle Bin')
    expect(result[0]!.totalSize).toBe(1048576)
    expect(result[0]!.itemCount).toBe(42)
    expect(result[0]!.items).toHaveLength(1)
    expect(result[0]!.items[0]!.size).toBe(1048576)
    expect(result[0]!.items[0]!.path).toBe('Recycle Bin')
    expect(result[0]!.items[0]!.selected).toBe(true)
    expect(result[0]!.items[0]!.id).toBe('mock-uuid')
    expect(mocks.logger.success).toHaveBeenCalledWith('recycle-bin', 'Found 42 items totalling 1048576 bytes')
  })

  it('returns empty array when recycle bin is empty', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '0|0' })
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:scan')
    const result = await handler()
    expect(result).toEqual([])
    expect(mocks.logger.info).toHaveBeenCalledWith('recycle-bin', 'Recycle bin is empty')
  })

  it('returns empty array on PowerShell exec failure', async () => {
    const psErr = new Error('PowerShell not available')
    mocks.execFileAsync.mockRejectedValue(psErr)
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:scan')
    const result = await handler()
    expect(result).toEqual([])
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'recycle-bin',
      'Windows scan failed: Error: PowerShell not available',
    )
  })

  it('uses psArgs with correct PowerShell script for COM scan', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '5|1024' })
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:scan')
    await handler()
    expect(mocks.execFileAsync).toHaveBeenCalledWith('powershell.exe', expect.any(Array), { windowsHide: true })
    expect(mocks.psArgs).toHaveBeenCalledWith(expect.stringContaining('Shell.Application'))
  })
})

describe('RECYCLE_BIN_CLEAN handler (macOS/Linux with trash path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockTrashPath.mockReturnValue('/Users/test/.Trash')
  })

  it('cleans items and returns result', async () => {
    mocks.cleanItems.mockResolvedValue({
      totalCleaned: 5000,
      filesDeleted: 3,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:clean')
    const result = await handler()
    expect(result).toEqual({
      totalCleaned: 5000,
      filesDeleted: 3,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
    expect(mocks.logger.success).toHaveBeenCalledWith('recycle-bin', 'Cleaned 5000 bytes from trash')
  })

  it('returns error result on clean failure with Error', async () => {
    mocks.cleanItems.mockRejectedValue(new Error('Permission denied'))
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:clean')
    const result = await handler()
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [{ path: 'Trash', reason: 'Permission denied' }],
      needsElevation: false,
    })
    expect(mocks.logger.error).toHaveBeenCalledWith('recycle-bin', 'Trash clean failed: Permission denied')
  })

  it('handles non-Error rejection gracefully (unknown type)', async () => {
    mocks.cleanItems.mockRejectedValue('string error')
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:clean')
    const result = await handler()
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [{ path: 'Trash', reason: 'Unknown error' }],
      needsElevation: false,
    })
    expect(mocks.logger.error).toHaveBeenCalledWith('recycle-bin', 'Trash clean failed: Unknown error')
  })
})

describe('RECYCLE_BIN_CLEAN handler (Windows, no trash path)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.mockTrashPath.mockReturnValue(null)
  })

  it('returns success result when recycle bin empties completely', async () => {
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: '0|0' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '0' })
    registerRecycleBinIpc()
    await getHandler('cleaner:recyclebin:scan')()
    const handler = getHandler('cleaner:recyclebin:clean')
    const result = await handler()
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 1,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
    expect(mocks.logger.success).toHaveBeenCalledWith('recycle-bin', 'Cleaned 0 bytes from recycle bin')
  })

  it('cleans with previously scanned size', async () => {
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: '10|5000' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '0' })
    registerRecycleBinIpc()
    await getHandler('cleaner:recyclebin:scan')()
    const handler = getHandler('cleaner:recyclebin:clean')
    const result = await handler()
    expect(result).toEqual({
      totalCleaned: 5000,
      filesDeleted: 1,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
    expect(mocks.logger.success).toHaveBeenCalledWith('recycle-bin', 'Cleaned 5000 bytes from recycle bin')
  })

  it('reports partial clean when items remain after emptying', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce({ stdout: '3' })
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:clean')
    const result = await handler()
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 1,
      filesSkipped: 3,
      errors: [
        {
          path: 'Recycle Bin',
          reason: '3 item(s) could not be removed (may be in use or protected)',
        },
      ],
      needsElevation: false,
    })
    expect(mocks.logger.warning).toHaveBeenCalledWith('recycle-bin', 'Partial clean: 3 items remaining (may be in use)')
  })

  it('returns error result on PowerShell clean failure with Error', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('Access denied'))
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:clean')
    const result = await handler()
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [{ path: 'Recycle Bin', reason: 'Access denied' }],
      needsElevation: false,
    })
    expect(mocks.logger.error).toHaveBeenCalledWith('recycle-bin', 'Windows clean failed: Access denied')
  })

  it('handles non-Error rejection in Windows clean', async () => {
    mocks.execFileAsync.mockRejectedValue('string error')
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:clean')
    const result = await handler()
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [{ path: 'Recycle Bin', reason: 'Unknown error' }],
      needsElevation: false,
    })
    expect(mocks.logger.error).toHaveBeenCalledWith('recycle-bin', 'Windows clean failed: Unknown error')
  })

  it('uses psArgs with SHEmptyRecycleBin and verification PowerShell scripts', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce({ stdout: '0' })
    registerRecycleBinIpc()
    const handler = getHandler('cleaner:recyclebin:clean')
    await handler()
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(2)
    expect(mocks.psArgs).toHaveBeenCalledTimes(2)
    const psCalls = mocks.psArgs.mock.calls.map((c) => c[0])
    expect(psCalls[0]).toContain('SHEmptyRecycleBin')
    expect(psCalls[1]).toContain('Shell.Application')
  })
})
