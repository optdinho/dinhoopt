import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs/promises', () => ({
  rm: vi.fn(),
  stat: vi.fn(),
  readdir: vi.fn(),
  open: vi.fn(),
  writeFile: vi.fn(),
}))

vi.mock('fs', () => ({
  existsSync: vi.fn(),
}))

vi.mock('crypto', () => ({
  randomUUID: () => 'mock-uuid',
  randomBytes: (size: number) => Buffer.alloc(size, 0xAB),
}))

let mockSettings: any

vi.mock('./settings-store', () => ({
  getSettings: vi.fn(),
}))

vi.mock('./scan-cache', () => ({
  getCachedItems: vi.fn(),
}))

import { rm, stat, readdir, open, writeFile } from 'fs/promises'
import { existsSync } from 'fs'

import {
  isExcluded,
  safeDelete,
  cleanItems,
  scanDirectory,
  scanMultipleDirectories,
  scanFile,
  scanDirectoriesAsItems,
  resolveChildSubdirs,
  getDirectorySize,
} from './file-utils'
import { getSettings } from './settings-store'
import { getCachedItems } from './scan-cache'

const mockedRm = vi.mocked(rm)
const mockedStat = vi.mocked(stat)
const mockedReaddir = vi.mocked(readdir)
const mockedOpen = vi.mocked(open)
const mockedExistsSync = vi.mocked(existsSync)
const mockedGetSettings = vi.mocked(getSettings)
const mockedGetCachedItems = vi.mocked(getCachedItems)

beforeEach(() => {
  vi.resetAllMocks()
  mockSettings = {
    cleaner: { secureDelete: false, skipRecentMinutes: 60 },
    exclusions: [],
  }
  mockedGetSettings.mockReturnValue(mockSettings)
  mockedGetCachedItems.mockReturnValue([])
})

function mockDirEntry(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir } as any
}

function mockFileStats(size: number, mtimeMs = Date.now()): any {
  return {
    size,
    mtimeMs,
    isFile: () => true,
    isDirectory: () => false,
  }
}

function mockDirStats(): any {
  return {
    isFile: () => false,
    isDirectory: () => true,
  }
}

// ─────────────────────────────────────────────
// isExcluded (existing)
// ─────────────────────────────────────────────
describe('isExcluded', () => {
  it('returns false for empty exclusions', () => {
    expect(isExcluded('C:\\temp\\file.txt', [])).toBe(false)
  })
  it('matches *.log extension pattern', () => {
    expect(isExcluded('C:\\logs\\app.log', ['*.log'])).toBe(true)
  })
  it('matches *.tmp extension pattern', () => {
    expect(isExcluded('C:\\temp\\cache.tmp', ['*.tmp'])).toBe(true)
  })
  it('does not match different extension', () => {
    expect(isExcluded('C:\\temp\\file.txt', ['*.log'])).toBe(false)
  })
  it('extension match is case-insensitive', () => {
    expect(isExcluded('C:\\temp\\file.LOG', ['*.log'])).toBe(true)
    expect(isExcluded('C:\\temp\\file.log', ['*.LOG'])).toBe(true)
  })
  it('matches exact path prefix', () => {
    expect(isExcluded('C:\\Users\\keep\\file.txt', ['C:\\Users\\keep'])).toBe(true)
  })
  it('matches exact path', () => {
    expect(isExcluded('C:\\Users\\keep', ['C:\\Users\\keep'])).toBe(true)
  })
  it('path prefix match is case-insensitive', () => {
    expect(isExcluded('C:\\USERS\\keep\\file.txt', ['c:\\users\\keep'])).toBe(true)
  })
  it('normalizes forward slashes to backslashes', () => {
    expect(isExcluded('C:/temp/file.log', ['*.log'])).toBe(true)
    expect(isExcluded('C:/Users/keep/file.txt', ['C:/Users/keep'])).toBe(true)
  })
  it('does not match unrelated path', () => {
    expect(isExcluded('D:\\other\\file.txt', ['C:\\Users\\keep'])).toBe(false)
  })
  it('matches any of multiple exclusions', () => {
    const exclusions = ['*.log', '*.tmp', 'C:\\protected']
    expect(isExcluded('C:\\temp\\debug.log', exclusions)).toBe(true)
    expect(isExcluded('C:\\temp\\cache.tmp', exclusions)).toBe(true)
    expect(isExcluded('C:\\protected\\data.db', exclusions)).toBe(true)
    expect(isExcluded('C:\\temp\\file.txt', exclusions)).toBe(false)
  })
  it('handles deeply nested paths', () => {
    expect(isExcluded('C:\\a\\b\\c\\d\\e\\f.log', ['*.log'])).toBe(true)
  })
  it('extension pattern requires dot', () => {
    expect(isExcluded('C:\\temp\\catalog', ['*.log'])).toBe(false)
  })
})

