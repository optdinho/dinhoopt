import { createHash, randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
    unlinkSync: vi.fn(),
  }
})

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/quarantine'), getAppPath: vi.fn(() => '/tmp/app') },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

vi.mock('./logger.service', () => ({
  getLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}))

vi.mock('./settings-store', () => ({
  addMalwareAllowlistEntry: vi.fn(),
  getMalwareAllowlist: vi.fn(() => []),
  getSettings: vi.fn(() => ({ exclusions: [] })),
}))

vi.mock('./yara-engine', () => ({
  createYaraEngine: vi.fn(),
  yaraMatchToThreatFields: vi.fn(),
}))

vi.mock('./yara-rules-store', () => ({
  getAllRulePaths: vi.fn(() => []),
  getCachedRulePaths: vi.fn(() => []),
  getRulesMetadata: vi.fn(() => null),
}))

vi.mock('./file-utils', () => ({
  isExcluded: vi.fn(() => false),
}))

vi.mock('./pe-parser', () => ({
  parsePeImports: vi.fn(() => []),
}))

vi.mock('@shared/utils/encoding', () => ({
  readTextFile: vi.fn(),
}))

vi.mock('@shared/channels', () => ({
  IPC: {},
}))

vi.mock('../platform', () => ({
  getPlatform: vi.fn(() => ({
    paths: { malwareSystemDirs: vi.fn(() => []), malwareScanDirs: vi.fn(() => []) },
    malware: { scannableExtensions: vi.fn(() => new Set()), shouldAnalyzePE: vi.fn(() => false) },
  })),
}))

// ─── Imports ───────────────────────────────────────────────

import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

import {
  appendQuarantineEntry,
  computeSha256,
  isThreatAllowlisted,
  moveFileToQuarantine,
  verifyQuarantinedFile,
} from './malware-scanner.service'
import type { AllowlistEntry, QuarantineEntry } from './malware-scanner.service'

// ─── Helpers ──────────────────────────────────────────────

const mockReadFileSync = vi.mocked(readFileSync)
const mockWriteFileSync = vi.mocked(writeFileSync)
const mockRenameSync = vi.mocked(renameSync)
const mockUnlinkSync = vi.mocked(unlinkSync)

const makeExdevError = (): NodeJS.ErrnoException => {
  const err = new Error('EXDEV: cross-device link not permitted') as NodeJS.ErrnoException
  err.code = 'EXDEV'
  return err
}

function hex(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

// ─── Tests ─────────────────────────────────────────────────

describe('moveFileToQuarantine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('same-volume = rename success', () => {
    mockRenameSync.mockReturnValue(undefined as unknown as undefined)

    const result = moveFileToQuarantine('C:\\src\\file.exe', 'C:\\quarantine')

    expect(result).toBe(true)
    expect(mockRenameSync).toHaveBeenCalledWith('C:\\src\\file.exe', 'C:\\quarantine\\file.exe.quarantined')
    expect(mockUnlinkSync).not.toHaveBeenCalled()
  })

  it('cross-volume = copy+delete success', () => {
    const content = Buffer.from('cross-volume file content')
    mockRenameSync.mockImplementation(() => {
      throw makeExdevError()
    })
    mockReadFileSync.mockReturnValueOnce(content)
    mockWriteFileSync.mockReturnValue(undefined as unknown as undefined)
    mockReadFileSync.mockReturnValueOnce(content)
    mockUnlinkSync.mockReturnValue(undefined as unknown as undefined)

    const result = moveFileToQuarantine('C:\\src\\file.exe', 'D:\\quarantine')

    expect(result).toBe(true)
    expect(mockReadFileSync).toHaveBeenCalledTimes(2)
    expect(mockReadFileSync).toHaveBeenNthCalledWith(1, 'C:\\src\\file.exe')
    expect(mockReadFileSync).toHaveBeenNthCalledWith(2, 'D:\\quarantine\\file.exe.quarantined')
    expect(mockWriteFileSync).toHaveBeenCalledWith('D:\\quarantine\\file.exe.quarantined', content)
    expect(mockUnlinkSync).toHaveBeenCalledWith('C:\\src\\file.exe')
  })

  it('cross-volume copy fails = returns false, cleans up partial copy', () => {
    const content = Buffer.from('content')
    mockRenameSync.mockImplementation(() => {
      throw makeExdevError()
    })
    mockReadFileSync.mockReturnValueOnce(content)
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('Disk full')
    })

    const result = moveFileToQuarantine('C:\\src\\file.exe', 'D:\\quarantine')

    expect(result).toBe(false)
    expect(mockUnlinkSync).toHaveBeenCalledWith('D:\\quarantine\\file.exe.quarantined')
  })

  it('verify mismatch = deletes bad copy', () => {
    const original = Buffer.from('original content')
    const corrupted = Buffer.from('corrupted content')
    mockRenameSync.mockImplementation(() => {
      throw makeExdevError()
    })
    mockReadFileSync.mockReturnValueOnce(original) // source read
    mockWriteFileSync.mockReturnValue(undefined as unknown as undefined)
    mockReadFileSync.mockReturnValueOnce(corrupted) // verify read = mismatch

    const result = moveFileToQuarantine('C:\\src\\file.exe', 'D:\\quarantine')

    expect(result).toBe(false)
    expect(mockUnlinkSync).toHaveBeenCalledWith('D:\\quarantine\\file.exe.quarantined')
  })

  it('returns false on non-EXDEV error from renameSync', () => {
    mockRenameSync.mockImplementation(() => {
      throw new Error('EPERM: operation not permitted')
    })

    const result = moveFileToQuarantine('C:\\src\\file.exe', 'D:\\quarantine')

    expect(result).toBe(false)
  })
})

