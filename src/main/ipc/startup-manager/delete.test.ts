import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFile = vi.fn()
const mockUnlinkSync = vi.fn()
const mockGetPath = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: (...args: string[]) => mockGetPath(...args) },
}))

vi.mock('../../services/exec-utf8', () => ({
  execNativeUtf8: (tool: string, args: string[], _opts?: unknown) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExecFile(tool, args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    }),
  execFileAsync: (cmd: string, args: string[], _opts?: unknown) =>
    new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExecFile(cmd, args, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    }),
  psArgs: (script: string) => ['-NoProfile', '-NonInteractive', '-Command', script],
}))

vi.mock('../../services/logger.service', () => ({
  getLogger: () => ({ info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }),
}))

vi.mock('../../platform', () => ({
  getPlatform: () => ({ startup: { deleteItem: vi.fn() } }),
}))

vi.mock('node:fs', () => ({
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}))

vi.mock('./disabled-file', () => ({
  withDisabledFileLock: async (fn: () => void) => fn(),
  readDisabledEntries: () => [],
  writeDisabledEntries: () => {},
}))

import { deleteStartupItem } from './delete'

const REG_LOCATION = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'

function rejectWith(err: Error) {
  mockExecFile.mockImplementation((_c: string, _a: string[], cb: (e: Error | null) => void) => cb(err))
}

function resolveAll() {
  mockExecFile.mockImplementation((_c: string, _a: string[], cb: (e: Error | null, s: string) => void) =>
    cb(null, 'ok'),
  )
}

describe('deleteStartupItem', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGetPath.mockReturnValue('C:\\Users\\test\\AppData\\Roaming')
    mockUnlinkSync.mockReturnValue(undefined)
  })

  it('registry: real failure (access denied) returns false', async () => {
    rejectWith(Object.assign(new Error('reg delete failed'), { code: 5, stderr: 'ERROR: Access is denied.' }))
    await expect(deleteStartupItem('MyApp', REG_LOCATION, 'registry-hkcu')).resolves.toBe(false)
  })

  it('registry: ERROR_FILE_NOT_FOUND counts as already deleted (success)', async () => {
    rejectWith(
      Object.assign(new Error('reg delete failed'), {
        code: 1,
        stderr: 'ERROR: The system cannot find the file specified.',
      }),
    )
    await expect(deleteStartupItem('MyApp', REG_LOCATION, 'registry-hkcu')).resolves.toBe(true)
  })

  it('registry: success sets true', async () => {
    resolveAll()
    await expect(deleteStartupItem('MyApp', REG_LOCATION, 'registry-hkcu')).resolves.toBe(true)
  })

  it('startup-folder: unlink success sets true', async () => {
    const startupDir = join(
      'C:\\Users\\test\\AppData\\Roaming',
      'Microsoft',
      'Windows',
      'Start Menu',
      'Programs',
      'Startup',
    )
    await expect(deleteStartupItem('MyApp.lnk', join(startupDir, 'MyApp.lnk'), 'startup-folder')).resolves.toBe(true)
  })

  it('task-scheduler: exec failure returns false', async () => {
    rejectWith(new Error('Unregister-ScheduledTask failed'))
    await expect(deleteStartupItem('My Task', 'path', 'task-scheduler')).resolves.toBe(false)
  })

  it('rejects locations outside the allowed registry roots', async () => {
    await expect(deleteStartupItem('MyApp', 'HKCU\\Software\\Other', 'registry-hkcu')).resolves.toBe(false)
  })
})