// ─────────────────────────────────────────────
// safeDelete
// ─────────────────────────────────────────────
describe('safeDelete', () => {
  it('deletes a file successfully', async () => {
    mockedRm.mockResolvedValue(undefined)
    const result = await safeDelete('C:\\temp\\file.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\file.tmp', success: true })
    expect(mockedRm).toHaveBeenCalledWith('C:\\temp\\file.tmp', { force: true, recursive: true })
  })

  it('calls secureOverwrite when secureDelete is enabled', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockResolvedValue(mockFileStats(1024))
    const mockFd = { write: vi.fn(), datasync: vi.fn(), close: vi.fn() }
    const mockFileHandle = { ...mockFd, on: vi.fn() }
    mockedOpen.mockResolvedValue(mockFileHandle as any)
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\temp\\file.tmp')
    expect(result.success).toBe(true)
    expect(mockedOpen).toHaveBeenCalledWith('C:\\temp\\file.tmp', 'r+')
    expect(mockFd.write).toHaveBeenCalled()
    expect(mockFd.datasync).toHaveBeenCalled()
    expect(mockFd.close).toHaveBeenCalled()
  })

  it('still deletes if secureOverwrite fails', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockRejectedValue(new Error('permission'))
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\temp\\file.tmp')
    expect(result.success).toBe(true)
  })

  it('returns in-use for EBUSY error', async () => {
    const err = new Error('file in use') as any
    err.code = 'EBUSY'
    mockedRm.mockRejectedValue(err)

    const result = await safeDelete('C:\\temp\\locked.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\locked.tmp', success: false, reason: 'in-use' })
  })

  it('returns permission-denied for EACCES error', async () => {
    const err = new Error('access denied') as any
    err.code = 'EACCES'
    mockedRm.mockRejectedValue(err)

    const result = await safeDelete('C:\\temp\\protected.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\protected.tmp', success: false, reason: 'permission-denied' })
  })

  it('returns success for ENOENT error (file already gone)', async () => {
    const err = new Error('not found') as any
    err.code = 'ENOENT'
    mockedRm.mockRejectedValue(err)

    const result = await safeDelete('C:\\temp\\gone.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\gone.tmp', success: true })
  })

  it('returns error with message for unknown errors', async () => {
    mockedRm.mockRejectedValue(new Error('disk full'))

    const result = await safeDelete('C:\\temp\\other.tmp')
    expect(result).toEqual({ path: 'C:\\temp\\other.tmp', success: false, reason: 'disk full' })
  })
})

