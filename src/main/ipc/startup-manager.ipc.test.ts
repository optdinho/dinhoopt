import { createHash } from 'node:crypto'
// ── Mock child_process ──────────────────────────────────────────────
// The real execFile has a util.promisify.custom symbol so that
// promisify(execFile) returns { stdout, stderr }. We must replicate this
// because without it, promisify resolves with only the first callback arg.
import { promisify } from 'node:util'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// ── Mock window ─────────────────────────────────────────────────────
// A real window id (matching the mocked BrowserWindow.fromWebContents) so
// that validateSender accepts the handlers instead of short-circuiting them.
const mockGetWindow = vi.fn(() => ({ id: 1 })) as unknown as WindowGetter
const mockExecFile = vi.fn()

// ── Mock logger ─────────────────────────────────────────────
const mockLogger = { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() }

// Build an execFile mock that has the custom promisify symbol so that
// `promisify(execFile)` returns { stdout, stderr } like the real one.
function createExecFileMock() {
  const fn = (...args: unknown[]) => mockExecFile(...args)
  // Custom promisify: returns a function that calls the mock and wraps
  // the callback result into { stdout, stderr }
  ;(fn as any)[promisify.custom] = (cmd: string, args: string[], opts?: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExecFile(cmd, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  }
  return fn
}

vi.mock('child_process', () => ({
  execFile: createExecFileMock(),
}))

vi.mock('../services/exec-utf8', () => ({
  execNativeUtf8: (tool: string, args: string[], opts?: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExecFile(tool, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  },
  execFileAsync: (cmd: string, args: string[], opts?: any) => {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      mockExecFile(cmd, args, opts, (err: Error | null, stdout: string, stderr: string) => {
        if (err) reject(err)
        else resolve({ stdout, stderr })
      })
    })
  },
  psUtf8: (cmd: string) => cmd,
  psArgs: (script: string) => ['-NoProfile', '-NonInteractive', '-Command', script],
}))
vi.mock('../services/logger.service', () => ({ getLogger: () => mockLogger }))

// ── Mock fs ─────────────────────────────────────────────────────────
const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()
const mockReaddirSync = vi.fn()
const mockUnlinkSync = vi.fn()
const mockRenameSync = vi.fn()
vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
  readdirSync: (...args: unknown[]) => mockReaddirSync(...args),
  renameSync: (...args: unknown[]) => mockRenameSync(...args),
  unlinkSync: (...args: unknown[]) => mockUnlinkSync(...args),
}))

// ── Mock electron ───────────────────────────────────────────────────
const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()
vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: (name: string) => {
      if (name === 'userData') return 'C:\\Users\\Test\\AppData\\Roaming\\Kudu'
      if (name === 'appData') return 'C:\\Users\\Test\\AppData\\Roaming'
      return 'C:\\mock'
    },
  },
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
    },
  },
  BrowserWindow: {
    fromWebContents: vi.fn().mockReturnValue({ id: 1, isDestroyed: () => false }),
    getAllWindows: vi.fn().mockReturnValue([]),
  },
}))

// ── Mock platform ───────────────────────────────────────────────────
vi.mock('../platform', () => ({
  getPlatform: () => ({
    startup: {
      listItems: vi.fn().mockResolvedValue([]),
      toggleItem: vi.fn().mockResolvedValue(true),
      deleteItem: vi.fn().mockResolvedValue(true),
      getBootTrace: vi.fn().mockResolvedValue(null),
    },
  }),
}))

// ── Import under test (after mocks) ────────────────────────────────
import type { WindowGetter } from './index'
import {
  deleteStartupItem,
  getBootTrace,
  listStartupItems,
  registerStartupManagerIpc,
  toggleStartupItem,
} from './startup-manager.ipc'

// ── Helpers ─────────────────────────────────────────────────────────

const HKCU_RUN = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
const HKLM_RUN = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'
const HKLM_WOW64_RUN = 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'

const originalPlatform = process.platform

function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, writable: true })
}

/**
 * Helper: sets up mockExecFile so that promisify(execFile) works.
 * `handler` receives (cmd, args, opts) and should return { stdout } or throw.
 */
function setupExecFileHandler(handler: (cmd: string, args: string[], opts: any) => { stdout: string }) {
  mockExecFile.mockImplementation((cmd: string, args: string[], opts: any, cb: (...args: unknown[]) => unknown) => {
    try {
      const result = handler(cmd, args, opts)
      cb(null, result.stdout, '')
    } catch (err) {
      cb(err, '', '')
    }
  })
}

/** Build a reg query output that parseRegOutput can parse */
function regOutput(entries: Array<{ name: string; command: string }>): string {
  const lines = ['', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', '']
  for (const e of entries) {
    lines.push(`    ${e.name}    REG_SZ    ${e.command}`)
  }
  lines.push('')
  return lines.join('\n')
}

/** Build a StartupApproved reg query output with REG_BINARY */
function approvedOutput(entries: Array<{ name: string; hex: string }>): string {
  const lines = ['', 'HKCU\\...\\StartupApproved\\Run', '']
  for (const e of entries) {
    lines.push(`    ${e.name}    REG_BINARY    ${e.hex}`)
  }
  lines.push('')
  return lines.join('\n')
}

function makeStableId(name: string, source: string): string {
  return createHash('sha256').update(`${name}::${source}`).digest('hex').slice(0, 16)
}

/** Collect all reg calls made during a test */
function collectRegCalls(): Array<{ cmd: string; args: string[] }> {
  const calls: Array<{ cmd: string; args: string[] }> = []
  mockExecFile.mockImplementation((cmd: string, args: string[], _opts: any, cb: (...args: unknown[]) => unknown) => {
    calls.push({ cmd, args })
    cb(null, '', '')
  })
  return calls
}

// ─────────────────────────────────────────────────────────────────────
// Setup / Teardown
// ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks()
  mockHandlers.clear()
  setPlatform('win32')
  // Default: disabled-startups.json doesn't exist
  mockExistsSync.mockReturnValue(false)
  mockReadFileSync.mockReturnValue('[]')
  mockReaddirSync.mockReturnValue([])
  // Default: no lingering implementations from previous tests
  mockWriteFileSync.mockReset()
  mockRenameSync.mockReset()
  mockUnlinkSync.mockReset()
  // Default: all execFile calls fail (registry keys don't exist)
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: (...args: unknown[]) => unknown) => {
    cb(new Error('not found'), '', '')
  })
})

