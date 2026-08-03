import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getPathMock = vi.fn()
const readFileSyncMock = vi.fn()
const writeFileSyncMock = vi.fn()
const renameSyncMock = vi.fn()
const execRegMock = vi.fn()
const infoMock = vi.fn()
const warningMock = vi.fn()
const successMock = vi.fn()

vi.mock('electron', () => ({
  app: { getPath: (...a: unknown[]) => getPathMock(...a) },
}))

vi.mock('node:fs', () => ({
  readFileSync: (...a: unknown[]) => readFileSyncMock(...a),
  writeFileSync: (...a: unknown[]) => writeFileSyncMock(...a),
  renameSync: (...a: unknown[]) => renameSyncMock(...a),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => ({ info: infoMock, warning: warningMock, success: successMock, error: vi.fn(), debug: vi.fn() }),
}))

vi.mock('../services/registry-utils', () => ({
  execReg: (...a: unknown[]) => execRegMock(...a),
}))

let mod: typeof import('./context-menu-scan')

const USER_DATA = 'C:\\Users\\t\\dinho'

beforeEach(async () => {
  vi.clearAllMocks()
  getPathMock.mockReturnValue(USER_DATA)
  readFileSyncMock.mockImplementation(() => {
    throw new Error('ENOENT')
  })
  execRegMock.mockResolvedValue({ stdout: '' })
  mod = await import('./context-menu-scan')
})

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32' })
})

describe('pure helpers', () => {
  it('normalizeKeyPath converts long hive names', () => {
    expect(mod.normalizeKeyPath('HKEY_CLASSES_ROOT\\x\\shell')).toBe('HKCR\\x\\shell')
    expect(mod.normalizeKeyPath('HKEY_CURRENT_USER\\a')).toBe('HKCU\\a')
    expect(mod.normalizeKeyPath('HKCR\\b')).toBe('HKCR\\b')
    expect(mod.normalizeKeyPath('HKEY_LOCAL_MACHINE\\c')).toBe('HKEY_LOCAL_MACHINE\\c')
    expect(mod.normalizeKeyPath('no-backslash')).toBe('no-backslash')
  })

  it('parentKeyOf splits on the final backslash', () => {
    expect(mod.parentKeyOf('A\\B\\C')).toBe('A\\B')
    expect(mod.parentKeyOf('single')).toBe('single')
  })

  it('disabledNameFor prefixes handler keys only', () => {
    expect(mod.disabledNameFor('handler', 'MyApp')).toBe('-MyApp')
    expect(mod.disabledNameFor('verb', 'RunMe')).toBe('RunMe')
  })

  it('isDisabledHandlerName detects the dash prefix', () => {
    expect(mod.isDisabledHandlerName('-App')).toBe(true)
    expect(mod.isDisabledHandlerName('App')).toBe(false)
  })

  it('isProtectedVerb is case-insensitive and trims', () => {
    expect(mod.isProtectedVerb('open')).toBe(true)
    expect(mod.isProtectedVerb(' Open ')).toBe(true)
    expect(mod.isProtectedVerb('OPEN')).toBe(true)
    expect(mod.isProtectedVerb('my-custom-verb')).toBe(false)
  })

  it('isProtectedClsid matches the safelist', () => {
    expect(mod.isProtectedClsid('{09A47860-11B0-4DA5-AFA5-26D86198A780}')).toBe(true)
    expect(mod.isProtectedClsid('{aaaa1111-0000-0000-0000-000000000000}')).toBe(false)
    expect(mod.isProtectedClsid('')).toBe(false)
  })

  it('extractClsid returns canonical GUIDs', () => {
    expect(mod.extractClsid('value {ABCD1234-0000-0000-0000-000000000001} more')).toBe(
      '{ABCD1234-0000-0000-0000-000000000001}',
    )
    expect(mod.extractClsid('no guid')).toBeNull()
    expect(mod.extractClsid(null)).toBeNull()
    expect(mod.extractClsid(undefined)).toBeNull()
  })

  it('inferSource matches patterns with priority', () => {
    expect(mod.inferSource(null, 'OneDrive')).toBe('OneDrive')
    expect(mod.inferSource(null, '7-Zip')).toBe('7-Zip')
    expect(mod.inferSource('C:\\rar\\WinRAR\\rarext.dll', 'x')).toBe('WinRAR')
    expect(mod.inferSource('C:\\x\\nppshell.dll', 'x')).toBe('Notepad++')
    expect(mod.inferSource('C:\\Program Files\\Microsoft VS Code\\code.exe', 'x')).toBe('VSCode')
    expect(mod.inferSource(null, 'defender')).toBe('Defender')
    expect(mod.inferSource('C:\\git\\git-bash.exe', 'x')).toBe('Git')
    expect(mod.inferSource(null, 'dropbox')).toBe('Dropbox')
    expect(mod.inferSource(null, 'googlephotos')).toBe('Google Drive')
    expect(mod.inferSource(null, 'powertoys')).toBe('PowerToys')
    expect(mod.inferSource('C:\\Windows\\System32\\shell32.dll', 'x')).toBe('Microsoft')
    expect(mod.inferSource(null, 'MysteryApp')).toBe('Unknown')
  })
})

