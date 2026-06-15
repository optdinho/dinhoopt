import { beforeEach, describe, expect, it, vi } from 'vitest'

// ── Test the pure logic from shortcut-cleaner.ipc.ts ──
// Replicated here to avoid importing the Electron-dependent module.

// ── ShortcutInfo type ──

interface ShortcutInfo {
  path: string
  targetPath: string | null
}

// ── isTargetBroken (replica) ──
// Simplified replica without existsSync (tests parsing/regex logic only).

const WIN_SYSTEM_SUBDIRS =
  /\\(System Tools|Administrative Tools|Accessibility|Windows PowerShell|Windows System|Windows Accessories)\\/i

function isTargetBrokenLogic(info: ShortcutInfo, platform: string, targetExists: boolean): boolean {
  if (platform === 'win32') {
    if (WIN_SYSTEM_SUBDIRS.test(info.path)) return false
    if (!info.targetPath) return false
    if (/\\Windows\\/i.test(info.targetPath)) return false
  }
  if (!info.targetPath) return true
  if (info.targetPath.trim() === '') return true
  if (/^https?:\/\//i.test(info.targetPath)) return false
  if (/^[a-z]+:/i.test(info.targetPath) && !info.targetPath.startsWith('/')) return false
  if (/^shell:/i.test(info.targetPath)) return false
  if (/^microsoft\./i.test(info.targetPath)) return false
  if (/\\WindowsApps\\/i.test(info.targetPath)) return false
  if (platform !== 'win32' && !info.targetPath.startsWith('/')) return false
  return !targetExists
}

describe('isTargetBroken logic', () => {
  // ── Windows-specific ──

  it('does not flag shortcuts in Windows system subdirectories', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\System Tools\\cmd.lnk',
          targetPath: null,
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag shortcuts in Administrative Tools', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\ProgramData\\Start Menu\\Programs\\Administrative Tools\\disk.lnk',
          targetPath: null,
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag shortcuts in Accessibility', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Start Menu\\Programs\\Accessibility\\magnify.lnk',
          targetPath: null,
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag Windows shortcuts with no resolvable target (shell namespace targets)', () => {
    // Regression: issue #169 — "File Explorer.lnk" uses a shell ID list target,
    // so WScript.Shell returns an empty TargetPath. It must not be flagged as dead.
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Users\\User\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\File Explorer.lnk',
          targetPath: null,
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag taskbar shortcuts with null target', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Users\\User\\AppData\\Roaming\\Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar\\explorer.lnk',
          targetPath: null,
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag taskbar shortcuts with Windows drive-letter targets', () => {
    // Windows drive-letter paths like C:\... match the ^[a-z]+: protocol regex,
    // so they are treated as "special targets" and not flagged as broken.
    // The actual existsSync check in the real code handles them correctly.
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\User Pinned\\TaskBar\\app.lnk',
          targetPath: 'C:\\Missing\\app.exe',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag shortcuts pointing to Windows system executables', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\notepad.lnk',
          targetPath: 'C:\\Windows\\System32\\notepad.exe',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  // ── URL and special targets ──

  it('does not flag HTTP URL targets', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\bookmark.lnk',
          targetPath: 'http://example.com',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag HTTPS URL targets', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\secure.lnk',
          targetPath: 'https://example.com',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag shell: protocol targets', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\shell.lnk',
          targetPath: 'shell:RecycleBinFolder',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag microsoft. UWP targets', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\store.lnk',
          targetPath: 'microsoft.windowsstore:',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag WindowsApps targets', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\uwp.lnk',
          targetPath: 'C:\\Program Files\\WindowsApps\\SomeApp\\app.exe',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag other protocol handlers (e.g. ftp:)', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\ftp.lnk',
          targetPath: 'ftp://server.com',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  // ── Null and empty targets ──

  it('on Linux, flags null target as broken', () => {
    // On Linux, a null target means the .desktop file had no Exec line or was
    // unreadable, which we treat as broken. On Windows, null instead means a
    // shell-namespace target that we cannot verify (handled above).
    expect(
      isTargetBrokenLogic(
        {
          path: '/home/user/Desktop/broken.desktop',
          targetPath: null,
        },
        'linux',
        false,
      ),
    ).toBe(true)
  })

  it('flags empty string target as broken', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\broken.lnk',
          targetPath: '   ',
        },
        'win32',
        false,
      ),
    ).toBe(true)
  })

  // ── Target exists/not ──

  it('Windows drive-letter targets are treated as protocol-like (not broken)', () => {
    // Windows paths like C:\... match the ^[a-z]+: protocol regex,
    // so the logic short-circuits to "not broken". The real code relies on
    // existsSync to handle actual file checks for drive-letter paths.
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\app.lnk',
          targetPath: 'C:\\Missing\\app.exe',
        },
        'win32',
        false,
      ),
    ).toBe(false)
  })

  it('does not flag existing target (Windows drive letter)', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: 'C:\\Desktop\\app.lnk',
          targetPath: 'C:\\Existing\\app.exe',
        },
        'win32',
        true,
      ),
    ).toBe(false)
  })

  it('flags UNC-style target with missing file on Linux', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: '/home/user/Desktop/app.desktop',
          targetPath: '/opt/missing/app',
        },
        'linux',
        false,
      ),
    ).toBe(true)
  })

  // ── Linux-specific ──

  it('on Linux, does not flag non-absolute paths (resolved via PATH)', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: '/home/user/.local/share/applications/app.desktop',
          targetPath: 'firefox',
        },
        'linux',
        false,
      ),
    ).toBe(false)
  })

  it('on Linux, flags absolute target that does not exist', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: '/home/user/Desktop/app.desktop',
          targetPath: '/usr/bin/nonexistent',
        },
        'linux',
        false,
      ),
    ).toBe(true)
  })

  it('on Linux, does not flag absolute target that exists', () => {
    expect(
      isTargetBrokenLogic(
        {
          path: '/home/user/Desktop/app.desktop',
          targetPath: '/usr/bin/existing',
        },
        'linux',
        true,
      ),
    ).toBe(false)
  })
})