describe('computeSha256', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('produces correct hash', () => {
    const content = Buffer.from('hello world')
    mockReadFileSync.mockReturnValue(content)

    const hash = computeSha256('/path/to/file.bin')

    expect(hash).toBe(hex(content))
    expect(mockReadFileSync).toHaveBeenCalledWith('/path/to/file.bin')
  })

  it('empty file produces correct hash', () => {
    const content = Buffer.alloc(0)
    mockReadFileSync.mockReturnValue(content)

    const hash = computeSha256('/path/to/empty.bin')

    expect(hash).toBe(hex(content))
    expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })

  it('binary content produces consistent hash', () => {
    const content = Buffer.from([0x00, 0xff, 0xab, 0xcd, 0x12, 0x34])
    mockReadFileSync.mockReturnValue(content)

    const hash = computeSha256('/path/to/binary.bin')

    expect(hash).toBe(hex(content))
  })
})

describe('verifyQuarantinedFile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('matching hash = true', () => {
    const content = Buffer.from('verify me')
    mockReadFileSync.mockReturnValue(content)

    const result = verifyQuarantinedFile('/quarantine/file.exe.quarantined', hex(content))

    expect(result).toBe(true)
  })

  it('mismatched hash = false', () => {
    mockReadFileSync.mockReturnValue(Buffer.from('actual content'))

    const result = verifyQuarantinedFile('/quarantine/file.exe.quarantined', hex(Buffer.from('expected content')))

    expect(result).toBe(false)
  })

  it('missing file = false', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file')
    })

    const result = verifyQuarantinedFile('/quarantine/nonexistent.quarantined', 'abc123')

    expect(result).toBe(false)
  })
})

describe('appendQuarantineEntry', () => {
  const manifestPath = '/quarantine/quarantine-manifest.json'

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates manifest if not exists', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT: no such file')
    })
    mockWriteFileSync.mockReturnValue(undefined as unknown as undefined)
    mockRenameSync.mockReturnValue(undefined as unknown as undefined)

    const entry: QuarantineEntry = {
      originalPath: 'C:\\src\\malware.exe',
      quarantinePath: '/quarantine/123_malware.exe.quarantined',
      timestamp: '1700000000000',
      sha256: 'abc123hash',
      fileSize: 1024,
    }
    appendQuarantineEntry(entry, manifestPath)

    expect(mockWriteFileSync).toHaveBeenCalledWith(`${manifestPath}.tmp`, JSON.stringify([entry], null, 2))
    expect(mockRenameSync).toHaveBeenCalledWith(`${manifestPath}.tmp`, manifestPath)
  })

  it('appends to existing manifest', () => {
    const existing: QuarantineEntry[] = [
      {
        originalPath: 'C:\\src\\old.exe',
        quarantinePath: '/quarantine/old.exe.quarantined',
        timestamp: '1690000000000',
        sha256: 'oldhash',
        fileSize: 512,
      },
    ]
    mockReadFileSync.mockReturnValue(JSON.stringify(existing))
    mockWriteFileSync.mockReturnValue(undefined as unknown as undefined)
    mockRenameSync.mockReturnValue(undefined as unknown as undefined)

    const entry: QuarantineEntry = {
      originalPath: 'C:\\src\\malware.exe',
      quarantinePath: '/quarantine/123_malware.exe.quarantined',
      timestamp: '1700000000000',
      sha256: 'abc123hash',
      fileSize: 1024,
    }
    appendQuarantineEntry(entry, manifestPath)

    const expected = [...existing, entry]
    expect(mockWriteFileSync).toHaveBeenCalledWith(`${manifestPath}.tmp`, JSON.stringify(expected, null, 2))
    expect(mockRenameSync).toHaveBeenCalledWith(`${manifestPath}.tmp`, manifestPath)
  })

  it('atomic write preserves data on crash', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    mockWriteFileSync.mockReturnValue(undefined as unknown as undefined)
    mockRenameSync.mockReturnValue(undefined as unknown as undefined)

    const entry: QuarantineEntry = {
      originalPath: 'C:\\src\\safe.exe',
      quarantinePath: '/quarantine/456_safe.exe.quarantined',
      timestamp: '1710000000000',
      sha256: 'def456hash',
      fileSize: 2048,
    }
    appendQuarantineEntry(entry, manifestPath)

    // Verify write goes to .tmp first, then rename to final
    expect(mockWriteFileSync).toHaveBeenCalledWith(`${manifestPath}.tmp`, expect.any(String))
    expect(mockRenameSync).toHaveBeenCalledWith(`${manifestPath}.tmp`, manifestPath)
    // If rename never called, .tmp is orphaned, original manifest (if exists) is safe
  })

  it('malformed existing manifest is overwritten', () => {
    mockReadFileSync.mockReturnValue('{invalid json!!!')
    mockWriteFileSync.mockReturnValue(undefined as unknown as undefined)
    mockRenameSync.mockReturnValue(undefined as unknown as undefined)

    const entry: QuarantineEntry = {
      originalPath: 'C:\\src\\fixed.exe',
      quarantinePath: '/quarantine/789_fixed.exe.quarantined',
      timestamp: '1720000000000',
      sha256: 'ghi789hash',
      fileSize: 4096,
    }
    appendQuarantineEntry(entry, manifestPath)

    // Should start fresh (only the new entry)
    expect(mockWriteFileSync).toHaveBeenCalledWith(`${manifestPath}.tmp`, JSON.stringify([entry], null, 2))
  })
})

