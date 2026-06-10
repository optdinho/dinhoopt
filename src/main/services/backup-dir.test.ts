import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'os'

vi.mock('os', () => ({
  homedir: vi.fn(() => 'C:\\Users\\testuser'),
}))

vi.mock('./settings-store', () => ({
  getSettings: vi.fn(),
}))

import { getDefaultBackupDir, getBackupDir } from './backup-dir'
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
})