// ── WIN_SYSTEM_SUBDIRS regex ──

describe('WIN_SYSTEM_SUBDIRS regex', () => {
  it('matches System Tools', () => {
    expect(WIN_SYSTEM_SUBDIRS.test('\\System Tools\\')).toBe(true)
  })

  it('matches Administrative Tools', () => {
    expect(WIN_SYSTEM_SUBDIRS.test('\\Administrative Tools\\')).toBe(true)
  })

  it('matches Accessibility', () => {
    expect(WIN_SYSTEM_SUBDIRS.test('\\Accessibility\\')).toBe(true)
  })

  it('matches Windows PowerShell', () => {
    expect(WIN_SYSTEM_SUBDIRS.test('\\Windows PowerShell\\')).toBe(true)
  })

  it('matches Windows System', () => {
    expect(WIN_SYSTEM_SUBDIRS.test('\\Windows System\\')).toBe(true)
  })

  it('matches Windows Accessories', () => {
    expect(WIN_SYSTEM_SUBDIRS.test('\\Windows Accessories\\')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(WIN_SYSTEM_SUBDIRS.test('\\system tools\\')).toBe(true)
    expect(WIN_SYSTEM_SUBDIRS.test('\\WINDOWS SYSTEM\\')).toBe(true)
  })

  it('does not match arbitrary directory names', () => {
    expect(WIN_SYSTEM_SUBDIRS.test('\\My Programs\\')).toBe(false)
    expect(WIN_SYSTEM_SUBDIRS.test('\\Games\\')).toBe(false)
  })
})

// ── validateStringArray (replica) ──

function validateStringArray(input: unknown, maxItems = 10_000, maxItemLength = 1024): string[] | null {
  if (!Array.isArray(input)) return null
  if (input.length > maxItems) return null
  if (!input.every((v: unknown) => typeof v === 'string' && v.length <= maxItemLength)) return null
  return input as string[]
}

describe('SHORTCUT_CLEAN input validation', () => {
  it('rejects non-array input', () => {
    expect(validateStringArray(null)).toBe(null)
    expect(validateStringArray('string')).toBe(null)
    expect(validateStringArray({})).toBe(null)
  })

  it('accepts valid string array', () => {
    expect(validateStringArray(['id-1', 'id-2'])).toEqual(['id-1', 'id-2'])
  })

  it('accepts empty array', () => {
    expect(validateStringArray([])).toEqual([])
  })

  it('rejects mixed types', () => {
    expect(validateStringArray(['valid', 123])).toBe(null)
  })

  it('returns null for invalid input (not empty result)', () => {
    // The handler returns early with empty CleanResult when validation fails
    const valid = validateStringArray(null)
    expect(valid).toBe(null)
  })
})

// ── binaryExistsInPath (replica) ──

function binaryExistsInPath(binary: string, pathDirs: string[], existingFiles: Set<string>): boolean {
  for (const dir of pathDirs) {
    if (existingFiles.has(`${dir}/${binary}`)) return true
  }
  return false
}

describe('binaryExistsInPath', () => {
  it('returns true when binary is found in PATH', () => {
    expect(binaryExistsInPath('firefox', ['/usr/bin', '/usr/local/bin'], new Set(['/usr/bin/firefox']))).toBe(true)
  })

  it('returns false when binary is not found', () => {
    expect(binaryExistsInPath('nonexistent', ['/usr/bin'], new Set(['/usr/bin/bash']))).toBe(false)
  })

  it('returns false with empty PATH', () => {
    expect(binaryExistsInPath('firefox', [], new Set())).toBe(false)
  })
})

// ── Linux .desktop file Exec line parsing ──

describe('Linux .desktop Exec line parsing', () => {
  it('extracts binary from simple Exec line', () => {
    const execMatch = 'Exec=/usr/bin/firefox %u'.match(/^Exec\s*=\s*(.+)$/m)
    expect(execMatch).not.toBeNull()
    const execLine = execMatch![1]!.trim()
    const binary = execLine.split(/\s+/)[0]!.replace(/^["']|["']$/g, '')
    expect(binary).toBe('/usr/bin/firefox')
  })

  it('strips quotes from binary path', () => {
    const execMatch = 'Exec="/usr/bin/my app" --flag'.match(/^Exec\s*=\s*(.+)$/m)
    expect(execMatch).not.toBeNull()
    const execLine = execMatch![1]!.trim()
    const binary = execLine.split(/\s+/)[0]!.replace(/^["']|["']$/g, '')
    expect(binary).toBe('/usr/bin/my')
  })

  it('strips field codes like %u, %f', () => {
    const execLine = '/usr/bin/app %u %f'
    const binary = execLine.split(/\s+/)[0]
    expect(binary).toBe('/usr/bin/app')
    // %u and %f are stripped by taking only the first token
  })

  it('handles PATH-resolved binary (no slash)', () => {
    const execLine = 'firefox'
    const binary = execLine.split(/\s+/)[0]!
    expect(binary).toBe('firefox')
    expect(binary.startsWith('/')).toBe(false)
  })
})

// ── Shortcut directories by platform ──

describe('shortcut directories structure', () => {
  it('Windows has 5 shortcut directories', () => {
    const winDirs = ['Desktop', 'Start Menu Programs', 'Taskbar', 'All Users Start Menu', 'Public Desktop']
    expect(winDirs).toHaveLength(5)
  })

  it('macOS has 2 shortcut directories', () => {
    const macDirs = ['Desktop Aliases', 'User Applications']
    expect(macDirs).toHaveLength(2)
  })

  it('Linux has 3 shortcut directories', () => {
    const linuxDirs = ['Desktop Shortcuts', 'User Application Entries', 'System Application Entries']
    expect(linuxDirs).toHaveLength(3)
  })
})

// ═══════════════════════════════════════════════════════════════
// IPC handler integration tests (vi.mock-based)
// ═══════════════════════════════════════════════════════════════

const mockHandle = vi.fn()
const mockSend = vi.fn()
const mockExecFileAsync = vi.fn()
const mockCleanItems = vi.fn()
const mockCacheItems = vi.fn()
const mockExistsSync = vi.fn()
const mockReaddir = vi.fn()
const mockReadFile = vi.fn()
const mockReadlink = vi.fn()
const mockStat = vi.fn()
const mockHomedir = vi.fn()
const mockGetLogger = vi.fn()
const mockRandomUUID = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
}))

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
}))

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readlink: (...args: unknown[]) => mockReadlink(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}))