describe('parseRegQueryBlocks', () => {
  const sample = [
    'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip',
    '    (Default)    REG_SZ    7-Zip',
    '    MUIVerb    REG_SZ    7-Zip',
    '',
    'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip\\command',
    '    (Default)    REG_SZ    "C:\\Program Files\\7-Zip\\7zG.exe" "%1"',
    '',
  ].join('\r\n')

  it('parses verb + command blocks', () => {
    const blocks = mod.parseRegQueryBlocks(sample)
    expect(blocks).toHaveLength(2)
    expect(blocks[0]!.keyPath).toBe('HKCR\\*\\shell\\7-Zip')
    expect(blocks[0]!.values.MUIVerb?.data).toBe('7-Zip')
    expect(blocks[1]!.values['(Default)']?.data).toContain('7zG.exe')
  })

  it('handles CRLF, blank separators and final block without trailing blank', () => {
    const out = mod.parseRegQueryBlocks('HKEY_CURRENT_USER\\a\n    (Default)    REG_SZ    x\n')
    expect(out).toHaveLength(1)
    expect(out[0]!.keyPath).toBe('HKCU\\a')
  })

  it('ignores non-HKEY headers and malformed value lines', () => {
    const out = mod.parseRegQueryBlocks('  weird header\nHKEY_CLASSES_ROOT\\b\n    (Default)  no-type-padding\n')
    expect(out).toHaveLength(1)
    expect(out[0]!.values).toEqual({})
  })

  it('flushes the current block when a new header appears without blank line', () => {
    const out = mod.parseRegQueryBlocks('HKEY_CLASSES_ROOT\\c\n    (Default)    REG_SZ    y\nHKEY_CLASSES_ROOT\\d\n')
    expect(out.map((b) => b.keyPath)).toEqual(['HKCR\\c', 'HKCR\\d'])
  })

  it('returns empty for empty input', () => {
    expect(mod.parseRegQueryBlocks('')).toEqual([])
  })
})

describe('disabled state persistence', () => {
  it('readDisabledState returns empty when the file is missing', () => {
    expect(mod.readDisabledState()).toEqual({ version: 1, entries: {} })
  })

  it('readDisabledState returns empty and warns on version mismatch', () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ version: 99, entries: {} }))
    expect(mod.readDisabledState()).toEqual({ version: 1, entries: {} })
    expect(warningMock).toHaveBeenCalled()
  })

  it('readDisabledState returns parsed entries when valid', () => {
    const state = { version: 1, entries: { abc: { keyPath: 'x', originalName: 'y', disabledAt: 't', kind: 'verb' } } }
    readFileSyncMock.mockReturnValue(JSON.stringify(state))
    expect(mod.readDisabledState()).toEqual(state)
  })

  it('readDisabledState returns empty on corrupt JSON', () => {
    readFileSyncMock.mockReturnValue('{not json')
    expect(mod.readDisabledState()).toEqual({ version: 1, entries: {} })
  })

  it('writeDisabledState writes a tmp file then renames it', () => {
    mod.writeDisabledState({ version: 1, entries: { a: {} } } as never)
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('context-menu-disabled.json.tmp'),
      expect.any(String),
      'utf-8',
    )
    expect(renameSyncMock).toHaveBeenCalled()
  })
})

