import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Hoisted mocks ──

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  execFileAsync: vi.fn(),
  psArgs: vi.fn((s: string) => ['-NoProfile', '-NonInteractive', '-Command', s]),
  randomUUID: vi.fn(),
  senderValid: true,
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mocks.randomUUID(...args),
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  psArgs: (s: string) => mocks.psArgs(s),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('./sender-validation', () => ({
  validateSender: () => mocks.senderValid,
}))

import { registerRecycleBinIpc } from './recycle-bin.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

const emptyClean = { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.senderValid = true
})

describe('registerRecycleBinIpc', () => {
  it('registers both IPC handlers', () => {
    registerRecycleBinIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('cleaner:recyclebin:scan')
    expect(channels).toContain('cleaner:recyclebin:clean')
    expect(channels.length).toBe(2)
  })
})

describe('RECYCLE_BIN_SCAN handler', () => {
  beforeEach(() => {
    mocks.randomUUID.mockReturnValue('mock-uuid')
  })

  it('returns scan results from PowerShell COM', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '42|1048576' })
    registerRecycleBinIpc(() => null)
    const result = (await getHandler('cleaner:recyclebin:scan')()) as Array<{
      category: string
      subcategory: string
      totalSize: number
      itemCount: number
      items: Array<{ size: number; path: string; selected: boolean; id: string }>
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
    registerRecycleBinIpc(() => null)
    const result = await getHandler('cleaner:recyclebin:scan')()
    expect(result).toEqual([])
    expect(mocks.logger.info).toHaveBeenCalledWith('recycle-bin', 'Recycle bin is empty')
  })

  it('tolerates empty stdout', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '' })
    registerRecycleBinIpc(() => null)
    expect(await getHandler('cleaner:recyclebin:scan')()).toEqual([])
  })

  it('tolerates malformed stdout', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: 'not a number' })
    registerRecycleBinIpc(() => null)
    expect(await getHandler('cleaner:recyclebin:scan')()).toEqual([])
  })

  it('treats a missing size field as zero', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '5|' })
    registerRecycleBinIpc(() => null)
    const result = (await getHandler('cleaner:recyclebin:scan')()) as Array<{ totalSize: number; itemCount: number }>
    expect(result[0]!.itemCount).toBe(5)
    expect(result[0]!.totalSize).toBe(0)
  })

  it('returns empty array on PowerShell exec failure', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('PowerShell not available'))
    registerRecycleBinIpc(() => null)
    const result = await getHandler('cleaner:recyclebin:scan')()
    expect(result).toEqual([])
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'recycle-bin',
      'Windows scan failed: Error: PowerShell not available',
    )
  })

  it('uses psArgs with the COM scan script', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '5|1024' })
    registerRecycleBinIpc(() => null)
    await getHandler('cleaner:recyclebin:scan')()
    expect(mocks.execFileAsync).toHaveBeenCalledWith('powershell.exe', expect.any(Array), { windowsHide: true })
    expect(mocks.psArgs).toHaveBeenCalledWith(expect.stringContaining('Shell.Application'))
  })

  it('rejects and skips PowerShell when the sender is invalid', async () => {
    mocks.senderValid = false
    registerRecycleBinIpc(() => null)
    const result = await getHandler('cleaner:recyclebin:scan')()
    expect(result).toEqual([])
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
  })
})

describe('RECYCLE_BIN_CLEAN handler', () => {
  it('returns success result when recycle bin empties completely', async () => {
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: '0|0' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '0|0' })
    registerRecycleBinIpc(() => null)
    await getHandler('cleaner:recyclebin:scan')()
    const result = await getHandler('cleaner:recyclebin:clean')()
    expect(result).toEqual({ totalCleaned: 0, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false })
    expect(mocks.logger.success).toHaveBeenCalledWith('recycle-bin', 'Cleaned 0 bytes from recycle bin')
  })

  it('cleans with previously scanned size', async () => {
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: '10|5000' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '0|0' })
    registerRecycleBinIpc(() => null)
    await getHandler('cleaner:recyclebin:scan')()
    const result = await getHandler('cleaner:recyclebin:clean')()
    expect(result).toEqual({ totalCleaned: 5000, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false })
    expect(mocks.logger.success).toHaveBeenCalledWith('recycle-bin', 'Cleaned 5000 bytes from recycle bin')
  })

  it('reports the actual space freed using the post-clean size', async () => {
    mocks.execFileAsync
      .mockResolvedValueOnce({ stdout: '10|5000' })
      .mockResolvedValueOnce({ stdout: '' })
      .mockResolvedValueOnce({ stdout: '0|200' })
    registerRecycleBinIpc(() => null)
    await getHandler('cleaner:recyclebin:scan')()
    const result = (await getHandler('cleaner:recyclebin:clean')()) as { totalCleaned: number }
    expect(result.totalCleaned).toBe(4800)
  })

  it('reports partial clean when items remain after emptying', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce({ stdout: '3|0' })
    registerRecycleBinIpc(() => null)
    const result = await getHandler('cleaner:recyclebin:clean')()
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 1,
      filesSkipped: 3,
      errors: [{ path: 'Recycle Bin', reason: '3 item(s) could not be removed (may be in use or protected)' }],
      needsElevation: false,
    })
    expect(mocks.logger.warning).toHaveBeenCalledWith('recycle-bin', 'Partial clean: 3 items remaining (may be in use)')
  })

  it('returns error result on PowerShell clean failure with Error', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('Access denied'))
    registerRecycleBinIpc(() => null)
    const result = await getHandler('cleaner:recyclebin:clean')()
    expect(result).toEqual({ ...emptyClean, errors: [{ path: 'Recycle Bin', reason: 'Access denied' }] })
    expect(mocks.logger.error).toHaveBeenCalledWith('recycle-bin', 'Windows clean failed: Access denied')
  })

  it('handles non-Error rejection in clean', async () => {
    mocks.execFileAsync.mockRejectedValue('string error')
    registerRecycleBinIpc(() => null)
    const result = await getHandler('cleaner:recyclebin:clean')()
    expect(result).toEqual({ ...emptyClean, errors: [{ path: 'Recycle Bin', reason: 'Unknown error' }] })
    expect(mocks.logger.error).toHaveBeenCalledWith('recycle-bin', 'Windows clean failed: Unknown error')
  })

  it('uses psArgs with SHEmptyRecycleBin and verification scripts', async () => {
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '' }).mockResolvedValueOnce({ stdout: '0|0' })
    registerRecycleBinIpc(() => null)
    await getHandler('cleaner:recyclebin:clean')()
    expect(mocks.execFileAsync).toHaveBeenCalledTimes(2)
    const psCalls = mocks.psArgs.mock.calls.map((c) => c[0])
    expect(psCalls[0]).toContain('SHEmptyRecycleBin')
    expect(psCalls[1]).toContain('Shell.Application')
  })

  it('rejects and skips PowerShell when the sender is invalid', async () => {
    mocks.senderValid = false
    registerRecycleBinIpc(() => null)
    const result = await getHandler('cleaner:recyclebin:clean')()
    expect(result).toEqual(emptyClean)
    expect(mocks.execFileAsync).not.toHaveBeenCalled()
  })
})