// ─────────────────────────────────────────────
// cleanItems
// ─────────────────────────────────────────────
describe('cleanItems', () => {
  it('validates and cleans cached items', async () => {
    mockedGetCachedItems.mockReturnValue([
      { id: '1', path: 'C:\\a.tmp', size: 100, selected: true },
      { id: '2', path: 'C:\\b.tmp', size: 200, selected: true },
    ])
    mockedRm.mockResolvedValue(undefined)

    const result = await cleanItems(['1', '2'])
    expect(result.filesDeleted).toBe(2)
    expect(result.filesSkipped).toBe(0)
    expect(result.totalCleaned).toBe(300)
    expect(result.needsElevation).toBe(false)
  })

  it('filters out non-string IDs', async () => {
    mockedGetCachedItems.mockReturnValue([])
    const result = await cleanItems([1, 'valid'] as any)
    expect(mockedGetCachedItems).toHaveBeenCalledWith(['valid'])
  })

  it('handles non-array input', async () => {
    const result = await cleanItems(null)
    expect(result.filesDeleted).toBe(0)
    expect(mockedGetCachedItems).toHaveBeenCalledWith([])
  })

  it('reports skipped files and errors', async () => {
    mockedGetCachedItems.mockReturnValue([
      { id: '1', path: 'C:\\a.tmp', size: 100, selected: true },
      { id: '2', path: 'C:\\b.tmp', size: 200, selected: true },
    ])
    mockedRm.mockRejectedValueOnce(Object.assign(new Error('permission'), { code: 'EACCES' }))
    mockedRm.mockResolvedValueOnce(undefined)

    const result = await cleanItems(['1', '2'])
    expect(result.filesDeleted).toBe(1)
    expect(result.filesSkipped).toBe(1)
    expect(result.totalCleaned).toBe(200)
    expect(result.needsElevation).toBe(true)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].reason).toBe('permission-denied')
  })

  it('calls onProgress callback', async () => {
    mockedGetCachedItems.mockReturnValue([
      { id: '1', path: 'C:\\a.tmp', size: 100, selected: true },
    ])
    mockedRm.mockResolvedValue(undefined)
    const onProgress = vi.fn()

    await cleanItems(['1'], onProgress)
    expect(onProgress).toHaveBeenCalledWith(1, 1, 'C:\\a.tmp', 100)
  })
})

// ─────────────────────────────────────────────
// getDirectorySize
// ─────────────────────────────────────────────
describe('getDirectorySize', () => {
  it('returns 0 for maxDepth <= 0', async () => {
    expect(await getDirectorySize('C:\\dir', 0)).toBe(0)
  })

  it('sums file sizes in directory', async () => {
    mockedReaddir.mockResolvedValue([
      mockDirEntry('a.txt', false),
      mockDirEntry('b.txt', false),
    ])
    mockedStat.mockResolvedValueOnce(mockFileStats(100))
    mockedStat.mockResolvedValueOnce(mockFileStats(200))

    expect(await getDirectorySize('C:\\dir', 2)).toBe(300)
  })

  it('recurses into subdirectories', async () => {
    mockedReaddir
      .mockResolvedValueOnce([mockDirEntry('sub', true)])
      .mockResolvedValueOnce([mockDirEntry('c.txt', false)])
    mockedStat
      .mockResolvedValueOnce(mockDirStats())
      .mockResolvedValueOnce(mockFileStats(500))

    expect(await getDirectorySize('C:\\dir', 3)).toBe(500)
  })

  it('skips inaccessible entries', async () => {
    mockedReaddir.mockResolvedValue([mockDirEntry('secret.txt', false)])
    mockedStat.mockRejectedValue(new Error('access denied'))

    expect(await getDirectorySize('C:\\dir', 2)).toBe(0)
  })

  it('returns 0 when readdir fails', async () => {
    mockedReaddir.mockRejectedValue(new Error('not found'))
    expect(await getDirectorySize('C:\\gone', 2)).toBe(0)
  })
})

