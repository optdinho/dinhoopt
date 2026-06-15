import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockReaddirSync = vi.fn()
const mockCreateHash = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-dinho/cloud-backup'),
  },
}))

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  createReadStream: vi.fn(),
}))

vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
  },
  join: (...args: string[]) => args.join('/'),
}))

vi.mock('crypto', () => ({
  default: {
    createHash: () => mockCreateHash(),
  },
  createHash: () => mockCreateHash(),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    error: vi.fn(),
  }),
}))

import { CloudBackupService } from './cloud-backup.service'

describe('CloudBackupService', () => {
  let service: CloudBackupService

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    mockReaddirSync.mockReturnValue([])
    mockCreateHash.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      digest: vi.fn().mockReturnValue('abc123'),
    })
    service = new CloudBackupService()
  })

  it('constructor creates backup dir', () => {
    expect(mockMkdirSync).toHaveBeenCalledWith('/tmp/test-dinho/cloud-backup/quarantine-backup', { recursive: true })
  })

  it('backupFile stores file in backup directory', async () => {
    service.updateConfig({ enabled: true })
    const sourceContent = Buffer.from('test malware content')
    mockReadFileSync.mockReturnValue(sourceContent)
    mockWriteFileSync.mockImplementation(() => {})
    const now = 1234567890
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mockExistsSync.mockReturnValue(true)

    const result = await service.backupFile('/source/test.txt', 'test.txt')
    expect(result).toBe(true)
    expect(mockWriteFileSync).toHaveBeenCalledWith(
      `/tmp/test-dinho/cloud-backup/quarantine-backup/${String(now)}-test.txt`,
      sourceContent,
    )
  })

  it('backupFile stores metadata', async () => {
    service.updateConfig({ enabled: true })
    const sourceContent = Buffer.from('malware data')
    mockReadFileSync.mockReturnValue(sourceContent)
    mockWriteFileSync.mockImplementation(() => {})
    const now = 1234567890
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mockExistsSync.mockReturnValue(true)

    await service.backupFile('/source/test.exe', 'test.exe')
    const metaCall = mockWriteFileSync.mock.calls.find((c: unknown[]) => (c[0] as string).endsWith('.meta.json'))
    expect(metaCall).toBeDefined()
    if (metaCall) {
      const meta = JSON.parse(metaCall[1] as string)
      expect(meta.originalPath).toBe('/source/test.exe')
      expect(meta.backedUpAt).toBeDefined()
      expect(meta.size).toBe('malware data'.length)
      expect(meta.hash).toBe('abc123')
    }
  })

  it('backupAll backs up all .quarantined files', async () => {
    mockReaddirSync.mockReturnValue(['file1.exe.quarantined', 'file2.exe.quarantined', 'readme.txt'])
    mockReadFileSync.mockReturnValue(Buffer.from('data'))
    mockWriteFileSync.mockImplementation(() => {})
    const now = 1234567890
    vi.spyOn(Date, 'now').mockReturnValue(now)
    mockExistsSync.mockReturnValue(true)

    const result = await service.backupAll('/quarantine/dir')
    expect(result.success).toBe(true)
    expect(result.filesCount).toBe(2)
  })

  it('restoreBackup restores file to destination', async () => {
    const content = Buffer.from('backup data')
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(content)
    mockWriteFileSync.mockImplementation(() => {})

    const result = service.restoreBackup('backup-123.bak', '/restore/dest.exe')
    expect(result).toBe(true)
    expect(mockWriteFileSync).toHaveBeenCalledWith('/restore/dest.exe', content)
  })

  it('restoreBackup returns false for nonexistent backup', () => {
    mockExistsSync.mockReturnValue(false)
    const result = service.restoreBackup('nonexistent.bak', '/dest')
    expect(result).toBe(false)
  })

  it('getBackups returns sorted list', () => {
    mockExistsSync.mockReturnValue(true)
    mockReaddirSync.mockReturnValue(['100-file1.bak', '200-file2.bak'])
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith('.meta.json')) {
        return JSON.stringify({ backedUpAt: '2024-01-01T00:00:00.000Z' })
      }
      return 'content'
    })
    const list = service.getBackups()
    expect(list.length).toBe(2)
  })

  it('getStorageUsed returns total bytes', () => {
    mockExistsSync.mockReturnValue(true)
    mockReaddirSync.mockReturnValue(['file1.bak', 'file2.bak', 'file1.bak.meta.json'])
    mockReadFileSync.mockImplementation((path: string) => {
      if (path.endsWith('.json')) return '{}'
      return '0123456789'
    })
    const used = service.getStorageUsed()
    expect(used).toBe(20)
  })

  it('Disabled config skips backup', async () => {
    service.updateConfig({ enabled: false })
    const result = await service.backupFile('/source/test.txt', 'test.txt')
    expect(result).toBe(false)
  })

  it('updateConfig changes provider', () => {
    const config = service.updateConfig({ provider: 's3' })
    expect(config.provider).toBe('s3')
  })

  it('getConfig returns current config', () => {
    const config = service.getConfig()
    expect(config.provider).toBe('local')
    expect(config.enabled).toBe(false)
  })

  it('Edge case: empty quarantine directory', async () => {
    mockReaddirSync.mockReturnValue([])
    const result = await service.backupAll('/empty')
    expect(result.success).toBe(false)
    expect(result.filesCount).toBe(0)
  })

  it('Edge case: backupFile with already existing name', async () => {
    service.updateConfig({ enabled: true })
    mockReadFileSync.mockReturnValue(Buffer.from('content'))
    mockWriteFileSync.mockImplementation(() => {})
    mockExistsSync.mockReturnValue(true)
    const now = 1234567890
    vi.spyOn(Date, 'now').mockReturnValue(now)

    const result1 = await service.backupFile('/source/test.txt', 'test.txt')
    const result2 = await service.backupFile('/source2/test.txt', 'test.txt')
    expect(result1).toBe(true)
    expect(result2).toBe(true)
    expect(mockWriteFileSync).toHaveBeenCalledTimes(5)
  })
})