afterAll(() => {
  setPlatform(originalPlatform)
})

// =====================================================================
// listStartupItems — integration tests with mocked system calls
// =====================================================================

describe('listStartupItems', () => {
  it('returns items from HKCU registry', async () => {
    setupExecFileHandler((cmd, args) => {
      if (cmd === 'reg' && args[0] === 'query' && args[1] === HKCU_RUN) {
        return {
          stdout: regOutput([
            {
              name: 'Discord',
              command: '"C:\\Users\\User\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe',
            },
            { name: 'Spotify', command: '"C:\\Users\\User\\AppData\\Roaming\\Spotify\\Spotify.exe" /minimized' },
          ]),
        }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    expect(items.length).toBe(2)
    expect(items[0]!.name).toBe('Discord')
    expect(items[0]!.source).toBe('registry-hkcu')
    expect(items[0]!.enabled).toBe(true)
    expect(items[0]!.publisher).toBe('Discord Inc.')
    expect(items[0]!.id).toBe(makeStableId('Discord', 'registry-hkcu'))
    expect(items[1]!.name).toBe('Spotify')
  })

  it('returns items from HKLM and WOW6432Node registries', async () => {
    setupExecFileHandler((cmd, args) => {
      if (cmd === 'reg' && args[1] === HKLM_RUN) {
        return {
          stdout: regOutput([
            { name: 'SecurityHealth', command: '"C:\\Windows\\System32\\SecurityHealthSystray.exe"' },
          ]),
        }
      }
      if (cmd === 'reg' && args[1] === HKLM_WOW64_RUN) {
        return { stdout: regOutput([{ name: 'Steam', command: '"C:\\Steam\\Steam.exe" -silent' }]) }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    expect(items.some((i) => i.name === 'SecurityHealth' && i.source === 'registry-hklm')).toBe(true)
    expect(items.some((i) => i.name === 'Steam' && i.source === 'registry-hklm')).toBe(true)
  })

  it('reads startup folder items and filters desktop.ini', async () => {
    // The startup folder path is constructed with join() which uses OS separators.
    // We mock existsSync to return true for any path containing 'Startup'.
    mockExistsSync.mockImplementation((p: string) => (p as string).includes('Startup'))
    mockReaddirSync.mockReturnValue(['MyApp.lnk', 'desktop.ini'])

    const items = await listStartupItems()
    // desktop.ini should be filtered out
    expect(items.some((i) => i.name === 'MyApp.lnk' && i.source === 'startup-folder')).toBe(true)
    expect(items.some((i) => i.name === 'desktop.ini')).toBe(false)
    // Verify the startup folder item has correct structure
    const myApp = items.find((i) => i.name === 'MyApp.lnk')!
    expect(myApp.displayName).toBe('MyApp')
    expect(myApp.enabled).toBe(true)
  })

  it('merges StartupApproved disabled state', async () => {
    const approvedKey = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
    setupExecFileHandler((cmd, args) => {
      if (cmd === 'reg' && args[1] === HKCU_RUN) {
        return { stdout: regOutput([{ name: 'Discord', command: '"C:\\Discord\\Discord.exe"' }]) }
      }
      if (cmd === 'reg' && args[1] === approvedKey) {
        return { stdout: approvedOutput([{ name: 'Discord', hex: '03000000000000000000000' }]) }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    const discord = items.find((i) => i.name === 'Discord')
    expect(discord).toBeDefined()
    expect(discord!.enabled).toBe(false)
  })

  it('merges scheduled logon tasks', async () => {
    setupExecFileHandler((cmd) => {
      if (cmd === 'powershell') {
        return { stdout: 'TASK|SpotifyStartup|C:\\Spotify\\Spotify.exe|Ready\n' }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    const spotify = items.find((i) => i.name === 'SpotifyStartup')
    expect(spotify).toBeDefined()
    expect(spotify!.source).toBe('task-scheduler')
    expect(spotify!.enabled).toBe(true)
  })

  it('marks scheduled tasks with non-Ready state as disabled', async () => {
    setupExecFileHandler((cmd) => {
      if (cmd === 'powershell') {
        return { stdout: 'TASK|ZoomTask|C:\\Zoom\\Zoom.exe|Disabled\n' }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    const zoom = items.find((i) => i.name === 'ZoomTask')
    expect(zoom).toBeDefined()
    expect(zoom!.enabled).toBe(false)
  })

  it('does not duplicate items already found in registry when also in task scheduler', async () => {
    setupExecFileHandler((cmd, args) => {
      if (cmd === 'reg' && args[1] === HKCU_RUN) {
        return { stdout: regOutput([{ name: 'Discord', command: '"C:\\Discord\\Discord.exe"' }]) }
      }
      if (cmd === 'powershell') {
        return { stdout: 'TASK|Discord|C:\\Discord\\Discord.exe|Ready\n' }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    const discordItems = items.filter((i) => i.name === 'Discord')
    expect(discordItems.length).toBe(1)
  })

  it('merges disabled entries from JSON file', async () => {
    const disabledEntries = [
      { name: 'OldApp', command: '"C:\\OldApp\\app.exe"', location: HKCU_RUN, source: 'registry-hkcu' as const },
    ]
    mockExistsSync.mockImplementation((p: string) => (p as string).endsWith('disabled-startups.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(disabledEntries))

    const items = await listStartupItems()
    const oldApp = items.find((i) => i.name === 'OldApp')
    expect(oldApp).toBeDefined()
    expect(oldApp!.enabled).toBe(false)
    expect(oldApp!.source).toBe('registry-hkcu')
  })

  it('marks existing items as disabled when found in disabled file', async () => {
    const disabledEntries = [
      { name: 'Discord', command: '"C:\\Discord\\Discord.exe"', location: HKCU_RUN, source: 'registry-hkcu' as const },
    ]
    mockExistsSync.mockImplementation((p: string) => (p as string).endsWith('disabled-startups.json'))
    mockReadFileSync.mockReturnValue(JSON.stringify(disabledEntries))
    setupExecFileHandler((cmd, args) => {
      if (cmd === 'reg' && args[1] === HKCU_RUN) {
        return { stdout: regOutput([{ name: 'Discord', command: '"C:\\Discord\\Discord.exe"' }]) }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    const discord = items.find((i) => i.name === 'Discord')
    expect(discord).toBeDefined()
    expect(discord!.enabled).toBe(false)
  })

  it('handles corrupt disabled-startups.json gracefully', async () => {
    mockExistsSync.mockImplementation((p: string) => (p as string).endsWith('disabled-startups.json'))
    mockReadFileSync.mockReturnValue('not valid json{{{')

    const items = await listStartupItems()
    expect(Array.isArray(items)).toBe(true)
  })

  it('continues when all registry queries fail', async () => {
    // Default mock already fails all execFile calls
    const items = await listStartupItems()
    expect(Array.isArray(items)).toBe(true)
    expect(items.length).toBe(0)
  })

  it('delegates to platform abstraction on non-Windows', async () => {
    setPlatform('darwin')
    const items = await listStartupItems()
    expect(Array.isArray(items)).toBe(true)
    setPlatform('win32')
  })
})

// =====================================================================
// toggleStartupItem
// =====================================================================

describe('toggleStartupItem', () => {
  describe('disabling a registry item', () => {
    it('writes disabled marker to StartupApproved, deletes Run key, and persists to file', async () => {
      const regCalls = collectRegCalls()

      const result = await toggleStartupItem('Discord', HKCU_RUN, '"C:\\Discord.exe"', 'registry-hkcu', false)
      expect(result).toBe(true)

      // Should have called reg add for StartupApproved with 03 (disabled)
      const addCall = regCalls.find((c) => c.args[0] === 'add' && c.args.includes('REG_BINARY'))
      expect(addCall).toBeDefined()
      expect(addCall!.args).toContain('030000000000000000000000')

      // Should have called reg delete on the Run key
      const deleteCall = regCalls.find((c) => c.args[0] === 'delete' && c.args[1] === HKCU_RUN)
      expect(deleteCall).toBeDefined()

      // Should have written to disabled file
      expect(mockWriteFileSync).toHaveBeenCalled()
    })

    it('does not duplicate entries in disabled file', async () => {
      const existing = [{ name: 'Discord', command: '"C:\\Discord.exe"', location: HKCU_RUN, source: 'registry-hkcu' }]
      mockExistsSync.mockImplementation((p: string) => (p as string).endsWith('disabled-startups.json'))
      mockReadFileSync.mockReturnValue(JSON.stringify(existing))
      collectRegCalls() // sets up mock to succeed

      await toggleStartupItem('Discord', HKCU_RUN, '"C:\\Discord.exe"', 'registry-hkcu', false)

      const lastWriteCall = mockWriteFileSync.mock.calls[mockWriteFileSync.mock.calls.length - 1]!
      const writtenData = JSON.parse(lastWriteCall[1] as string)
      const discordEntries = writtenData.filter((e: any) => e.name === 'Discord')
      expect(discordEntries.length).toBe(1)
    })

    it('logs a warning when reading the registry raises an exception', async () => {
      mockLogger.warning.mockReset()
      // beforeEach defaults every execFile call to fail, so all registry reads throw
      const entries = await listStartupItems()
      expect(entries).toEqual([])
      expect(mockLogger.warning).toHaveBeenCalledWith('startup-manager', expect.stringContaining('registry'))
    })
  })

  describe('enabling a registry item', () => {
    it('uses stored command from disabled file, not renderer-supplied command', async () => {
      const storedCommand = '"C:\\SafePath\\Discord.exe"'
      const existing = [{ name: 'Discord', command: storedCommand, location: HKCU_RUN, source: 'registry-hkcu' }]
      mockExistsSync.mockImplementation((p: string) => (p as string).endsWith('disabled-startups.json'))
      mockReadFileSync.mockReturnValue(JSON.stringify(existing))

      const regCalls = collectRegCalls()

      const rendererCommand = '"C:\\Malicious\\evil.exe"'
      const result = await toggleStartupItem('Discord', HKCU_RUN, rendererCommand, 'registry-hkcu', true)
      expect(result).toBe(true)

      // The reg add call for REG_SZ should use the stored command
      const addCall = regCalls.find((c) => c.args[0] === 'add' && c.args.includes('REG_SZ'))
      expect(addCall).toBeDefined()
      expect(addCall!.args).toContain(storedCommand)
      expect(addCall!.args).not.toContain(rendererCommand)
    })

    it('enables via StartupApproved when no stored entry exists (Task Manager disabled items)', async () => {
      const regCalls = collectRegCalls()
      const result = await toggleStartupItem('EvilApp', HKCU_RUN, '"C:\\evil.exe"', 'registry-hkcu', true)
      expect(result).toBe(true)
      // Should write 02 marker to StartupApproved, NOT REG_SZ to Run key
      const approvedCall = regCalls.find((c) => c.args[0] === 'add' && c.args.includes('REG_BINARY'))
      expect(approvedCall).toBeDefined()
      expect(approvedCall!.args).toContain('020000000000000000000000')
      const runAddCall = regCalls.find((c) => c.args[0] === 'add' && c.args.includes('REG_SZ'))
      expect(runAddCall).toBeUndefined()
    })

    it('writes enabled marker (02) to StartupApproved', async () => {
      const existing = [{ name: 'Discord', command: '"C:\\Discord.exe"', location: HKCU_RUN, source: 'registry-hkcu' }]
      mockExistsSync.mockImplementation((p: string) => (p as string).endsWith('disabled-startups.json'))
      mockReadFileSync.mockReturnValue(JSON.stringify(existing))

      const regCalls = collectRegCalls()

      await toggleStartupItem('Discord', HKCU_RUN, '', 'registry-hkcu', true)

      const approvedCall = regCalls.find((c) => c.args[0] === 'add' && c.args.includes('REG_BINARY'))
      expect(approvedCall).toBeDefined()
      expect(approvedCall!.args).toContain('020000000000000000000000')
    })

    it('removes entry from disabled file after enabling', async () => {
      const existing = [
        { name: 'Discord', command: '"C:\\Discord.exe"', location: HKCU_RUN, source: 'registry-hkcu' },
        { name: 'Steam', command: '"C:\\Steam.exe"', location: HKCU_RUN, source: 'registry-hkcu' },
      ]
      mockExistsSync.mockImplementation((p: string) => (p as string).endsWith('disabled-startups.json'))
      mockReadFileSync.mockReturnValue(JSON.stringify(existing))
      collectRegCalls()

      await toggleStartupItem('Discord', HKCU_RUN, '', 'registry-hkcu', true)

      const lastWriteCall = mockWriteFileSync.mock.calls[mockWriteFileSync.mock.calls.length - 1]!
      const writtenData = JSON.parse(lastWriteCall[1] as string)
      expect(writtenData.length).toBe(1)
      expect(writtenData[0]!.name).toBe('Steam')
    })
  })

  describe('task scheduler items', () => {
    it('enables a scheduled task via PowerShell', async () => {
      const regCalls = collectRegCalls()

      const result = await toggleStartupItem('SpotifyStartup', 'Task Scheduler', '', 'task-scheduler', true)
      expect(result).toBe(true)
      const psCall = regCalls.find((c) => c.cmd === 'powershell')
      expect(psCall).toBeDefined()
      expect(psCall!.args.join(' ')).toContain('Enable-ScheduledTask')
      expect(psCall!.args.join(' ')).toContain('SpotifyStartup')
    })

    it('disables a scheduled task via PowerShell', async () => {
      const regCalls = collectRegCalls()

      const result = await toggleStartupItem('SpotifyStartup', 'Task Scheduler', '', 'task-scheduler', false)
      expect(result).toBe(true)
      const psCall = regCalls.find((c) => c.cmd === 'powershell')
      expect(psCall!.args.join(' ')).toContain('Disable-ScheduledTask')
    })

    it('returns false for unsafe task names', async () => {
      const result = await toggleStartupItem("evil'; rm -rf /", 'Task Scheduler', '', 'task-scheduler', false)
      expect(result).toBe(false)
      expect(mockExecFile).not.toHaveBeenCalled()
    })

    it('returns false when PowerShell command fails', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: (...args: unknown[]) => unknown) => {
          cb(new Error('Access denied'), '', '')
        },
      )

      const result = await toggleStartupItem('SpotifyStartup', 'Task Scheduler', '', 'task-scheduler', true)
      expect(result).toBe(false)
    })
  })

  describe('input validation', () => {
    it('rejects disallowed registry locations', async () => {
      const result = await toggleStartupItem('Evil', 'HKLM\\SOFTWARE\\Evil\\Path', 'cmd.exe', 'registry-hklm', false)
      expect(result).toBe(false)
    })

    it('accepts HKCU Run location', async () => {
      collectRegCalls()
      const result = await toggleStartupItem('App', HKCU_RUN, '"C:\\app.exe"', 'registry-hkcu', false)
      expect(result).toBe(true)
    })

    it('accepts HKLM Run location', async () => {
      collectRegCalls()
      const result = await toggleStartupItem('App', HKLM_RUN, '"C:\\app.exe"', 'registry-hklm', false)
      expect(result).toBe(true)
    })

    it('accepts HKLM WOW6432Node location', async () => {
      collectRegCalls()
      const result = await toggleStartupItem('App', HKLM_WOW64_RUN, '"C:\\app.exe"', 'registry-hklm', false)
      expect(result).toBe(true)
    })
  })

  it('delegates to platform abstraction on non-Windows', async () => {
    setPlatform('darwin')
    const result = await toggleStartupItem('App', 'loc', 'cmd', 'registry-hkcu', true)
    expect(result).toBe(true) // mock returns true
    setPlatform('win32')
  })

  it('uses correct approved key for HKLM source', async () => {
    const regCalls = collectRegCalls()

    await toggleStartupItem('App', HKLM_RUN, '"C:\\app.exe"', 'registry-hklm', false)

    const approvedCall = regCalls.find((c) => c.args[0] === 'add' && c.args.some((a) => a.includes('StartupApproved')))
    expect(approvedCall).toBeDefined()
    expect(approvedCall!.args[1]).toContain('HKLM')
  })
})

// =====================================================================
// deleteStartupItem
// =====================================================================

describe('deleteStartupItem', () => {
  describe('registry items', () => {
    it('deletes from Run key and StartupApproved, cleans disabled file', async () => {
      const regCalls = collectRegCalls()

      // Setup disabled entries file with the item
      const existing = [{ name: 'Discord', command: '"C:\\Discord.exe"', location: HKCU_RUN, source: 'registry-hkcu' }]
      mockExistsSync.mockImplementation((p: string) => (p as string).endsWith('disabled-startups.json'))
      mockReadFileSync.mockReturnValue(JSON.stringify(existing))

      const result = await deleteStartupItem('Discord', HKCU_RUN, 'registry-hkcu')
      expect(result).toBe(true)

      // Should delete from Run key
      const runDelete = regCalls.find((c) => c.args[0] === 'delete' && c.args[1] === HKCU_RUN)
      expect(runDelete).toBeDefined()

      // Should delete from StartupApproved
      const approvedDelete = regCalls.find(
        (c) => c.args[0] === 'delete' && c.args.some((a) => a.includes('StartupApproved')),
      )
      expect(approvedDelete).toBeDefined()

      // Should clean up disabled file
      const lastWriteCall = mockWriteFileSync.mock.calls[mockWriteFileSync.mock.calls.length - 1]!
      const writtenData = JSON.parse(lastWriteCall[1] as string)
      expect(writtenData.length).toBe(0)
    })

    it('rejects disallowed registry locations', async () => {
      const result = await deleteStartupItem('Evil', 'HKLM\\SOFTWARE\\Evil', 'registry-hklm')
      expect(result).toBe(false)
    })

    it('succeeds even if reg delete fails (entry already gone)', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: (...args: unknown[]) => unknown) => {
          const err = Object.assign(new Error('reg delete failed'), {
            code: 2,
            stderr: 'ERROR: The system cannot find the file specified.',
          })
          cb(err, '', '')
        },
      )

      const result = await deleteStartupItem('App', HKCU_RUN, 'registry-hkcu')
      expect(result).toBe(true)
    })

    it('uses HKLM approved key for registry-hklm source', async () => {
      const regCalls = collectRegCalls()

      await deleteStartupItem('App', HKLM_RUN, 'registry-hklm')

      const approvedDelete = regCalls.find(
        (c) => c.args[0] === 'delete' && c.args.some((a) => a.includes('StartupApproved')),
      )
      expect(approvedDelete).toBeDefined()
      expect(approvedDelete!.args[1]).toContain('HKLM')
    })

    it('uses HKCU approved key for registry-hkcu source', async () => {
      const regCalls = collectRegCalls()

      await deleteStartupItem('App', HKCU_RUN, 'registry-hkcu')

      const approvedDelete = regCalls.find(
        (c) => c.args[0] === 'delete' && c.args.some((a) => a.includes('StartupApproved')),
      )
      expect(approvedDelete).toBeDefined()
      expect(approvedDelete!.args[1]).toContain('HKCU')
    })
  })

  describe('task scheduler items', () => {
    it('unregisters a task via PowerShell', async () => {
      const regCalls = collectRegCalls()

      const result = await deleteStartupItem('SpotifyStartup', 'Task Scheduler', 'task-scheduler')
      expect(result).toBe(true)
      const psCall = regCalls.find((c) => c.cmd === 'powershell')
      expect(psCall!.args.join(' ')).toContain('Unregister-ScheduledTask')
      expect(psCall!.args.join(' ')).toContain('SpotifyStartup')
      expect(psCall!.args.join(' ')).toContain('-Confirm:$false')
    })

    it('rejects unsafe task names', async () => {
      const result = await deleteStartupItem("evil'; DROP TABLE", 'Task Scheduler', 'task-scheduler')
      expect(result).toBe(false)
    })

    it('returns false when PowerShell unregister fails', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], _opts: any, cb: (...args: unknown[]) => unknown) => {
          cb(new Error('Access denied'), '', '')
        },
      )

      const result = await deleteStartupItem('SpotifyStartup', 'Task Scheduler', 'task-scheduler')
      expect(result).toBe(false)
    })
  })

  describe('startup folder items', () => {
    // Note: These tests use OS-appropriate paths since the source code uses
    // resolve() and path separators that differ between Windows and Linux.
    // The path traversal check in the source uses '\\' as separator, which
    // is specific to Windows. We test the logic on whichever OS is running.

    it('rejects paths outside the startup folder (path traversal prevention)', async () => {
      // Use a path that is clearly outside any startup folder
      const evilPath = '/tmp/important.doc'
      const result = await deleteStartupItem('Evil', evilPath, 'startup-folder')
      expect(result).toBe(false)
      expect(mockUnlinkSync).not.toHaveBeenCalled()
    })

    it('rejects disallowed registry location for startup-folder delete', async () => {
      // Even though source is startup-folder, the path must be within the startup dir
      const result = await deleteStartupItem('Evil', 'HKCU\\SOFTWARE\\Evil', 'startup-folder')
      expect(result).toBe(false)
    })
  })

  it('delegates to platform abstraction on non-Windows', async () => {
    setPlatform('darwin')
    const result = await deleteStartupItem('App', 'loc', 'registry-hkcu')
    expect(result).toBe(true) // mock returns true
    setPlatform('win32')
  })
})

// =====================================================================
// getBootTrace
// =====================================================================

describe('getBootTrace', () => {
  it('returns empty trace when PowerShell fails', async () => {
    const trace = await getBootTrace()
    expect(trace.available).toBe(false)
    expect(trace.totalBootMs).toBe(0)
    expect(trace.entries).toEqual([])
    expect(trace.needsAdmin).toBe(false)
  })

  it('returns needsAdmin when access is denied', async () => {
    setupExecFileHandler(() => ({ stdout: 'STATUS|DENIED\n' }))

    const trace = await getBootTrace()
    expect(trace.needsAdmin).toBe(true)
    expect(trace.available).toBe(false)
  })

  it('parses boot trace data correctly', async () => {
    const output = [
      'BOOT|15000|8000|2025-06-15T10:30:00.000Z',
      'APP|Discord|5000|C:\\Discord\\Discord.exe',
      'APP|Spotify|2000|C:\\Spotify\\Spotify.exe',
      'APP|LowImpactApp|500|C:\\App\\app.exe',
    ].join('\n')

    setupExecFileHandler(() => ({ stdout: output }))

    const trace = await getBootTrace()
    expect(trace.available).toBe(true)
    expect(trace.totalBootMs).toBe(15000)
    expect(trace.mainPathMs).toBe(8000)
    expect(trace.lastBootDate).toBe('2025-06-15T10:30:00.000Z')
    expect(trace.entries.length).toBe(3)
    // Should be sorted by delayMs descending
    expect(trace.entries[0]!.name).toBe('Discord')
    expect(trace.entries[0]!.delayMs).toBe(5000)
    expect(trace.entries[0]!.impact).toBe('high')
    expect(trace.entries[1]!.name).toBe('Spotify')
    expect(trace.entries[1]!.delayMs).toBe(2000)
    expect(trace.entries[1]!.impact).toBe('medium')
    expect(trace.entries[2]!.name).toBe('LowImpactApp')
    expect(trace.entries[2]!.delayMs).toBe(500)
    expect(trace.entries[2]!.impact).toBe('low')
  })

  it('calculates startupAppsMs as sum of all entry delays', async () => {
    const output = [
      'BOOT|10000|5000|2025-01-01T00:00:00Z',
      'APP|App1|3000|C:\\app1.exe',
      'APP|App2|1500|C:\\app2.exe',
    ].join('\n')

    setupExecFileHandler(() => ({ stdout: output }))

    const trace = await getBootTrace()
    expect(trace.startupAppsMs).toBe(4500)
  })

  it('deduplicates entries by name (keeps first/newest)', async () => {
    const output = [
      'BOOT|10000|5000|2025-01-01T00:00:00Z',
      'APP|Discord|5000|C:\\Discord.exe',
      'APP|Discord|3000|C:\\Discord.exe',
      'APP|Discord|2000|C:\\Discord.exe',
    ].join('\n')

    setupExecFileHandler(() => ({ stdout: output }))

    const trace = await getBootTrace()
    const discordEntries = trace.entries.filter((e) => e.name === 'Discord')
    expect(discordEntries.length).toBe(1)
    expect(discordEntries[0]!.delayMs).toBe(5000) // first occurrence kept
  })

  it('filters out entries with 0 delay', async () => {
    const output = [
      'BOOT|10000|5000|2025-01-01T00:00:00Z',
      'APP|ZeroApp|0|C:\\zero.exe',
      'APP|RealApp|1000|C:\\real.exe',
    ].join('\n')

    setupExecFileHandler(() => ({ stdout: output }))

    const trace = await getBootTrace()
    expect(trace.entries.length).toBe(1)
    expect(trace.entries[0]!.name).toBe('RealApp')
  })

  it('classifies boot entry impact by delay thresholds', async () => {
    const output = [
      'BOOT|10000|5000|2025-01-01T00:00:00Z',
      'APP|HighApp|4000|C:\\high.exe',
      'APP|MedApp|2000|C:\\med.exe',
      'APP|LowApp|500|C:\\low.exe',
    ].join('\n')

    setupExecFileHandler(() => ({ stdout: output }))

    const trace = await getBootTrace()
    expect(trace.entries.find((e) => e.name === 'HighApp')!.impact).toBe('high') // >3000
    expect(trace.entries.find((e) => e.name === 'MedApp')!.impact).toBe('medium') // >1000
    expect(trace.entries.find((e) => e.name === 'LowApp')!.impact).toBe('low') // <=1000
  })

  it('handles BOOT line with zero values', async () => {
    setupExecFileHandler(() => ({ stdout: 'BOOT|0|0|\n' }))

    const trace = await getBootTrace()
    expect(trace.totalBootMs).toBe(0)
    expect(trace.mainPathMs).toBe(0)
    expect(trace.available).toBe(false) // totalBootMs=0 and no entries
  })

  it('ignores malformed lines in powershell output', async () => {
    const output = ['BOOT|10000|5000|2025-01-01T00:00:00Z', 'INVALID|line', 'APP|ValidApp|1000|C:\\app.exe'].join('\n')

    setupExecFileHandler(() => ({ stdout: output }))

    const trace = await getBootTrace()
    expect(trace.entries.length).toBe(1)
    expect(trace.entries[0]!.name).toBe('ValidApp')
  })

  it('delegates to platform abstraction on non-Windows', async () => {
    setPlatform('darwin')
    const trace = await getBootTrace()
    // Platform mock returns null, so it should return the empty trace
    expect(trace.totalBootMs).toBe(0)
    expect(trace.available).toBe(false)
    setPlatform('win32')
  })
})

// =====================================================================
// Auditoria 2026-10-18 — S1 / S5 / S6 / S7 / S8
// =====================================================================

describe('startup-folder disabled variants (S1)', () => {
  const folderPath = (p: unknown) => String(p).includes('Start Menu')

  it('lists a .disabled file as the original item with enabled=false', async () => {
    mockExistsSync.mockImplementation((p: string) => folderPath(p))
    mockReaddirSync.mockReturnValue(['MyApp.lnk.disabled'])

    const items = await listStartupItems()
    const item = items.find((i) => i.source === 'startup-folder')
    expect(item).toBeDefined()
    expect(item!.name).toBe('MyApp.lnk')
    expect(item!.enabled).toBe(false)
    expect(item!.command.endsWith('MyApp.lnk')).toBe(true)
    expect(item!.command.endsWith('.disabled')).toBe(false)
  })

  it('deduplicates a file present both enabled and disabled (enabled wins)', async () => {
    mockExistsSync.mockImplementation((p: string) => folderPath(p))
    mockReaddirSync.mockReturnValue(['MyApp.lnk.disabled', 'MyApp.lnk'])

    const items = await listStartupItems()
    const folderItems = items.filter((i) => i.source === 'startup-folder')
    expect(folderItems).toHaveLength(1)
    expect(folderItems[0]!.enabled).toBe(true)
  })

  it('toggling a folder item renames to .disabled and back', async () => {
    const command = 'C:\\Users\\Test\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\App.lnk'

    expect(await toggleStartupItem('App.lnk', '', command, 'startup-folder', false)).toBe(true)
    expect(mockRenameSync).toHaveBeenCalledWith(command, `${command}.disabled`)

    mockRenameSync.mockClear()
    expect(await toggleStartupItem('App.lnk', '', command, 'startup-folder', true)).toBe(true)
    expect(mockRenameSync).toHaveBeenCalledWith(`${command}.disabled`, command)
  })
})

describe('disabled-startups.json robustness (S5)', () => {
  const disabledFile = (p: unknown) => String(p).endsWith('disabled-startups.json')

  it('ignores non-array JSON instead of throwing', async () => {
    mockExistsSync.mockImplementation(disabledFile)
    mockReadFileSync.mockReturnValue('{"not":"an array"}')

    const items = await listStartupItems()
    expect(Array.isArray(items)).toBe(true)
  })

  it('skips malformed entries instead of crashing the list', async () => {
    mockExistsSync.mockImplementation(disabledFile)
    mockReadFileSync.mockReturnValue(
      JSON.stringify([
        { name: 'Ok', command: '"C:\\Ok\\ok.exe"', location: HKCU_RUN, source: 'registry-hkcu' },
        { name: 42, command: null, location: 7, source: 'nope' },
        'junk',
      ]),
    )

    const items = await listStartupItems()
    expect(items.some((i) => i.name === 'Ok')).toBe(true)
    expect(items.some((i) => (i.name as string | number) === 42)).toBe(false)
  })

  it('normalises a legacy "undefined" command to an empty string', async () => {
    mockExistsSync.mockImplementation(disabledFile)
    mockReadFileSync.mockReturnValue(
      JSON.stringify([{ name: 'Ghost', command: 'undefined', location: HKCU_RUN, source: 'registry-hkcu' }]),
    )

    const items = await listStartupItems()
    expect(items[0]!.command).toBe('')
  })

  it('writes the disabled file atomically via a temp file + rename', async () => {
    collectRegCalls()

    await toggleStartupItem('Discord', HKCU_RUN, '"C:\\Discord\\Discord.exe"', 'registry-hkcu', false)

    expect(mockRenameSync).toHaveBeenCalledTimes(1)
    const [tmp, target] = mockRenameSync.mock.calls[0] as [string, string]
    expect(tmp.endsWith('.tmp')).toBe(true)
    expect(target.endsWith('disabled-startups.json')).toBe(true)
  })

  it('still succeeds (and warns) when the disabled file cannot be written', async () => {
    collectRegCalls()
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('disk full')
    })

    const result = await toggleStartupItem('Discord', HKCU_RUN, '"C:\\Discord\\Discord.exe"', 'registry-hkcu', false)

    expect(result).toBe(true)
    expect(mockLogger.warning).toHaveBeenCalled()
  })
})

describe('REG_EXPAND_SZ entries (S6)', () => {
  it('lists REG_EXPAND_SZ registry entries', async () => {
    setupExecFileHandler((cmd, args) => {
      if (cmd === 'reg' && args[1] === HKCU_RUN) {
        return {
          stdout: [
            '',
            `${HKCU_RUN}`,
            '',
            '    SecurityHealth    REG_EXPAND_SZ    %windir%\\System32\\SecurityHealthSystray.exe',
            '',
          ].join('\n'),
        }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    expect(items.some((i) => i.name === 'SecurityHealth')).toBe(true)
  })
})

describe('StartupApproved source matching (S7)', () => {
  it('does not apply StartupApproved entries from another source', async () => {
    setupExecFileHandler((cmd, args) => {
      const key = String(args[1] ?? '')
      if (cmd !== 'reg') throw new Error('unexpected')
      if (key === HKLM_RUN) {
        return { stdout: `${HKLM_RUN}\n\n    Discord    REG_SZ    "C:\\Discord\\Discord.exe"\n` }
      }
      if (key.startsWith('HKCU') && key.includes('StartupApproved\\Run')) {
        return { stdout: `\n    Discord    REG_BINARY    030000000000000000000000\n` }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    const discord = items.find((i) => i.name === 'Discord')
    expect(discord).toBeDefined()
    expect(discord!.source).toBe('registry-hklm')
    // The HKCU StartupApproved entry must not disable the HKLM item
    expect(discord!.enabled).toBe(true)
  })
})

describe('silent failures are logged (S8)', () => {
  it('warns when the startup folder cannot be read', async () => {
    mockExistsSync.mockImplementation((p: string) => String(p).includes('Start Menu'))
    mockReaddirSync.mockImplementation(() => {
      throw new Error('EACCES')
    })

    const items = await listStartupItems()
    expect(items.some((i) => i.source === 'startup-folder')).toBe(false)
    expect(mockLogger.warning).toHaveBeenCalledWith('startup-manager', expect.stringContaining('startup folder'))
  })

  it('logs an error when a startup-folder rename fails', async () => {
    mockRenameSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    const command = 'C:\\Users\\Test\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\App.lnk'

    const result = await toggleStartupItem('App.lnk', '', command, 'startup-folder', false)

    expect(result).toBe(false)
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('logs an error when a scheduled-task toggle fails', async () => {
    const result = await toggleStartupItem('MyTask', '', '', 'task-scheduler', false)

    expect(result).toBe(false)
    expect(mockLogger.error).toHaveBeenCalled()
  })

  it('warns when the boot trace query fails', async () => {
    const trace = await getBootTrace()

    expect(trace.available).toBe(false)
    expect(mockLogger.warning).toHaveBeenCalledWith('startup-manager', expect.stringContaining('boot trace'))
  })
})

// =====================================================================
// registerStartupManagerIpc
// =====================================================================

describe('registerStartupManagerIpc', () => {
  it('registers all four IPC handlers', () => {
    registerStartupManagerIpc(mockGetWindow)

    expect(mockHandlers.has('startup:list')).toBe(true)
    expect(mockHandlers.has('startup:toggle')).toBe(true)
    expect(mockHandlers.has('startup:delete')).toBe(true)
    expect(mockHandlers.has('startup:boot-trace')).toBe(true)
  })

  it('STARTUP_TOGGLE handler passes all arguments through', async () => {
    registerStartupManagerIpc(mockGetWindow)
    const handler = mockHandlers.get('startup:toggle')!
    const calls = collectRegCalls()

    const result = await handler({}, 'App', HKCU_RUN, '"C:\\app.exe"', 'registry-hkcu', false)
    expect(result).toBe(true)
    // Non-vacuity: the handler must have actually touched the registry
    expect(calls.length).toBeGreaterThan(0)
  })

  it('STARTUP_DELETE handler passes all arguments through', async () => {
    registerStartupManagerIpc(mockGetWindow)
    const handler = mockHandlers.get('startup:delete')!

    const result = await handler({}, 'App', HKCU_RUN, 'registry-hkcu')
    expect(typeof result).toBe('boolean')
  })

  it('STARTUP_TOGGLE refuses a foreign sender without touching the registry', async () => {
    const foreignWindow = vi.fn(() => ({ id: 99 })) as unknown as WindowGetter
    registerStartupManagerIpc(foreignWindow)
    const handler = mockHandlers.get('startup:toggle')!
    const calls = collectRegCalls()

    const result = await handler({}, 'App', HKCU_RUN, '"C:\\app.exe"', 'registry-hkcu', false)

    expect(result).toBe(false)
    expect(calls.length).toBe(0)
  })

  it('STARTUP_LIST returns an empty list for a foreign sender', async () => {
    const foreignWindow = vi.fn(() => ({ id: 99 })) as unknown as WindowGetter
    registerStartupManagerIpc(foreignWindow)
    const handler = mockHandlers.get('startup:list')!

    const result = await handler({})

    expect(result).toEqual([])
  })
})

// =====================================================================
// ALLOWED_STARTUP_LOCATIONS whitelist
// =====================================================================

describe('ALLOWED_STARTUP_LOCATIONS whitelist', () => {
  it('accepts all three known Run key locations', async () => {
    collectRegCalls()

    for (const loc of [HKCU_RUN, HKLM_RUN, HKLM_WOW64_RUN]) {
      const result = await toggleStartupItem('App', loc, '"C:\\app.exe"', 'registry-hkcu', false)
      expect(result).toBe(true)
    }
  })

  it('rejects arbitrary registry paths', async () => {
    const badPaths = [
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
      'HKLM\\SOFTWARE\\Evil',
      'HKCU\\Run',
      '',
    ]

    for (const loc of badPaths) {
      const result = await toggleStartupItem('App', loc, '"C:\\app.exe"', 'registry-hkcu', false)
      expect(result).toBe(false)
    }
  })
})

// =====================================================================
// parseRegOutput (tested indirectly through listStartupItems)
// =====================================================================

describe('parseRegOutput (integration via listStartupItems)', () => {
  it('parses standard reg query output with varying whitespace', async () => {
    const rawOutput = [
      '',
      'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
      '',
      '    SecurityHealth    REG_SZ    C:\\Windows\\system32\\SecurityHealthSystray.exe',
      '    Discord    REG_SZ    "C:\\Users\\User\\AppData\\Local\\Discord\\Update.exe" --processStart Discord.exe',
      '    electron.app.Notion    REG_SZ    "C:\\Users\\User\\AppData\\Local\\Programs\\Notion\\Notion.exe" --start-hidden',
      '',
    ].join('\n')

    setupExecFileHandler((cmd, args) => {
      if (cmd === 'reg' && args[1] === HKCU_RUN) {
        return { stdout: rawOutput }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    expect(items.length).toBe(3)

    const security = items.find((i) => i.name === 'SecurityHealth')!
    expect(security.impact).toBe('none') // Windows Defender = none

    const discord = items.find((i) => i.name === 'Discord')!
    expect(discord.publisher).toBe('Discord Inc.')

    const notion = items.find((i) => i.name === 'electron.app.Notion')!
    expect(notion.displayName).toBe('Notion') // electron.app.X pattern
  })

  it('ignores non-REG_SZ lines', async () => {
    const rawOutput = [
      '',
      'HKEY_CURRENT_USER\\...\\Run',
      '',
      '    BinaryVal    REG_BINARY    DEADBEEF',
      '    ValidApp    REG_SZ    "C:\\app.exe"',
      '',
    ].join('\n')

    setupExecFileHandler((cmd, args) => {
      if (cmd === 'reg' && args[1] === HKCU_RUN) {
        return { stdout: rawOutput }
      }
      throw new Error('not found')
    })

    const items = await listStartupItems()
    const validApp = items.find((i) => i.name === 'ValidApp')
    expect(validApp).toBeDefined()
    expect(items.find((i) => i.name === 'BinaryVal')).toBeUndefined()
  })
})

// =====================================================================
// Edge cases and error resilience
// =====================================================================

describe('error resilience', () => {
  it('listStartupItems handles startup folder read error gracefully', async () => {
    mockReaddirSync.mockImplementation(() => {
      throw new Error('permission denied')
    })
    mockExistsSync.mockReturnValue(true)

    const items = await listStartupItems()
    expect(Array.isArray(items)).toBe(true)
  })

  it('toggleStartupItem continues when StartupApproved write fails', async () => {
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: (...args: unknown[]) => unknown) => {
      callCount++
      if (args[0] === 'add' && JSON.stringify(args).includes('StartupApproved')) {
        cb(new Error('access denied'), '', '')
      } else {
        cb(null, '', '')
      }
    })

    const result = await toggleStartupItem('App', HKCU_RUN, '"C:\\app.exe"', 'registry-hkcu', false)
    expect(result).toBe(true)
    expect(callCount).toBeGreaterThan(1) // Should have continued to delete from Run key
  })

  it('disabled file lock serializes concurrent operations', async () => {
    const writeOrder: number[] = []
    let writeCount = 0
    mockWriteFileSync.mockImplementation(() => {
      writeOrder.push(++writeCount)
    })
    collectRegCalls()

    // Fire two toggles concurrently — both disable
    const p1 = toggleStartupItem('App1', HKCU_RUN, '"C:\\a1.exe"', 'registry-hkcu', false)
    const p2 = toggleStartupItem('App2', HKCU_RUN, '"C:\\a2.exe"', 'registry-hkcu', false)

    await Promise.all([p1, p2])

    // Both should have completed writes (lock ensures serialization)
    expect(writeOrder.length).toBeGreaterThanOrEqual(2)
  })
})