// ─────────────────────────────────────────────
// scanDirectory
// ─────────────────────────────────────────────
describe('scanDirectory', () => {
  const OLD = Date.now() - 7_200_000

  it('scans files and returns ScanResult', async () => {
    mockedReaddir.mockResolvedValue([
      mockDirEntry('old.log', false),
      mockDirEntry('recent.log', false),
    ])
    mockedStat
      .mockResolvedValueOnce(mockFileStats(500, OLD))
      .mockResolvedValueOnce(mockFileStats(1000, Date.now()))

    const result = await scanDirectory('C:\\logs', 'system', 'logs')
    expect(result.category).toBe('system')
    expect(result.subcategory).toBe('logs')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].path).toBe('C:\\logs\\old.log')
    expect(result.items[0].size).toBe(500)
  })

  it('skips excluded files', async () => {
    mockSettings.exclusions = ['*.log']
    mockedReaddir.mockResolvedValue([
      mockDirEntry('app.log', false),
      mockDirEntry('data.db', false),
    ])
    mockedStat
      .mockResolvedValueOnce(mockFileStats(100, OLD))
      .mockResolvedValueOnce(mockFileStats(200, OLD))

    const result = await scanDirectory('C:\\data', 'system', 'data')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].path).toBe('C:\\data\\data.db')
  })

  it('skips inaccessible files', async () => {
    mockedReaddir.mockResolvedValue([mockDirEntry('secret.tmp', false)])
    mockedStat.mockRejectedValue(new Error('access denied'))

    const result = await scanDirectory('C:\\temp', 'system', 'temp')
    expect(result.items).toHaveLength(0)
  })

  it('returns empty result when readdir fails', async () => {
    mockedReaddir.mockRejectedValue(new Error('no such dir'))

    const result = await scanDirectory('C:\\gone', 'system', 'temp')
    expect(result.items).toHaveLength(0)
    expect(result.totalSize).toBe(0)
  })

  it('respects skipRecentMinutes cutoff', async () => {
    mockedReaddir.mockResolvedValue([
      mockDirEntry('recent.txt', false),
    ])
    mockedStat.mockResolvedValue(mockFileStats(50, Date.now()))

    const result = await scanDirectory('C:\\temp', 'system', 'temp', 60)
    expect(result.items).toHaveLength(0)
  })

  it('enforces MAX_ITEMS limit', async () => {
    const entries = Array.from({ length: 6000 }, (_, i) => mockDirEntry(`f${i}.txt`, false))
    mockedReaddir.mockResolvedValue(entries)
    mockedStat.mockResolvedValue(mockFileStats(10, OLD))

    const result = await scanDirectory('C:\\bulk', 'system', 'bulk')
    expect(result.items).toHaveLength(5000)
  })
})

// ─────────────────────────────────────────────
// scanMultipleDirectories
// ─────────────────────────────────────────────
describe('scanMultipleDirectories', () => {
  const OLD = Date.now() - 7_200_000

  it('merges results from multiple directories', async () => {
    mockedReaddir
      .mockResolvedValueOnce([mockDirEntry('a.log', false)])
      .mockResolvedValueOnce([mockDirEntry('b.log', false)])
    mockedStat
      .mockResolvedValueOnce(mockFileStats(100, OLD))
      .mockResolvedValueOnce(mockFileStats(200, OLD))

    const result = await scanMultipleDirectories(
      ['C:\\dir1', 'C:\\dir2'],
      'system', 'logs',
    )
    expect(result.items).toHaveLength(2)
    expect(result.totalSize).toBe(300)
  })
})