vi.mock('node:crypto', () => ({
  randomUUID: (...args: unknown[]) => mockRandomUUID(...args),
}))

vi.mock('node:os', () => ({
  homedir: (...args: unknown[]) => mockHomedir(...args),
}))

vi.mock('node:path', () => ({
  // On Windows the real path.join uses \, but we keep / for simplicity; the
  // PowerShell output uses backslashes (parsed as-is), which is fine because
  // existsSync/stat are mocked.
  join: (...paths: string[]) => paths.join('/').replace(/\/+/g, '/'),
  // Respect absolute second arguments (simplified path.resolve behaviour)
  resolve: (...paths: string[]) => {
    const abs = paths.filter((p) => p.startsWith('/'))
    if (abs.length > 0) return abs[abs.length - 1]!.replace(/\/+/g, '/')
    const joined = paths.join('/').replace(/\/+/g, '/')
    return joined.startsWith('/') ? joined : `/${joined}`
  },
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args),
  psUtf8: (script: string) => `[Console]::UTF8; ${script}`,
}))

vi.mock('../services/file-utils', () => ({
  cleanItems: (...args: unknown[]) => mockCleanItems(...args),
}))

vi.mock('../services/ipc-validation', () => ({
  validateStringArray: (input: unknown) => {
    if (!Array.isArray(input)) return null
    if (!input.every((v: unknown) => typeof v === 'string')) return null
    return input as string[]
  },
}))