describe('scanContextMenu', () => {
  const verbOutput = [
    'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip',
    '    (Default)    REG_SZ    7-Zip',
    '    MUIVerb    REG_SZ    7-Zip',
    '',
    'HKEY_CLASSES_ROOT\\*\\shell\\7-Zip\\command',
    '    (Default)    REG_SZ    "C:\\Program Files\\7-Zip\\7zG.exe" "%1"',
    '',
  ].join('\r\n')

  const handlerOutput = [
    'HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\MyApp',
    '    (Default)    REG_SZ    {00000000-0000-0000-0000-000000000001}',
    '',
  ].join('\r\n')

  function mockRootQueries(): void {
    execRegMock.mockImplementation(async (args: string[]) => {
      const path = args[1]
      if (path === 'HKCR\\*\\shell') return { stdout: verbOutput }
      if (path === 'HKCR\\*\\shellex\\ContextMenuHandlers') return { stdout: handlerOutput }
      return { stdout: '' }
    })
  }

  it('returns empty on non-win32 platforms', async () => {
    Object.defineProperty(process, 'platform', { value: 'linux' })
    const result = await mod.scanContextMenu(new AbortController().signal)
    expect(result).toEqual({ entries: [], scanDuration: 0, scanned: 0 })
    expect(execRegMock).not.toHaveBeenCalled()
  })

  it('returns early on an already-aborted signal', async () => {
    const controller = new AbortController()
    controller.abort()
    const result = await mod.scanContextMenu(controller.signal)
    expect(result.entries).toEqual([])
    expect(execRegMock).not.toHaveBeenCalled()
  })

  it('returns empty when every root query yields nothing', async () => {
    const progress = vi.fn()
    const result = await mod.scanContextMenu(new AbortController().signal, progress)
    expect(result.entries).toEqual([])
    expect(result.scanned).toBe(0)
    expect(progress).toHaveBeenCalled()
    expect(infoMock).toHaveBeenCalled()
    expect(successMock).toHaveBeenCalled()
  })

  it('collects verb and handler entries from the first root', async () => {
    mockRootQueries()
    const result = await mod.scanContextMenu(new AbortController().signal)
    expect(result.entries).toHaveLength(2)
    expect(result.scanned).toBe(2)

    const verb = result.entries.find((e) => e.kind === 'verb')!
    expect(verb).toMatchObject({
      kind: 'verb',
      name: '7-Zip',
      keyPath: 'HKCR\\*\\shell\\7-Zip',
      hive: 'HKCR',
      scope: 'AllFiles',
      displayName: '7-Zip',
      command: '"C:\\Program Files\\7-Zip\\7zG.exe" "%1"',
      source: '7-Zip',
      status: 'enabled',
      protected: false,
      requiresAdmin: true,
    })

    const handler = result.entries.find((e) => e.kind === 'handler')!
    expect(handler).toMatchObject({
      kind: 'handler',
      name: 'MyApp',
      displayName: 'MyApp',
      status: 'enabled',
      source: 'Unknown',
      requiresAdmin: true,
    })
    expect(handler.clsid).toBe('{00000000-0000-0000-0000-000000000001}')
  })

  it('prunes stale disabled-state entries for re-enabled entries', async () => {
    mockRootQueries()
    const verbId = createHash('sha1').update('HKCR\\*\\shell\\7-Zip|7-Zip').digest('hex').substring(0, 16)
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        version: 1,
        entries: {
          [verbId]: { keyPath: 'HKCR\\*\\shell\\7-Zip', originalName: '7-Zip', disabledAt: 't', kind: 'verb' },
        },
      }),
    )
    await mod.scanContextMenu(new AbortController().signal)
    expect(writeFileSyncMock).toHaveBeenCalled()
  })

  it('tolerates execReg failures per root', async () => {
    execRegMock.mockRejectedValue(new Error('access denied'))
    const result = await mod.scanContextMenu(new AbortController().signal)
    expect(result.entries).toEqual([])
  })

  it('marks a verb as disabled when LegacyDisable is present', async () => {
    execRegMock.mockImplementation(async (args: string[]) => {
      const path = args[1]
      if (path === 'HKCR\\*\\shell') {
        return {
          stdout: [
            'HKEY_CLASSES_ROOT\\*\\shell\\LegacyVerb',
            '    (Default)    REG_SZ    Legacy',
            '    LegacyDisable    REG_SZ    ',
            '',
          ].join('\r\n'),
        }
      }
      return { stdout: '' }
    })
    const result = await mod.scanContextMenu(new AbortController().signal)
    const verb = result.entries.find((e) => e.name === 'LegacyVerb')!
    expect(verb.status).toBe('disabled')
  })

  it('marks a handler as disabled when the subkey is dash-prefixed', async () => {
    execRegMock.mockImplementation(async (args: string[]) => {
      const path = args[1]
      if (path === 'HKCR\\*\\shellex\\ContextMenuHandlers') {
        return {
          stdout: 'HKEY_CLASSES_ROOT\\*\\shellex\\ContextMenuHandlers\\-OldThing\n',
        }
      }
      return { stdout: '' }
    })
    const result = await mod.scanContextMenu(new AbortController().signal)
    const handler = result.entries.find((e) => e.kind === 'handler')!
    expect(handler.name).toBe('OldThing')
    expect(handler.status).toBe('disabled')
  })
})
