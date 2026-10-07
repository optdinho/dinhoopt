import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = {
  getBackupDir: vi.fn(),
  resolveBackupPath: vi.fn(),
  execReg: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  error: vi.fn(),
  warning: vi.fn(),
}

vi.mock('node:fs', () => ({
  existsSync: (...a: unknown[]) => mocks.existsSync(...a),
  readdirSync: (...a: unknown[]) => mocks.readdirSync(...a),
  statSync: (...a: unknown[]) => mocks.statSync(...a),
}))

vi.mock('../backup-dir', () => ({
  getBackupDir: (...a: unknown[]) => mocks.getBackupDir(...a),
  resolveBackupPath: (...a: unknown[]) => mocks.resolveBackupPath(...a),
}))

vi.mock('../logger.service', () => ({
  getLogger: () => ({
    error: (...a: unknown[]) => mocks.error(...a),
    warning: (...a: unknown[]) => mocks.warning(...a),
  }),
}))

vi.mock('./utils', () => ({
  execReg: (...a: unknown[]) => mocks.execReg(...a),
}))

import { listRegistryBackups, restoreRegistryBackup } from './restore'

const BACKUP_DIR = 'C:\\backups'
const TS = '2026-10-06T10-00-00-000Z'
const BACKUP_FILES = [
  `registry-backup-targeted-${TS}.reg`,
  `registry-backup-2026-10-06T09-00-00-000Z.reg`,
  `registry-backup-HKCU-2026-10-06T11-00-00-000Z.reg`,
  `registry-backup-SYSTEM-2026-10-06T11-00-00-000Z.reg`,
  `registry-backup-HKCR-CLSID-2026-10-06T11-00-00-000Z.reg`,
  `registry-backup-HKCR-Interface-2026-10-06T11-00-00-000Z.reg`,
  `registry-backup-HKCR-MIME-2026-10-06T11-00-00-000Z.reg`,
  `registry-backup-HKCR-AllFileTypes-shellex-2026-10-06T08-00-00-000Z.reg`,
  `registry-backup-tasks-2026-10-06T12-00-00-000Z`,
  'not-a-backup.txt',
]

const TASKS_DIR = join(BACKUP_DIR, 'registry-backup-tasks-2026-10-06T12-00-00-000Z')
const dirContents = new Map<string, string[]>()
dirContents.set(BACKUP_DIR, BACKUP_FILES)
dirContents.set(TASKS_DIR, ['TaskA.xml'])

const stat = (p: string) => ({
  isDirectory: () => p === TASKS_DIR,
  size: 123,
})

describe('listRegistryBackups', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getBackupDir.mockReturnValue(BACKUP_DIR)
    mocks.readdirSync.mockImplementation((p: unknown) => {
      const entries = dirContents.get(String(p))
      if (!entries) throw new Error('ENOENT')
      return entries
    })
    mocks.statSync.mockImplementation((p: unknown) => stat(String(p)))
  })

  it('classifica e ordena por timestamp (mais recente primeiro)', () => {
    const items = listRegistryBackups()
    expect(items).toHaveLength(9)
    const kindOf = (name: string) => items.find((i) => i.name === name)?.kind
    expect(kindOf(`registry-backup-targeted-${TS}.reg`)).toBe('targeted')
    expect(kindOf('registry-backup-2026-10-06T09-00-00-000Z.reg')).toBe('full')
    expect(kindOf('registry-backup-HKCU-2026-10-06T11-00-00-000Z.reg')).toBe('hive')
    expect(kindOf('registry-backup-SYSTEM-2026-10-06T11-00-00-000Z.reg')).toBe('hive')
    expect(kindOf('registry-backup-HKCR-CLSID-2026-10-06T11-00-00-000Z.reg')).toBe('hive')
    expect(kindOf('registry-backup-HKCR-Interface-2026-10-06T11-00-00-000Z.reg')).toBe('hive')
    expect(kindOf('registry-backup-HKCR-MIME-2026-10-06T11-00-00-000Z.reg')).toBe('hive')
    expect(kindOf('registry-backup-HKCR-AllFileTypes-shellex-2026-10-06T08-00-00-000Z.reg')).toBe('shell')
    expect(kindOf('registry-backup-tasks-2026-10-06T12-00-00-000Z')).toBe('tasks')
    expect(items[0]!.name).toBe('registry-backup-tasks-2026-10-06T12-00-00-000Z')
    expect(items[items.length - 1]!.name).toBe('registry-backup-HKCR-AllFileTypes-shellex-2026-10-06T08-00-00-000Z.reg')
    expect(items.find((i) => i.name === 'not-a-backup.txt')).toBeUndefined()
  })

  it('ignora erros de leitura do diretório e devolve lista vazia', () => {
    mocks.readdirSync.mockImplementation(() => {
      throw new Error('Access denied')
    })
    expect(listRegistryBackups()).toEqual([])
  })

  it('o tamanho de um diretório de tasks soma o conteúdo', () => {
    const items = listRegistryBackups()
    const tasks = items.find((i) => i.kind === 'tasks')!
    expect(tasks.size).toBe(123)
  })
})

describe('restoreRegistryBackup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveBackupPath.mockImplementation((sub: unknown) => join(BACKUP_DIR, String(sub)))
    mocks.existsSync.mockReturnValue(true)
    mocks.statSync.mockImplementation((p: unknown) => stat(String(p)))
    mocks.execReg.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('executa reg import no caminho resolvido', async () => {
    const result = await restoreRegistryBackup(`registry-backup-targeted-${TS}.reg`)
    expect(result).toEqual({ ok: true })
    expect(mocks.execReg).toHaveBeenCalledWith(
      ['import', join(BACKUP_DIR, `registry-backup-targeted-${TS}.reg`)],
      expect.objectContaining({ timeout: 120000 }),
    )
  })

  it('devolve ok:false com o stderr do reg quando o import falha', async () => {
    mocks.execReg.mockRejectedValue({ stderr: 'Access is denied.\n' })
    const result = await restoreRegistryBackup(`registry-backup-targeted-${TS}.reg`)
    expect(result).toEqual({ ok: false, message: 'Access is denied.' })
  })

  it('bloqueia path traversal via resolveBackupPath', async () => {
    mocks.resolveBackupPath.mockImplementation(() => {
      throw new Error('Path traversal blocked: "..\\evil" resolves outside the backup directory')
    })
    const result = await restoreRegistryBackup('..\\evil')
    expect(result).toEqual({ ok: false, message: expect.stringContaining('traversal') })
    expect(mocks.execReg).not.toHaveBeenCalled()
  })

  it('devolve ok:false quando o backup não existe', async () => {
    mocks.existsSync.mockReturnValue(false)
    const result = await restoreRegistryBackup('registry-backup-missing.reg')
    expect(result.ok).toBe(false)
    expect(mocks.execReg).not.toHaveBeenCalled()
  })

  it('não restaura diretório de tasks (opcional, fora de âmbito)', async () => {
    const result = await restoreRegistryBackup('registry-backup-tasks-2026-10-06T12-00-00-000Z')
    expect(result.ok).toBe(false)
    expect(mocks.execReg).not.toHaveBeenCalled()
  })
})