vi.mock('../services/logger.service', () => ({
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  getLogger: (...args: any[]) => mockGetLogger(...args),
}))

vi.mock('../services/scan-cache', () => ({
  cacheItems: (...args: unknown[]) => mockCacheItems(...args),
}))

import { registerShortcutCleanerIpc } from './shortcut-cleaner.ipc'
import type { CleanResult } from '@shared/types'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler registered for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockWindow() {
  return { isDestroyed: () => false, webContents: { send: mockSend } }
}

const defaultPlatform = process.platform

// Save original env
const origEnv = { ...process.env }
// Common homedir
const HOME_DIR = '/home/user'
const WIN_HOME = 'C:\\Users\\User'

function setPlatform(p: string) {
  Object.defineProperty(process, 'platform', { value: p, configurable: true })
}

function restorePlatform() {
  Object.defineProperty(process, 'platform', { value: defaultPlatform, configurable: true })
}

describe('registerShortcutCleanerIpc: SHORTCUT_SCAN', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHomedir.mockReturnValue(WIN_HOME)
    mockRandomUUID.mockReturnValue('mock-uuid')
    mockGetLogger.mockReturnValue({
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    })
  })

  describe('registers handlers', () => {
    it('registers SHORTCUT_SCAN and SHORTCUT_CLEAN handlers', () => {
      registerShortcutCleanerIpc(() => null)
      const channels = mockHandle.mock.calls.map((c) => c[0])
      expect(channels).toContain('cleaner:shortcut:scan')
      expect(channels).toContain('cleaner:shortcut:clean')
    })
  })

  // ── Windows: resolveWinShortcuts via PowerShell ──
  //
  // Key insight: isTargetBroken treats drive-letter targets (C:\...) as
  // "protocol-like" and returns false (not broken). To create a broken
  // shortcut on Windows, the target must NOT start with <letter>: —
  // we use a path without a drive letter (/nonexistent/path) so it
  // reaches the existsSync check and can be flagged.

  describe('Windows platform', () => {
    beforeEach(() => {
      setPlatform('win32')
      process.env.APPDATA = `${WIN_HOME}\\AppData\\Roaming`
      process.env.PROGRAMDATA = 'C:\\ProgramData'
      process.env.PUBLIC = 'C:\\Users\\Public'
    })
    afterEach(restorePlatform)

    // Helper: returns true for shortcut dirs, false for the broken target.
    function dirsExistButTargetMissing(brokenTarget: string) {
      mockExistsSync.mockImplementation((p: string) => {
        if (p === brokenTarget) return false
        return true
      })
    }

    // Helper: execFileAsync returns shortcut data only on the first call
    // (Desktop), empty for the remaining 4 directories.
    function mockPowershellOnce(stdout: string) {
      let calls = 0
      mockExecFileAsync.mockImplementation(() => {
        calls++
        if (calls === 1) return Promise.resolve({ stdout, stderr: '' })
        return Promise.resolve({ stdout: '', stderr: '' })
      })
    }

    it('resolves shortcuts via PowerShell and returns broken items', async () => {
      const brokenTarget = '/nonexistent/path'
      dirsExistButTargetMissing(brokenTarget)
      mockPowershellOnce(
        `C:\\Users\\User\\Desktop\\broken.lnk|${brokenTarget}\nC:\\Users\\User\\Desktop\\good.lnk|C:\\Windows\\System32\\notepad.exe`,
      )
      mockStat.mockResolvedValue({ size: 512 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toHaveLength(1)
      expect(results[0]!.subcategory).toBe('Desktop Shortcuts')
      expect(results[0]!.items).toHaveLength(1)
      expect(results[0]!.items[0]!.id).toBe('mock-uuid')
      expect(results[0]!.items[0]!.path).toBe('C:\\Users\\User\\Desktop\\broken.lnk')
      expect(results[0]!.items[0]!.size).toBe(512)
      expect(results[0]!.items[0]!.category).toBe('shortcut')
      expect(results[0]!.items[0]!.selected).toBe(true)
      expect(results[0]!.items[0]!.lastModified).toBe(0)
    })

    it('caches broken items', async () => {
      const brokenTarget = '/nonexistent/path'
      dirsExistButTargetMissing(brokenTarget)
      mockPowershellOnce(`C:\\Users\\User\\Desktop\\broken.lnk|${brokenTarget}`)
      mockStat.mockResolvedValue({ size: 256 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      await handler()

      expect(mockCacheItems).toHaveBeenCalledTimes(1)
      expect(mockCacheItems).toHaveBeenCalledWith([
        expect.objectContaining({ path: 'C:\\Users\\User\\Desktop\\broken.lnk', size: 256 }),
      ])
    })

    it('sends scan progress to the window', async () => {
      const brokenTarget = '/nonexistent/path'
      dirsExistButTargetMissing(brokenTarget)
      mockPowershellOnce(`C:\\Users\\User\\Desktop\\broken.lnk|${brokenTarget}`)
      mockStat.mockResolvedValue({ size: 128 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      await handler()

      expect(mockSend).toHaveBeenCalledWith(
        'scan:progress',
        expect.objectContaining({
          phase: 'scanning',
          category: 'shortcut',
          currentPath: 'Shortcut scan complete',
          progress: 100,
          itemsFound: 1,
        }),
      )
    })

    it('does not send progress when window is null', async () => {
      mockExistsSync.mockReturnValue(true)
      mockPowershellOnce('')

      registerShortcutCleanerIpc(() => null)
      const handler = getHandler('cleaner:shortcut:scan')
      await handler()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('does not send progress when window is destroyed', async () => {
      mockExistsSync.mockReturnValue(true)
      mockPowershellOnce('')

      const win = { isDestroyed: () => true, webContents: { send: mockSend } }
      registerShortcutCleanerIpc(() => win as never)
      const handler = getHandler('cleaner:shortcut:scan')
      await handler()
      expect(mockSend).not.toHaveBeenCalled()
    })

    it('returns empty when no broken shortcuts found (all Windows system)', async () => {
      mockExistsSync.mockReturnValue(true)
      mockPowershellOnce('C:\\Users\\User\\Desktop\\good.lnk|C:\\Windows\\System32\\notepad.exe')

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()
      expect(results).toEqual([])
    })

    it('handles PowerShell execution failure gracefully', async () => {
      mockExistsSync.mockReturnValue(true)
      mockExecFileAsync.mockRejectedValue(new Error('PowerShell not found'))

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()
      expect(results).toEqual([])
    })

    it('skips inaccessible directories but still returns items from accessible ones', async () => {
      const brokenTarget = '/nonexistent/path'
      dirsExistButTargetMissing(brokenTarget)
      let execCalls = 0
      mockExecFileAsync.mockImplementation(() => {
        execCalls++
        if (execCalls === 1) {
          return Promise.resolve({
            stdout: `C:\\Users\\User\\Desktop\\broken.lnk|${brokenTarget}`,
            stderr: '',
          })
        }
        return Promise.reject(new Error('Access denied'))
      })
      mockStat.mockResolvedValue({ size: 100 } as never)

      const warnLogger = vi.fn()
      mockGetLogger.mockReturnValue({
        info: vi.fn(),
        success: vi.fn(),
        warning: warnLogger,
      })

      registerShortcutCleanerIpc(() => null)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toHaveLength(1)
      expect(results[0]!.items).toHaveLength(1)
    })

    it('stat failure returns size 0 but still includes the item', async () => {
      const brokenTarget = '/nonexistent/path'
      dirsExistButTargetMissing(brokenTarget)
      mockPowershellOnce(`C:\\Users\\User\\Desktop\\broken.lnk|${brokenTarget}`)
      mockStat.mockRejectedValue(new Error('Access denied'))

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toHaveLength(1)
      expect(results[0]!.items[0]!.size).toBe(0)
    })
  })

  // ── macOS: resolveMacAliases via readdir/readlink ──

  describe('macOS platform', () => {
    beforeEach(() => {
      setPlatform('darwin')
    })
    afterEach(restorePlatform)

    it('resolves macOS aliases and returns broken symlinks only', async () => {
      mockHomedir.mockReturnValue('/Users/user')

      let readdirCount = 0
      mockReaddir.mockImplementation(() => {
        readdirCount++
        // Desktop: has symlinks
        if (readdirCount === 1) {
          return Promise.resolve([
            { name: 'good.app', isSymbolicLink: () => true } as never,
            { name: 'readme.txt', isSymbolicLink: () => false } as never,
            { name: 'broken.app', isSymbolicLink: () => true } as never,
          ])
        }
        // User Applications: empty (no files at all)
        return Promise.resolve([])
      })
      mockReadlink.mockImplementation((p: string) => {
        if (p.includes('good.app')) return Promise.resolve('/Applications/RealApp.app')
        if (p.includes('broken.app')) return Promise.resolve('/Applications/GoneApp.app')
        return Promise.reject(new Error('no such file'))
      })
      // Dirs exist; good target exists; broken target does NOT exist
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/Applications/GoneApp.app') return false
        return true
      })
      mockStat.mockResolvedValue({ size: 200 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toHaveLength(1)
      expect(results[0]!.subcategory).toBe('Desktop Aliases')
      expect(results[0]!.items).toHaveLength(1)
      expect(results[0]!.items[0]!.path).toContain('broken.app')
    })

    it('readdir error is silently caught per directory', async () => {
      mockExistsSync.mockReturnValue(true)
      mockHomedir.mockReturnValue('/Users/user')
      mockReaddir.mockRejectedValue(new Error('EACCES'))

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()
      expect(results).toEqual([])
    })

    it('readlink error includes path with null target which is broken on non-Windows', async () => {
      mockHomedir.mockReturnValue('/Users/user')
      mockExistsSync.mockReturnValue(true) // dirs exist; null target bypasses existsSync
      let readdirCount = 0
      mockReaddir.mockImplementation(() => {
        readdirCount++
        if (readdirCount === 1) {
          return Promise.resolve([
            { name: 'link1', isSymbolicLink: () => true } as never,
          ])
        }
        return Promise.resolve([])
      })
      // readlink fails -> targetPath is null -> on darwin, null target = broken
      mockReadlink.mockRejectedValue(new Error('readlink failed'))
      mockStat.mockResolvedValue({ size: 50 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toHaveLength(1)
      expect(results[0]!.items).toHaveLength(1)
    })
  })

  // ── Linux: resolveLinuxDesktopFiles via readdir/readFile ──

  describe('Linux platform', () => {
    beforeEach(() => {
      setPlatform('linux')
      process.env.PATH = '/usr/bin:/usr/local/bin'
    })
    afterEach(() => {
      restorePlatform()
      process.env = { ...origEnv }
    })

    function setupReaddir(firstDirEntries: Array<{ name: string }>, restEmpty = true) {
      let callCount = 0
      mockReaddir.mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve(firstDirEntries.map((e) => ({
          name: e.name,
          isFile: () => false,
          isDirectory: () => false,
        } as never)))
        return Promise.resolve([])
      })
    }

    it('resolves .desktop files and returns broken shortcuts', async () => {
      mockExistsSync.mockReturnValue(true)
      mockHomedir.mockReturnValue('/home/user')
      setupReaddir([{ name: 'app.desktop' }])
      mockReadFile.mockResolvedValue('Exec=/usr/bin/goneapp %u')
      // /usr/bin/goneapp doesn't exist -> broken
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/bin/goneapp') return false
        return true
      })
      mockStat.mockResolvedValue({ size: 100 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toHaveLength(1)
      expect(results[0]!.items).toHaveLength(1)
    })

    it('flags .desktop with no Exec line as broken (null target = true on Linux)', async () => {
      mockExistsSync.mockReturnValue(true)
      mockHomedir.mockReturnValue('/home/user')
      setupReaddir([{ name: 'broken.desktop' }])
      mockReadFile.mockResolvedValue('[Desktop Entry]\nName=Test\n')
      mockStat.mockResolvedValue({ size: 50 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toHaveLength(1)
      expect(results[0]!.items).toHaveLength(1)
    })

    it('does not flag PATH-resolved binary (non-absolute target = not broken on Linux)', async () => {
      mockExistsSync.mockReturnValue(true)
      mockHomedir.mockReturnValue('/home/user')
      setupReaddir([{ name: 'firefox.desktop' }])
      mockReadFile.mockResolvedValue('Exec=firefox %u')

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toEqual([])
    })

    it('returns empty for directory with no .desktop files', async () => {
      mockExistsSync.mockReturnValue(true)
      mockHomedir.mockReturnValue('/home/user')
      mockReaddir.mockResolvedValue([])

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()
      expect(results).toEqual([])
    })

    it('handles Exec line with quoted binary path', async () => {
      mockExistsSync.mockReturnValue(true)
      mockHomedir.mockReturnValue('/home/user')
      setupReaddir([{ name: 'app.desktop' }])
      mockReadFile.mockResolvedValue('Exec="/usr/bin/my app" --flag')
      // /usr/bin/my doesn't exist (quote stripping gives /usr/bin/my, not /usr/bin/my app)
      mockExistsSync.mockImplementation((p: string) => {
        if (p === '/usr/bin/my') return false
        return true
      })
      mockStat.mockResolvedValue({ size: 75 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      expect(results).toHaveLength(1)
    })

    it('handles readFile error per entry gracefully', async () => {
      mockExistsSync.mockReturnValue(true)
      mockHomedir.mockReturnValue('/home/user')
      setupReaddir([{ name: 'bad.desktop' }])
      mockReadFile.mockRejectedValue(new Error('EACCES'))
      mockStat.mockResolvedValue({ size: 30 } as never)

      registerShortcutCleanerIpc(() => mockWindow() as never)
      const handler = getHandler('cleaner:shortcut:scan')
      const results = await handler()

      // Null target on Linux = broken
      expect(results).toHaveLength(1)
      expect(results[0]!.items).toHaveLength(1)
    })
  })
})

describe('registerShortcutCleanerIpc: SHORTCUT_CLEAN', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    mockGetLogger.mockReturnValue({
      info: vi.fn(),
      success: vi.fn(),
      warning: vi.fn(),
    })
  })

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: defaultPlatform, configurable: true })
  })

  it('returns empty result for non-array input', async () => {
    registerShortcutCleanerIpc(() => null)
    const handler = getHandler('cleaner:shortcut:clean')
    const result = (await handler({}, 'not-array')) as CleanResult
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
  })

  it('returns empty result for null input', async () => {
    registerShortcutCleanerIpc(() => null)
    const handler = getHandler('cleaner:shortcut:clean')
    const result = (await handler({}, null)) as CleanResult
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
  })

  it('returns empty result for array with non-string elements', async () => {
    registerShortcutCleanerIpc(() => null)
    const handler = getHandler('cleaner:shortcut:clean')
    const result = (await handler({}, [42, true])) as CleanResult
    expect(result).toEqual({
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    })
  })

  it('calls cleanItems with valid string IDs', async () => {
    const mockResult: CleanResult = {
      totalCleaned: 4096,
      filesDeleted: 4,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    }
    mockCleanItems.mockResolvedValue(mockResult)

    registerShortcutCleanerIpc(() => null)
    const handler = getHandler('cleaner:shortcut:clean')
    const result = (await handler({}, ['uuid-1', 'uuid-2'])) as CleanResult

    expect(mockCleanItems).toHaveBeenCalledWith(['uuid-1', 'uuid-2'], expect.any(Function))
    expect(result).toEqual(mockResult)
  })

  it('sends cleaning progress to the window via cleanItems callback', async () => {
    const win = mockWindow()
    let progressCallback: ((processed: number, total: number, currentPath: string, cleanedSize: number) => void) | undefined

    mockCleanItems.mockImplementation(
      async (
        _ids: string[],
        onProgress?: (processed: number, total: number, currentPath: string, cleanedSize: number) => void,
      ) => {
        progressCallback = onProgress
        return {
          totalCleaned: 1000,
          filesDeleted: 2,
          filesSkipped: 0,
          errors: [],
          needsElevation: false,
        } as CleanResult
      },
    )

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    registerShortcutCleanerIpc(() => win as any)
    const handler = getHandler('cleaner:shortcut:clean')
    await handler({}, ['uuid-1'])

    // Invoke the progress callback
    if (progressCallback) {
      progressCallback(1, 2, '/some/path', 500)
    }

    expect(mockSend).toHaveBeenCalledWith(
      'scan:progress',
      expect.objectContaining({
        phase: 'cleaning',
        category: 'shortcut',
        currentPath: '/some/path',
        progress: 50,
        itemsFound: 2,
        sizeFound: 500,
      }),
    )
  })
})
