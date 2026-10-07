import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  execReg: vi.fn(),
  execNativeUtf8: vi.fn(),
  warning: vi.fn(),
  writeFileSync: vi.fn(),
}

vi.mock('node:fs', () => ({
  mkdirSync: vi.fn(),
  mkdtempSync: vi.fn(() => 'C:\\temp\\dinho-reg-backup-test'),
  readdirSync: vi.fn(() => []),
  readFileSync: vi.fn(() => 'body'),
  rmSync: vi.fn(),
  unlinkSync: vi.fn(),
  writeFileSync: (...a: unknown[]) => mocks.writeFileSync(...a),
}))

vi.mock('../logger.service', () => ({
  getLogger: () => ({ warning: (...a: unknown[]) => mocks.warning(...a) }),
}))

vi.mock('../exec-utf8', () => ({
  execNativeUtf8: (...a: unknown[]) => mocks.execNativeUtf8(...a),
}))

vi.mock('./utils', () => ({
  execReg: (...a: unknown[]) => mocks.execReg(...a),
  splitTaskPath: () => null,
  stripRegHeader: () => '',
}))

import { createFullBackup, createTargetedBackup } from './backup'

describe('createFullBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execReg.mockResolvedValue({ stdout: '', stderr: '' })
    mocks.execNativeUtf8.mockResolvedValue({ stdout: '<xml/>', stderr: '' })
  })

  it('reports failure (returns false) when an export fails but still completes all 9', async () => {
    mocks.execReg.mockRejectedValueOnce(new Error('Access is denied'))
    await expect(createFullBackup('C:\\backups', 't1')).resolves.toBe(false)
    expect(mocks.execReg).toHaveBeenCalledTimes(9)
    expect(mocks.warning).toHaveBeenCalledWith('registry-backup', expect.stringContaining('HKLM\\SOFTWARE'))
  })

  it('returns true when every hive export succeeds', async () => {
    await expect(createFullBackup('C:\\backups', 't1')).resolves.toBe(true)
  })

  it('attempts every hive in order', async () => {
    await createFullBackup('C:\\backups', 't1')
    const hives = mocks.execReg.mock.calls.map((c) => c[0]![1]).filter((x: unknown) => typeof x === 'string')
    expect(hives).toEqual([
      'HKLM\\SOFTWARE',
      'HKCU\\SOFTWARE',
      'HKLM\\SYSTEM\\CurrentControlSet\\Services',
      'HKCR\\CLSID',
      'HKCR\\Interface',
      'HKCR\\MIME',
      'HKCR\\*\\shellex',
      'HKCR\\Directory\\shellex',
      'HKCR\\Folder\\shellex',
    ])
  })
})

describe('createTargetedBackup', () => {
  const entry = {
    id: 'e1',
    type: 'obsolete',
    issue: 'issue',
    keyPath: 'HKLM\\SOFTWARE\\Foo',
    valueName: 'V',
    risk: 'low',
    selected: true,
    fix: { op: 'delete-value' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.execReg.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('returns true when at least one key export succeeds', async () => {
    await expect(createTargetedBackup([entry as never], 'C:\\backups', 't1')).resolves.toBe(true)
    expect(mocks.writeFileSync).toHaveBeenCalled()
  })

  it('returns false when every key export fails (no consolidated backup written)', async () => {
    mocks.execReg.mockRejectedValue(new Error('Access is denied'))
    await expect(createTargetedBackup([entry as never], 'C:\\backups', 't1')).resolves.toBe(false)
    expect(mocks.writeFileSync).not.toHaveBeenCalled()
  })

  it('returns true when there are no targets', async () => {
    await expect(createTargetedBackup([], 'C:\\backups', 't1')).resolves.toBe(true)
  })
})
