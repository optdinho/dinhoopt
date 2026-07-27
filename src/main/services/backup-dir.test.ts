import { homedir } from 'node:os'
import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('os', () => ({
  homedir: vi.fn(() => 'C:\\Users\\testuser'),
}))

vi.mock('./settings-store', () => ({
  getSettings: vi.fn(),
}))

import { getBackupDir, getDefaultBackupDir, resolveBackupPath } from './backup-dir'
import { getSettings } from './settings-store'

const mockedGetSettings = vi.mocked(getSettings)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(homedir).mockReturnValue('C:\\Users\\testuser')
})

describe('getDefaultBackupDir', () => {
  it('returns Documents/DiNho Optimizer Backups under homedir', () => {
    const result = getDefaultBackupDir()
    expect(result).toBe('C:\\Users\\testuser\\Documents\\DiNho Optimizer Backups')
  })

  it('uses homedir from os module', () => {
    vi.mocked(homedir).mockReturnValue('C:\\Users\\other')
    expect(getDefaultBackupDir()).toBe('C:\\Users\\other\\Documents\\DiNho Optimizer Backups')
  })
})

describe('getBackupDir', () => {
  it('returns configured backupPath when valid and absolute', () => {
    mockedGetSettings.mockReturnValue({
      backupPath: 'D:\\MyBackups',
    } as any)
    expect(getBackupDir()).toBe('D:\\MyBackups')
  })

  it('returns default when backupPath is empty string', () => {
    mockedGetSettings.mockReturnValue({ backupPath: '' } as any)
    expect(getBackupDir()).toBe('C:\\Users\\testuser\\Documents\\DiNho Optimizer Backups')
  })

  it('returns default when backupPath is not a string', () => {
    mockedGetSettings.mockReturnValue({ backupPath: null } as any)
    expect(getBackupDir()).toBe('C:\\Users\\testuser\\Documents\\DiNho Optimizer Backups')
  })

  it('returns default when backupPath is not absolute', () => {
    mockedGetSettings.mockReturnValue({ backupPath: 'relative\\path' } as any)
    expect(getBackupDir()).toBe('C:\\Users\\testuser\\Documents\\DiNho Optimizer Backups')
  })

  it('returns default when backupPath is undefined', () => {
    mockedGetSettings.mockReturnValue({} as any)
    expect(getBackupDir()).toBe('C:\\Users\\testuser\\Documents\\DiNho Optimizer Backups')
  })

  it('calls getSettings once', () => {
    mockedGetSettings.mockReturnValue({ backupPath: 'C:\\custom' } as any)
    getBackupDir()
    expect(getSettings).toHaveBeenCalledTimes(1)
  })

  it('resolves relative segments in configured backupPath', () => {
    mockedGetSettings.mockReturnValue({
      backupPath: 'C:\\Users\\testuser\\Documents\\..\\..\\Windows\\System32',
    } as any)
    const result = getBackupDir()
    expect(result).toBe(path.resolve('C:\\Users\\testuser\\Documents\\..\\..\\Windows\\System32'))
    expect(result).not.toContain('..')
  })

  it('resolves dotted relative segments in configured backupPath', () => {
    mockedGetSettings.mockReturnValue({
      backupPath: 'C:\\Users\\.\\testuser\\.\\.\\Documents',
    } as any)
    const result = getBackupDir()
    expect(result).toBe(path.resolve('C:\\Users\\.\\testuser\\.\\.\\Documents'))
    expect(result).toBe('C:\\Users\\testuser\\Documents')
  })
})

describe('resolveBackupPath', () => {
  beforeEach(() => {
    mockedGetSettings.mockReturnValue({
      backupPath: 'C:\\BackupDir',
    } as any)
  })

  it('returns resolved path for a safe subpath', () => {
    expect(resolveBackupPath('config.json')).toBe('C:\\BackupDir\\config.json')
  })

  it('returns resolved path for a nested subpath', () => {
    expect(resolveBackupPath('subfolder\\file.txt')).toBe('C:\\BackupDir\\subfolder\\file.txt')
  })

  it('throws for path traversal with parent directory', () => {
    expect(() => resolveBackupPath('..\\..\\Windows\\System32\\evil.dll')).toThrow('Path traversal blocked')
  })

  it('throws for path traversal with absolute subpath', () => {
    expect(() => resolveBackupPath('D:\\Malicious\\file.exe')).toThrow('Path traversal blocked')
  })

  it('throws for path traversal with leading parent', () => {
    expect(() => resolveBackupPath('..\\secret.txt')).toThrow('Path traversal blocked')
  })

  it('uses current getBackupDir value on each call', () => {
    mockedGetSettings.mockReturnValue({
      backupPath: 'E:\\CustomBackup',
    } as any)
    expect(resolveBackupPath('safe.txt')).toBe('E:\\CustomBackup\\safe.txt')
  })
})