// ─────────────────────────────────────────────
// scanFile
// ─────────────────────────────────────────────
describe('scanFile', () => {
  it('returns a single-item ScanResult for a file', async () => {
    mockedStat.mockResolvedValue(mockFileStats(500))
    const result = await scanFile('C:\\file.txt', 'system', 'files')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].size).toBe(500)
    expect(result.totalSize).toBe(500)
  })

  it('returns empty when file is excluded', async () => {
    mockSettings.exclusions = ['*.txt']
    const result = await scanFile('C:\\file.txt', 'system', 'files')
    expect(result.items).toHaveLength(0)
  })

  it('returns empty when path is not a file', async () => {
    mockedStat.mockResolvedValue(mockDirStats())
    const result = await scanFile('C:\\dir', 'system', 'files')
    expect(result.items).toHaveLength(0)
  })

  it('returns empty when stat fails', async () => {
    mockedStat.mockRejectedValue(new Error('not found'))
    const result = await scanFile('C:\\gone.txt', 'system', 'files')
    expect(result.items).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// scanDirectoriesAsItems
// ─────────────────────────────────────────────
describe('scanDirectoriesAsItems', () => {
  it('scans directories as single items', async () => {
    mockedStat
      .mockResolvedValueOnce(mockDirStats())
      .mockResolvedValueOnce(mockFileStats(2048))
    mockedReaddir.mockResolvedValue([mockDirEntry('f.dat', false)])
    const result = await scanDirectoriesAsItems(['C:\\app'], 'system', 'cache')
    expect(result.items).toHaveLength(1)
    expect(result.items[0].size).toBeGreaterThan(1024)
  })

  it('skips excluded directories', async () => {
    mockSettings.exclusions = ['C:\\app']
    const result = await scanDirectoriesAsItems(['C:\\app'], 'system', 'cache')
    expect(result.items).toHaveLength(0)
  })

  it('skips non-directories', async () => {
    mockedStat.mockResolvedValue(mockFileStats(100))
    const result = await scanDirectoriesAsItems(['C:\\file.txt'], 'system', 'cache')
    expect(result.items).toHaveLength(0)
  })

  it('skips directories smaller than 1024 bytes', async () => {
    mockedStat.mockResolvedValue(mockDirStats())
    mockedReaddir.mockResolvedValue([])
    const result = await scanDirectoriesAsItems(['C:\\empty'], 'system', 'cache')
    expect(result.items).toHaveLength(0)
  })

  it('skips inaccessible directories', async () => {
    mockedStat.mockRejectedValue(new Error('access denied'))
    const result = await scanDirectoriesAsItems(['C:\\secret'], 'system', 'cache')
    expect(result.items).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────
// resolveChildSubdirs
// ─────────────────────────────────────────────
describe('resolveChildSubdirs', () => {
  it('returns original paths when no childSubdir', async () => {
    const result = await resolveChildSubdirs(['C:\\a', 'C:\\b'])
    expect(result).toEqual(['C:\\a', 'C:\\b'])
  })

  it('expands child subdirectories', async () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddir.mockResolvedValue([
      mockDirEntry('app1', true),
      mockDirEntry('app2', true),
      mockDirEntry('file.txt', false),
    ])
    const result = await resolveChildSubdirs(['C:\\apps'], 'cache')
    expect(result).toEqual(['C:\\apps\\app1\\cache', 'C:\\apps\\app2\\cache'])
  })

  it('skips base path that does not exist', async () => {
    mockedExistsSync.mockReturnValue(false)
    const result = await resolveChildSubdirs(['C:\\gone'], 'cache')
    expect(result).toEqual([])
  })

  it('skips children without the target subdir', async () => {
    mockedExistsSync.mockReturnValue(true)
    mockedReaddir.mockResolvedValue([mockDirEntry('app1', true)])
    mockedExistsSync.mockReturnValueOnce(true)
    mockedExistsSync.mockReturnValueOnce(false)

    const result = await resolveChildSubdirs(['C:\\apps'], 'cache')
    expect(result).toEqual([])
  })
})

// ─────────────────────────────────────────────
// secureOverwrite (tested indirectly via safeDelete)
// ─────────────────────────────────────────────
describe('secureOverwrite (via safeDelete)', () => {
  it('overwrites file with random data then zeros for directories', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockResolvedValue(mockDirStats())
    mockedReaddir.mockResolvedValue([mockDirEntry('child.dat', false)])
    const childStat = mockFileStats(50)
    mockedStat.mockResolvedValueOnce(mockDirStats())
    mockedStat.mockResolvedValueOnce(childStat)
    const mockFd = { write: vi.fn(), datasync: vi.fn(), close: vi.fn() }
    mockedOpen.mockResolvedValue(mockFd as any)
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\dir')
    expect(result.success).toBe(true)
    expect(mockedOpen).toHaveBeenCalledWith('C:\\dir\\child.dat', 'r+')
  })

  it('does not overwrite zero-size files', async () => {
    mockSettings.cleaner.secureDelete = true
    mockedStat.mockResolvedValue(mockFileStats(0))
    mockedRm.mockResolvedValue(undefined)

    const result = await safeDelete('C:\\empty.tmp')
    expect(result.success).toBe(true)
    expect(mockedOpen).not.toHaveBeenCalled()
  })
})
