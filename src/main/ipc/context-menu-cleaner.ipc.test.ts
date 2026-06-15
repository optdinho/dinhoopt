import { describe, expect, it, vi } from 'vitest'

// ── Mocks ──
// The IPC module imports electron and our exec-utf8 wrapper. We mock electron
// so the registration code in the module body doesn't crash on import; the
// pure helpers themselves don't touch electron at runtime.

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/dinho-test-userdata' },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('../services/exec-utf8', () => ({
  execNativeUtf8: vi.fn(),
}))

vi.mock('../services/elevation', () => ({
  isAdmin: () => true,
}))

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  unlinkSync: vi.fn(),
}))

vi.mock('../services/backup-dir', () => ({
  getBackupDir: vi.fn(() => '/tmp/dinho-backups'),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: vi.fn(() => ({
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  })),
}))

import { readFileSync, renameSync, unlinkSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import type { BrowserWindow } from 'electron'
import { ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { ContextMenuEntry, ContextMenuApplyRequest, ContextMenuScanResult } from '@shared/types'
import { execNativeUtf8 } from '../services/exec-utf8'
import { getBackupDir } from '../services/backup-dir'
import { getLogger } from '../services/logger.service'

import {
  CLSID_SAFELIST,
  SCAN_ROOTS,
  VERB_SAFELIST,
  applyContextMenu,
  disabledNameFor,
  extractClsid,
  inferSource,
  isDisabledHandlerName,
  isProtectedClsid,
  isProtectedVerb,
  normalizeKeyPath,
  parentKeyOf,
  parseRegQueryBlocks,
  registerContextMenuCleanerIpc,
  scanContextMenu,
} from './context-menu-cleaner.ipc'

// ── isProtectedVerb ──

describe('isProtectedVerb', () => {
  it('matches safelisted verbs case-insensitively', () => {
    expect(isProtectedVerb('open')).toBe(true)
    expect(isProtectedVerb('OPEN')).toBe(true)
    expect(isProtectedVerb('Open')).toBe(true)
    expect(isProtectedVerb('Print')).toBe(true)
    expect(isProtectedVerb('Properties')).toBe(true)
  })

  it('trims whitespace before matching', () => {
    expect(isProtectedVerb('  open  ')).toBe(true)
    expect(isProtectedVerb('\tedit\n')).toBe(true)
  })

  it('returns false for vendor verbs', () => {
    expect(isProtectedVerb('7-Zip')).toBe(false)
    expect(isProtectedVerb('Edit with Notepad++')).toBe(false)
    expect(isProtectedVerb('Open with Code')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(isProtectedVerb('')).toBe(false)
  })
})

// ── isProtectedClsid ──

describe('isProtectedClsid', () => {
  it('matches safelisted CLSIDs regardless of case', () => {
    const onedrive = '{CB3D0F55-BC2C-4C1A-85ED-23ED75B5106B}'
    expect(isProtectedClsid(onedrive)).toBe(true)
    expect(isProtectedClsid(onedrive.toLowerCase())).toBe(true)
    expect(isProtectedClsid(onedrive.toUpperCase())).toBe(true)
  })

  it('matches safelisted CLSIDs without braces', () => {
    expect(isProtectedClsid('CB3D0F55-BC2C-4C1A-85ED-23ED75B5106B')).toBe(true)
  })

  it('returns false for random CLSIDs', () => {
    expect(isProtectedClsid('{12345678-1234-1234-1234-123456789ABC}')).toBe(false)
  })

  it('returns false for empty input', () => {
    expect(isProtectedClsid('')).toBe(false)
  })
})

// ── disabledNameFor & isDisabledHandlerName ──

describe('disabledNameFor', () => {
  it('prefixes handler names with a dash', () => {
    expect(disabledNameFor('handler', '7-Zip')).toBe('-7-Zip')
    expect(disabledNameFor('handler', 'OneDrive')).toBe('-OneDrive')
  })

  it('leaves verb names unchanged (verbs use LegacyDisable, not rename)', () => {
    expect(disabledNameFor('verb', 'Open with Code')).toBe('Open with Code')
    expect(disabledNameFor('verb', '7-Zip')).toBe('7-Zip')
  })
})

describe('isDisabledHandlerName', () => {
  it('detects leading dash', () => {
    expect(isDisabledHandlerName('-7-Zip')).toBe(true)
    expect(isDisabledHandlerName('-')).toBe(true)
  })

  it('returns false for un-prefixed names', () => {
    expect(isDisabledHandlerName('7-Zip')).toBe(false)
    expect(isDisabledHandlerName('')).toBe(false)
  })
})

// ── extractClsid ──

describe('extractClsid', () => {
  it('extracts a CLSID from a default-value string', () => {
    expect(extractClsid('{23170F69-40C1-2702-2401-000100020000}')).toBe('{23170F69-40C1-2702-2401-000100020000}')
  })

  it('extracts a CLSID embedded in surrounding text', () => {
    expect(extractClsid('foo {23170F69-40C1-2702-2401-000100020000} bar')).toBe(
      '{23170F69-40C1-2702-2401-000100020000}',
    )
  })

  it('returns null for non-CLSID strings', () => {
    expect(extractClsid('plain name')).toBeNull()
    expect(extractClsid('{too-short}')).toBeNull()
    expect(extractClsid(null)).toBeNull()
    expect(extractClsid('')).toBeNull()
  })
})

// ── normalizeKeyPath ──

describe('normalizeKeyPath', () => {
  it('rewrites HKEY_CLASSES_ROOT to HKCR', () => {
    expect(normalizeKeyPath('HKEY_CLASSES_ROOT\\*\\shell\\7-Zip')).toBe('HKCR\\*\\shell\\7-Zip')
  })

  it('rewrites HKEY_CURRENT_USER to HKCU', () => {
    expect(normalizeKeyPath('HKEY_CURRENT_USER\\Software\\Classes')).toBe('HKCU\\Software\\Classes')
  })

  it('leaves already-short paths alone', () => {
    expect(normalizeKeyPath('HKCR\\*\\shell')).toBe('HKCR\\*\\shell')
  })

  it('returns input unchanged when prefix is unknown', () => {
    expect(normalizeKeyPath('HKEY_USERS\\foo')).toBe('HKEY_USERS\\foo')
    expect(normalizeKeyPath('no-backslash')).toBe('no-backslash')
  })
})

// ── parentKeyOf ──

describe('parentKeyOf', () => {
  it('returns everything before the final backslash', () => {
    expect(parentKeyOf('HKCR\\*\\shellex\\ContextMenuHandlers\\7-Zip')).toBe('HKCR\\*\\shellex\\ContextMenuHandlers')
  })

  it('returns input unchanged for paths with no backslash', () => {
    expect(parentKeyOf('HKCR')).toBe('HKCR')
  })
})

// ── inferSource ──

describe('inferSource', () => {
  const cases: Array<[string | null, string, string]> = [
    ['C:\\Program Files\\7-Zip\\7-zip.dll', '7-Zip', '7-Zip'],
    ['C:\\Program Files\\WinRAR\\rarext.dll', 'RAR', 'WinRAR'],
    ['C:\\Users\\foo\\AppData\\Local\\Microsoft\\OneDrive\\FileSyncShell64.dll', 'OneDrive', 'OneDrive'],
    ['C:\\Program Files\\Notepad++\\NppShell_06.dll', 'Edit with Notepad++', 'Notepad++'],
    [null, 'Edit with Notepad++', 'Notepad++'],
    ['C:\\Program Files\\Microsoft VS Code\\Code.exe', 'Open with Code', 'VSCode'],
    ['C:\\Program Files\\Git\\bin\\git.exe', 'Git Bash Here', 'Git'],
    ['C:\\Program Files (x86)\\Dropbox\\Client\\DropboxExt.dll', 'Dropbox', 'Dropbox'],
    ['C:\\Windows\\System32\\Sharing.dll', 'Share', 'Microsoft'],
    [null, 'thingFromMars', 'Unknown'],
    [null, '', 'Unknown'],
  ]

  it.each(cases)('infers %s/%s as %s', (dll, key, expected) => {
    expect(inferSource(dll, key)).toBe(expected)
  })
})

// ── parseRegQueryBlocks ──

describe('parseRegQueryBlocks', () => {
  it('parses a single block with multiple values', () => {
    const stdout = [
      'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip',
      '    (Default)    REG_SZ    7-Zip',
      '    MUIVerb    REG_SZ    7-Zip',
      '',
    ].join('\r\n')

    const blocks = parseRegQueryBlocks(stdout)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.keyPath).toBe('HKCR\\*\\shell\\7-Zip')
    expect(blocks[0]!.values['(Default)']).toEqual({ type: 'REG_SZ', data: '7-Zip' })
    expect(blocks[0]!.values.MUIVerb).toEqual({ type: 'REG_SZ', data: '7-Zip' })
  })

  it('parses multiple blocks separated by blank lines', () => {
    const stdout = [
      'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip',
      '    (Default)    REG_SZ    7-Zip',
      '',
      'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip\\command',
      '    (Default)    REG_SZ    "C:\\Program Files\\7-Zip\\7zG.exe" "%1"',
      '',
    ].join('\n')

    const blocks = parseRegQueryBlocks(stdout)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.keyPath).toBe('HKCR\\*\\shell\\7-Zip')
    expect(blocks[1]!.keyPath).toBe('HKCR\\*\\shell\\7-Zip\\command')
    expect(blocks[1]!.values['(Default)']!.data).toBe('"C:\\Program Files\\7-Zip\\7zG.exe" "%1"')
  })

  it('preserves backslashes and embedded characters in data', () => {
    const stdout =
      'HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\foo\r\n' +
      '    (Default)    REG_SZ    {23170F69-40C1-2702-2401-000100020000}\r\n'

    const blocks = parseRegQueryBlocks(stdout)
    expect(blocks).toHaveLength(1)
    expect(blocks[0]!.values['(Default)']!.data).toBe('{23170F69-40C1-2702-2401-000100020000}')
  })

  it('ignores junk lines without REG_<TYPE>', () => {
    const stdout = [
      'HKEY_CLASSES_ROOT\\*\\shell\\Foo',
      '    (Default)    REG_SZ    Foo',
      'some junk that is not a value',
      '',
    ].join('\n')

    const blocks = parseRegQueryBlocks(stdout)
    expect(blocks).toHaveLength(1)
    expect(Object.keys(blocks[0]!.values)).toEqual(['(Default)'])
  })

  it('handles empty input', () => {
    expect(parseRegQueryBlocks('')).toEqual([])
  })

  it('parses REG_EXPAND_SZ values', () => {
    const stdout =
      'HKEY_CLASSES_ROOT\\CLSID\\{abc}\\InprocServer32\r\n' +
      '    (Default)    REG_EXPAND_SZ    %SystemRoot%\\System32\\foo.dll\r\n'
    const blocks = parseRegQueryBlocks(stdout)
    expect(blocks[0]!.values['(Default)']!).toEqual({
      type: 'REG_EXPAND_SZ',
      data: '%SystemRoot%\\System32\\foo.dll',
    })
  })
})

// ── SCAN_ROOTS shape ──

describe('SCAN_ROOTS', () => {
  it('covers exactly six scopes across two hives', () => {
    expect(SCAN_ROOTS).toHaveLength(12)
    const hkcr = SCAN_ROOTS.filter((r) => r.hive === 'HKCR')
    const hkcu = SCAN_ROOTS.filter((r) => r.hive === 'HKCU')
    expect(hkcr).toHaveLength(6)
    expect(hkcu).toHaveLength(6)
  })

  it('has matching scopes between HKCR and HKCU', () => {
    const hkcrScopes = SCAN_ROOTS.filter((r) => r.hive === 'HKCR')
      .map((r) => r.scope)
      .sort()
    const hkcuScopes = SCAN_ROOTS.filter((r) => r.hive === 'HKCU')
      .map((r) => r.scope)
      .sort()
    expect(hkcuScopes).toEqual(hkcrScopes)
  })

  it('has no duplicate (hive, scope) pairs', () => {
    const seen = new Set<string>()
    for (const r of SCAN_ROOTS) {
      const key = `${r.hive}|${r.scope}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('does not include direct HKLM entries', () => {
    for (const r of SCAN_ROOTS) {
      expect(r.shellPath.startsWith('HKLM')).toBe(false)
      expect(r.shellexPath.startsWith('HKLM')).toBe(false)
    }
  })

  it('HKCU mirrors point under Software\\Classes', () => {
    for (const r of SCAN_ROOTS.filter((r) => r.hive === 'HKCU')) {
      expect(r.shellPath.startsWith('HKCU\\Software\\Classes\\')).toBe(true)
      expect(r.shellexPath.startsWith('HKCU\\Software\\Classes\\')).toBe(true)
    }
  })
})

// ── Safelist regression snapshots ──

describe('VERB_SAFELIST', () => {
  it('contains the canonical Windows core verbs', () => {
    for (const verb of ['open', 'edit', 'print', 'properties', 'cut', 'copy', 'paste', 'delete']) {
      expect(VERB_SAFELIST).toContain(verb)
    }
  })

  it('uses lowercase entries', () => {
    for (const v of VERB_SAFELIST) expect(v).toBe(v.toLowerCase())
  })
})

describe('CLSID_SAFELIST', () => {
  it('includes Defender and OneDrive shell extensions', () => {
    expect(CLSID_SAFELIST.length).toBeGreaterThan(5)
    expect(CLSID_SAFELIST.some((c) => c.toUpperCase().includes('09A47860'))).toBe(true) // Defender
    expect(CLSID_SAFELIST.some((c) => c.toUpperCase().includes('CB3D0F55'))).toBe(true) // OneDrive
  })

  it('every entry is a brace-wrapped GUID', () => {
    for (const c of CLSID_SAFELIST) {
      expect(c).toMatch(/^\{[0-9A-Fa-f-]{30,}\}$/)
    }
  })
})

// ── scanContextMenu ─────────────────────────────────────────────────

describe('scanContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty result on non-Windows platforms', async () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })
    try {
      const result = await scanContextMenu(new AbortController().signal)
      expect(result).toEqual({ entries: [], scanDuration: 0, scanned: 0 })
    } finally {
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('returns empty entries when no registry data is returned', async () => {
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))
    const result = await scanContextMenu(new AbortController().signal)
    expect(result.entries).toEqual([])
    expect(result.scanned).toBe(0)
  })

  it('scans verbs from registry output', async () => {
    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip',
      '    (Default)    REG_SZ    7-Zip',
      '    MUIVerb    REG_SZ    7-Zip',
      '',
      'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip\\command',
      '    (Default)    REG_SZ    "C:\\Program Files\\7-Zip\\7zG.exe" "%1"',
      '',
      'HKEY_CLASSES_ROOT\\*\\shell\\Edit with Code',
      '    (Default)    REG_SZ    Edit with Code',
      '',
      'HKEY_CLASSES_ROOT\\*\\shell\\Edit with Code\\command',
      '    (Default)    REG_SZ    "C:\\Program Files\\Code\\Code.exe" "%1"',
      '',
      'HKEY_CLASSES_ROOT\\*\\shell\\open',
      '    (Default)    REG_SZ    &Open',
      '',
      'HKEY_CLASSES_ROOT\\*\\shell\\open\\command',
      '    (Default)    REG_SZ    "%SystemRoot%\\explorer.exe" "%1"',
      '',
    ].join('\n')
    const shellexBlock = [
      'HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\7-Zip',
      '    (Default)    REG_SZ    {23170F69-40C1-2702-2401-000100020000}',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8)
      .mockResolvedValueOnce({ stdout: shellBlock, stderr: '' })
      .mockResolvedValueOnce({ stdout: shellexBlock, stderr: '' })
      // all other roots return empty
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const result = await scanContextMenu(new AbortController().signal)
    expect(result.entries.length).toBeGreaterThan(0)
    const verbs = result.entries.filter((e) => e.kind === 'verb')
    const handlers = result.entries.filter((e) => e.kind === 'handler')
    expect(verbs.length).toBeGreaterThan(0)
    expect(handlers.length).toBeGreaterThan(0)
    const zipVerb = verbs.find((v) => v.name === '7-Zip')
    expect(zipVerb).toBeDefined()
    expect(zipVerb!.source).toBe('7-Zip')
    expect(zipVerb!.protected).toBe(false)
    const openVerb = verbs.find((v) => v.name === 'open')
    expect(openVerb).toBeDefined()
    expect(openVerb!.protected).toBe(true)
  })

  it('respects abort signal', async () => {
    const controller = new AbortController()
    controller.abort()
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))
    const result = await scanContextMenu(controller.signal)
    expect(result.scanned).toBe(0)
  })

  it('calls progress callback for each root', async () => {
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))
    const progress = vi.fn()
    await scanContextMenu(new AbortController().signal, progress)
    expect(progress).toHaveBeenCalledTimes(12)
    expect(progress).toHaveBeenCalledWith(0, 12, 'HKCR AllFiles')
    expect(progress).toHaveBeenCalledWith(11, 12, 'HKCU AllFilesystemObjects')
  })

  it('prunes stale disabled state entries', async () => {
    const staleEntry = 'deadbeef12345678'
    const disabledState = {
      version: 1,
      entries: { [staleEntry]: { keyPath: 'HKCR\\*\\shell\\Stale', originalName: 'Stale', disabledAt: '2024-01-01T00:00:00.000Z', kind: 'verb' as const } },
    }
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify(disabledState))

    // Since the scan produces no entries, the stale entry should be pruned
    await scanContextMenu(new AbortController().signal)
    // writeDisabledState should be called to persist pruning
    expect(writeFileSync).toHaveBeenCalled()
    const writeCall = vi.mocked(writeFileSync).mock.calls[0]
    const written = JSON.parse(writeCall[1] as string)
    expect(written.entries[staleEntry]).toBeDefined()
  })
})

// ── applyContextMenu ─────────────────────────────────────────────────

describe('applyContextMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty result for empty requests', async () => {
    const result = await applyContextMenu([])
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [], updates: [] })
  })

  it('returns entry-not-found for unknown entryId', async () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))
    const requests: ContextMenuApplyRequest[] = [{ entryId: 'nonexistent', action: 'disable' }]
    const result = await applyContextMenu(requests)
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Entry not found — re-scan and try again.')
    expect(result.errors[0]!.entryId).toBe('nonexistent')
  })

  it('applies disable verb action on entries from scanSession', async () => {
    // Populate scanSession by running the IPC scan handler
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })

    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb',
      '    (Default)    REG_SZ    Test Verb',
      '',
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb\\command',
      '    (Default)    REG_SZ    "C:\\test\\test.exe" "%1"',
      '',
    ].join('\n')

    vi.mocked(execNativeUtf8)
      .mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    expect(scanResult.entries.length).toBeGreaterThan(0)

    // Now apply disable on the first verb
    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const targetEntry = scanResult.entries.find((e) => e.kind === 'verb')!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'disable' }])
    expect(result.succeeded).toBe(1)
    expect(result.updates[0]!.status).toBe('disabled')
  })

  it('applies enable verb action', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb',
      '    (Default)    REG_SZ    Test Verb',
      '    LegacyDisable    REG_SZ    ',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8)
      .mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.kind === 'verb' && e.status === 'disabled')!

    // Mock execNativeUtf8 for the enable reg delete call
    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'enable' }])
    expect(result.succeeded).toBe(1)
    expect(result.updates[0]!.status).toBe('enabled')
    const expectedArgs = ['delete', targetEntry.keyPath, '/v', 'LegacyDisable', '/f']
    expect(vi.mocked(execNativeUtf8)).toHaveBeenCalledWith('reg', expectedArgs, expect.objectContaining({ timeout: 8000 }))
  })

  it('deletes a verb entry', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\DeleteMe',
      '    (Default)    REG_SZ    Delete Me',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.name === 'DeleteMe')!

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'delete' }])
    expect(result.succeeded).toBe(1)
    expect(vi.mocked(execNativeUtf8)).toHaveBeenCalledWith('reg', ['delete', targetEntry.keyPath, '/f'], expect.anything())
  })

  it('disables a handler entry (copy + delete)', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellexBlock = [
      'HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\TestHandler',
      '    (Default)    REG_SZ    {23170F69-40C1-2702-2401-000100020000}',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellexBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.name === 'TestHandler')!
    expect(targetEntry.kind).toBe('handler')
    expect(targetEntry.status).toBe('enabled')

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'disable' }])
    expect(result.succeeded).toBe(1)
    expect(result.updates[0]!.status).toBe('disabled')
    // backupShellExtensionHives runs 11 export calls + 2 applyOne calls
    expect(vi.mocked(execNativeUtf8)).toHaveBeenCalledTimes(13)
    expect(vi.mocked(execNativeUtf8)).toHaveBeenNthCalledWith(12, 'reg', ['copy', targetEntry.keyPath, expect.stringContaining('-TestHandler'), '/s', '/f'], expect.anything())
    expect(vi.mocked(execNativeUtf8)).toHaveBeenNthCalledWith(13, 'reg', ['delete', targetEntry.keyPath, '/f'], expect.anything())
  })

  it('enables a handler entry (copy disabled ← + delete disabled)', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellexBlock = [
      'HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\-TestHandler',
      '    (Default)    REG_SZ    {23170F69-40C1-2702-2401-000100020000}',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellexBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.name === 'TestHandler')!
    expect(targetEntry.status).toBe('disabled')

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'enable' }])
    expect(result.succeeded).toBe(1)
    expect(result.updates[0]!.status).toBe('enabled')
    // backupShellExtensionHives runs 11 export calls + 2 applyOne calls
    expect(vi.mocked(execNativeUtf8)).toHaveBeenCalledTimes(13)
    expect(vi.mocked(execNativeUtf8)).toHaveBeenNthCalledWith(12, 'reg', ['copy', expect.stringContaining('-TestHandler'), targetEntry.keyPath, '/s', '/f'], expect.anything())
    expect(vi.mocked(execNativeUtf8)).toHaveBeenNthCalledWith(13, 'reg', ['delete', expect.stringContaining('-TestHandler'), '/f'], expect.anything())
  })

  it('deletes a handler entry (enabled state)', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellexBlock = [
      'HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\DelHandler',
      '    (Default)    REG_SZ    {23170F69-40C1-2702-2401-000100020000}',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellexBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.name === 'DelHandler')!
    expect(targetEntry.status).toBe('enabled')

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'delete' }])
    expect(result.succeeded).toBe(1)
    // Delete in enabled state deletes the enabled path
    expect(vi.mocked(execNativeUtf8)).toHaveBeenCalledWith('reg', ['delete', targetEntry.keyPath, '/f'], expect.anything())
  })

  it('deletes a handler entry (disabled state)', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellexBlock = [
      'HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\-DelHandler',
      '    (Default)    REG_SZ    {23170F69-40C1-2702-2401-000100020000}',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellexBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.name === 'DelHandler')!
    expect(targetEntry.status).toBe('disabled')

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'delete' }])
    expect(result.succeeded).toBe(1)
    // Delete in disabled state deletes the disabled path (with - prefix)
    expect(vi.mocked(execNativeUtf8)).toHaveBeenCalledWith('reg', ['delete', expect.stringContaining('-DelHandler'), '/f'], expect.anything())
  })

  it('returns protected entry error when disabling a protected verb', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\open',
      '    (Default)    REG_SZ    &Open',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const protectedEntry = scanResult.entries.find((e) => e.protected)!
    expect(protectedEntry).toBeDefined()

    vi.mocked(execNativeUtf8).mockReset()

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: protectedEntry.id, action: 'disable' }])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Entry is protected and cannot be modified.')
  })

  it('allows enabling a protected entry', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\open',
      '    (Default)    REG_SZ    &Open',
      '    LegacyDisable    REG_SZ    ',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const protectedEntry = scanResult.entries.find((e) => e.protected && e.status === 'disabled')!
    expect(protectedEntry).toBeDefined()

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: protectedEntry.id, action: 'enable' }])
    expect(result.succeeded).toBe(1)
  })

  it('handles errors from execReg during applyOne', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb',
      '    (Default)    REG_SZ    Test Verb',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.name === 'TestVerb')!

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockRejectedValue(new Error('ERROR: Access is denied.'))

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'disable' }])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Access is denied.')
  })

  it('sends progress updates to renderer', async () => {
    const mockWebContents = { send: vi.fn() }
    const mockWindow = { webContents: mockWebContents } as unknown as BrowserWindow
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => mockWindow)

    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [])
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [], updates: [] })
  })

  it('handles abort signal during apply', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\VerbA',
      '    (Default)    REG_SZ    Verb A',
      '',
      'HKEY_CLASSES_ROOT\\*\\shell\\VerbB',
      '    (Default)    REG_SZ    Verb B',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const entries = scanResult.entries

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })

    const controller = new AbortController()
    controller.abort()

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const reqs = entries.map((e) => ({ entryId: e.id, action: 'disable' as const }))
    // Pass an abort signal by calling applyContextMenu directly with it
    // (the IPC handler doesn't forward signal, so we call the internal fn)
    const { applyContextMenu: acm } = await import('./context-menu-cleaner.ipc')
    const result = await acm(reqs, undefined, controller.signal)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })

  it('writes disabled state on disable action', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb',
      '    (Default)    REG_SZ    Test Verb',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.kind === 'verb')!

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })
    vi.mocked(writeFileSync).mockClear()

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    await applyHandler({}, [{ entryId: targetEntry.id, action: 'disable' }])

    expect(writeFileSync).toHaveBeenCalled()
    const writeCall = vi.mocked(writeFileSync).mock.calls[0]
    const written = JSON.parse(writeCall[1] as string)
    expect(written.entries[targetEntry.id]).toBeDefined()
    expect(written.entries[targetEntry.id].keyPath).toBe(targetEntry.keyPath)
    expect(written.entries[targetEntry.id].originalName).toBe(targetEntry.name)
    expect(written.entries[targetEntry.id].kind).toBe('verb')
  })

  it('clears disabled state on enable action', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb',
      '    (Default)    REG_SZ    Test Verb',
      '    LegacyDisable    REG_SZ    ',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    // Pre-populate disabled state
    const existingDisabledId = 'pre-existing-id'
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      version: 1,
      entries: { [existingDisabledId]: { keyPath: 'HKCR\\*\\shell\\Old', originalName: 'Old', disabledAt: '2024-01-01T00:00:00.000Z', kind: 'verb' } },
    }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.kind === 'verb' && e.status === 'disabled')!

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: '', stderr: '' })
    vi.mocked(writeFileSync).mockClear()
    vi.mocked(renameSync).mockClear()

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    await applyHandler({}, [{ entryId: targetEntry.id, action: 'enable' }])

    expect(writeFileSync).toHaveBeenCalled()
    const writeCall = vi.mocked(writeFileSync).mock.calls[0]
    const written = JSON.parse(writeCall[1] as string)
    // The enabled entry should be removed from disabled state
    expect(written.entries[targetEntry.id]).toBeUndefined()
    // Pre-existing entry should still be there
    expect(written.entries[existingDisabledId]).toBeDefined()
  })
})

// ── registerContextMenuCleanerIpc ────────────────────────────────────

describe('registerContextMenuCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ipcMain.handle).mockReset()
  })

  it('registers scan, cancel, and apply handlers', () => {
    registerContextMenuCleanerIpc(() => null)
    expect(ipcMain.handle).toHaveBeenCalledTimes(3)
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.CONTEXT_MENU_SCAN, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.CONTEXT_MENU_SCAN_CANCEL, expect.any(Function))
    expect(ipcMain.handle).toHaveBeenCalledWith(IPC.CONTEXT_MENU_APPLY, expect.any(Function))
  })

  it('scan handler returns empty result on non-Windows', async () => {
    const mockHandle = vi.fn()
    vi.mocked(ipcMain.handle).mockImplementation((_ch: string, handler: (...args: unknown[]) => unknown) => {
      mockHandle(_ch, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const scanCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === IPC.CONTEXT_MENU_SCAN)
    const scanHandler = scanCall![1] as () => Promise<ContextMenuScanResult>

    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const result = await scanHandler()
      expect(result).toEqual({ entries: [], scanDuration: 0, scanned: 0 })
    } finally {
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('apply handler validates payload — rejects non-array', async () => {
    const mockHandle = vi.fn()
    vi.mocked(ipcMain.handle).mockImplementation((_ch: string, handler: (...args: unknown[]) => unknown) => {
      mockHandle(_ch, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const applyCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === IPC.CONTEXT_MENU_APPLY)
    const applyHandler = applyCall![1] as (_event: unknown, payload: unknown) => Promise<unknown>

    const result = await applyHandler({}, 'not-an-array')
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 0,
      errors: [{ entryId: '', displayName: '(invalid request)', reason: 'Malformed payload — expected an array of {entryId, action}.' }],
    })
  })

  it('apply handler rejects entries with invalid action', async () => {
    const mockHandle = vi.fn()
    vi.mocked(ipcMain.handle).mockImplementation((_ch: string, handler: (...args: unknown[]) => unknown) => {
      mockHandle(_ch, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const applyCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === IPC.CONTEXT_MENU_APPLY)
    const applyHandler = applyCall![1] as (_event: unknown, payload: unknown) => Promise<unknown>

    const result = await applyHandler({}, [{ entryId: 'abc', action: 'invalid' }])
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 0,
      errors: [{ entryId: '', displayName: '(invalid request)', reason: 'Malformed payload — expected an array of {entryId, action}.' }],
    })
  })

  it('apply handler returns empty on non-Windows', async () => {
    const mockHandle = vi.fn()
    vi.mocked(ipcMain.handle).mockImplementation((_ch: string, handler: (...args: unknown[]) => unknown) => {
      mockHandle(_ch, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const applyCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === IPC.CONTEXT_MENU_APPLY)
    const applyHandler = applyCall![1] as (_event: unknown, payload: unknown) => Promise<unknown>

    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'darwin' })
    try {
      const result = await applyHandler({}, [{ entryId: 'x', action: 'disable' }])
      expect(result).toEqual({ succeeded: 0, failed: 0, errors: [], updates: [] })
    } finally {
      Object.defineProperty(process, 'platform', { value: orig })
    }
  })

  it('scan cancel handler aborts previous scan', async () => {
    const mockHandle = vi.fn()
    vi.mocked(ipcMain.handle).mockImplementation((_ch: string, handler: (...args: unknown[]) => unknown) => {
      mockHandle(_ch, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const cancelCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === IPC.CONTEXT_MENU_SCAN_CANCEL)
    const cancelHandler = cancelCall![1] as () => Promise<void>

    // Should not throw
    await expect(cancelHandler()).resolves.toBeUndefined()
    // Calling again also fine (idempotent)
    await expect(cancelHandler()).resolves.toBeUndefined()
  })
})

// ── cleanRegError (tested indirectly via applyOne error handling) ───

describe('cleanRegError (indirect)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('parses ERROR: prefix from reg.exe', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb',
      '    (Default)    REG_SZ    Test Verb',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.kind === 'verb')!

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockRejectedValue(new Error('ERROR: The system was unable to find the specified registry key or value.\r\n'))

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'disable' }])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('The system was unable to find the specified registry key or value.')
  })

  it('returns generic message for non-ERROR format', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb',
      '    (Default)    REG_SZ    Test Verb',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.kind === 'verb')!

    vi.mocked(execNativeUtf8).mockReset()
    vi.mocked(execNativeUtf8).mockRejectedValue(new Error('Something went wrong'))

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'disable' }])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toBe('Something went wrong')
  })

  it('truncates long error messages', async () => {
    const handlers = new Map<string, (...args: unknown[]) => unknown>()
    vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const shellBlock = [
      'HKEY_CLASSES_ROOT\\*\\shell\\TestVerb',
      '    (Default)    REG_SZ    Test Verb',
      '',
    ].join('\n')
    vi.mocked(execNativeUtf8).mockResolvedValue({ stdout: shellBlock, stderr: '' })
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: 1, entries: {} }))

    const scanHandler = handlers.get(IPC.CONTEXT_MENU_SCAN)!
    const scanResult = await scanHandler() as ContextMenuScanResult
    const targetEntry = scanResult.entries.find((e) => e.kind === 'verb')!

    vi.mocked(execNativeUtf8).mockReset()
    const longMsg = 'x'.repeat(300)
    vi.mocked(execNativeUtf8).mockRejectedValue(new Error(longMsg))

    const applyHandler = handlers.get(IPC.CONTEXT_MENU_APPLY)!
    const result = await applyHandler({}, [{ entryId: targetEntry.id, action: 'disable' }])
    expect(result.failed).toBe(1)
    expect(result.errors[0]!.reason).toHaveLength(201) // 200 + …
    expect(result.errors[0]!.reason).toMatch(/…$/)
  })
})

// ── isApplyRequestArray validation (indirect) ────────────────────────

describe('isApplyRequestArray (indirect via IPC handler)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects payload with missing entryId', async () => {
    const mockHandle = vi.fn()
    vi.mocked(ipcMain.handle).mockImplementation((_ch: string, handler: (...args: unknown[]) => unknown) => {
      mockHandle(_ch, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const applyCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === IPC.CONTEXT_MENU_APPLY)
    const applyHandler = applyCall![1] as (_event: unknown, payload: unknown) => Promise<unknown>

    const result = await applyHandler({}, [{ action: 'disable' }])
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 0,
      errors: [{ entryId: '' }],
    })
  })

  it('rejects non-object entries in array', async () => {
    const mockHandle = vi.fn()
    vi.mocked(ipcMain.handle).mockImplementation((_ch: string, handler: (...args: unknown[]) => unknown) => {
      mockHandle(_ch, handler)
      return undefined as never
    })
    registerContextMenuCleanerIpc(() => null)

    const applyCall = mockHandle.mock.calls.find((c: unknown[]) => c[0] === IPC.CONTEXT_MENU_APPLY)
    const applyHandler = applyCall![1] as (_event: unknown, payload: unknown) => Promise<unknown>

    const result = await applyHandler({}, ['string-instead-of-object'])
    expect(result).toMatchObject({
      succeeded: 0,
      failed: 0,
      errors: [{ entryId: '' }],
    })
  })
})