describe('isThreatAllowlisted', () => {
  const baseThreat = {
    sha256: undefined as string | undefined,
    filePath: 'C:\\Users\\test\\virus.exe',
    name: 'Heuristic.Suspicious.PE',
  }

  it('sha256 match = true', () => {
    const allowlist: AllowlistEntry[] = [
      { type: 'sha256', value: 'abc123def456', addedAt: '1', description: 'known good' },
    ]
    expect(isThreatAllowlisted({ ...baseThreat, sha256: 'abc123def456' }, allowlist)).toBe(true)
  })

  it('path match = true', () => {
    const allowlist: AllowlistEntry[] = [{ type: 'path', value: 'c:\\users\\test\\virus.exe', addedAt: '1' }]
    expect(isThreatAllowlisted(baseThreat, allowlist)).toBe(true)
  })

  it('filename match = true', () => {
    const allowlist: AllowlistEntry[] = [{ type: 'filename', value: 'virus.exe', addedAt: '1' }]
    expect(isThreatAllowlisted(baseThreat, allowlist)).toBe(true)
  })

  it('name match = true', () => {
    const allowlist: AllowlistEntry[] = [{ type: 'name', value: 'heuristic.suspicious.pe', addedAt: '1' }]
    expect(isThreatAllowlisted(baseThreat, allowlist)).toBe(true)
  })

  it('no match = false', () => {
    const allowlist: AllowlistEntry[] = [
      { type: 'sha256', value: 'nomatch', addedAt: '1' },
      { type: 'path', value: 'c:\\other\\path.exe', addedAt: '1' },
      { type: 'filename', value: 'other.exe', addedAt: '1' },
      { type: 'name', value: 'other.name', addedAt: '1' },
    ]
    expect(isThreatAllowlisted(baseThreat, allowlist)).toBe(false)
  })

  it('case insensitive on Windows', () => {
    const allowlist: AllowlistEntry[] = [{ type: 'path', value: 'C:\\USERS\\TEST\\VIRUS.EXE', addedAt: '1' }]
    expect(isThreatAllowlisted(baseThreat, allowlist)).toBe(true)
  })

  it('multiple entries, one matches = true', () => {
    const allowlist: AllowlistEntry[] = [
      { type: 'sha256', value: 'nope', addedAt: '1' },
      { type: 'filename', value: 'virus.exe', addedAt: '1' },
      { type: 'name', value: 'nope2', addedAt: '1' },
    ]
    expect(isThreatAllowlisted(baseThreat, allowlist)).toBe(true)
  })

  it('empty allowlist = false', () => {
    expect(isThreatAllowlisted(baseThreat, [])).toBe(false)
  })

  it('undefined sha256 = does not crash', () => {
    const allowlist: AllowlistEntry[] = [{ type: 'sha256', value: 'abc', addedAt: '1' }]
    expect(isThreatAllowlisted(baseThreat, allowlist)).toBe(false)
  })
})
