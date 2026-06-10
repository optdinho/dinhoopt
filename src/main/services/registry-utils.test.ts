import { describe, it, expect, vi } from 'vitest'
import {
  execReg,
  REGISTRY_UNINSTALL_PATHS,
  parseRegValue,
  parseRegDword,
  extractRegistryKey,
} from './registry-utils'

vi.mock('./exec-utf8', () => ({
  execNativeUtf8: vi.fn(),
}))

import { execNativeUtf8 } from './exec-utf8'
const mockedExec = vi.mocked(execNativeUtf8)

describe('REGISTRY_UNINSTALL_PATHS', () => {
  it('contains three paths', () => {
    expect(REGISTRY_UNINSTALL_PATHS).toHaveLength(3)
  })

  it('includes HKLM Uninstall', () => {
    expect(REGISTRY_UNINSTALL_PATHS[0]).toBe(
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    )
  })

  it('includes HKLM WOW6432Node Uninstall', () => {
    expect(REGISTRY_UNINSTALL_PATHS[1]).toBe(
      'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    )
  })

  it('includes HKCU Uninstall', () => {
    expect(REGISTRY_UNINSTALL_PATHS[2]).toBe(
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    )
  })
})

describe('execReg', () => {
  it('calls execNativeUtf8 with reg and args', async () => {
    mockedExec.mockResolvedValue({ stdout: 'output', stderr: '' })
    const result = await execReg(['query', 'HKLM\\Software', '/v', 'Test'])
    expect(mockedExec).toHaveBeenCalledWith(
      'reg',
      ['query', 'HKLM\\Software', '/v', 'Test'],
      undefined
    )
    expect(result.stdout).toBe('output')
  })

  it('passes opts through', async () => {
    mockedExec.mockResolvedValue({ stdout: '', stderr: '' })
    const signal = new AbortController().signal
    await execReg(['query', 'HKLM'], { timeout: 5000, signal })
    expect(mockedExec).toHaveBeenCalledWith('reg', ['query', 'HKLM'], {
      timeout: 5000,
      signal,
    })
  })

  it('forwards rejection from execNativeUtf8', async () => {
    mockedExec.mockRejectedValue(new Error('reg failed'))
    await expect(execReg(['invalid'])).rejects.toThrow('reg failed')
  })
})

describe('parseRegValue', () => {
  const output = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion',
    '    ProgramName    REG_SZ    My Cool Program',
    '    DisplayVersion    REG_SZ    1.0.0',
    '    EmptyValue    REG_SZ    ',
    '    Publisher    REG_SZ    Acme Corp',
    '    NoMatchType    REG_EXPAND_SZ    %SYSTEMROOT%\\test',
    '',
  ].join('\n')

  it('parses a REG_SZ value', () => {
    expect(parseRegValue(output, 'ProgramName')).toBe('My Cool Program')
  })

  it('parses a REG_SZ with version', () => {
    expect(parseRegValue(output, 'DisplayVersion')).toBe('1.0.0')
  })



  it('returns null for missing value', () => {
    expect(parseRegValue(output, 'NonExistent')).toBeNull()
  })

  it('is case-insensitive for value name', () => {
    expect(parseRegValue(output, 'programname')).toBe('My Cool Program')
  })

  it('handles empty output', () => {
    expect(parseRegValue('', 'Test')).toBeNull()
  })

  it('handles output with only newlines', () => {
    expect(parseRegValue('\n\n\n', 'Test')).toBeNull()
  })
})

describe('parseRegDword', () => {
  const output = [
    '    DebugMode    REG_DWORD    0x1',
    '    MaxItems    REG_DWORD    0x00000fff',
    '    Disabled    REG_DWORD    0x0',
    '    SomeText    REG_SZ    hello',
  ].join('\n')

  it('parses a simple DWORD', () => {
    expect(parseRegDword(output, 'DebugMode')).toBe(1)
  })

  it('parses a multi-byte DWORD', () => {
    expect(parseRegDword(output, 'MaxItems')).toBe(4095)
  })

  it('parses zero DWORD', () => {
    expect(parseRegDword(output, 'Disabled')).toBe(0)
  })

  it('returns null for REG_SZ value (not DWORD)', () => {
    expect(parseRegDword(output, 'SomeText')).toBeNull()
  })

  it('returns null for missing value', () => {
    expect(parseRegDword(output, 'NonExistent')).toBeNull()
  })

  it('is case-insensitive for value name', () => {
    expect(parseRegDword(output, 'debugmode')).toBe(1)
  })

  it('handles empty output', () => {
    expect(parseRegDword('', 'Test')).toBeNull()
  })
})

describe('extractRegistryKey', () => {
  const output = [
    '    InstallPath    REG_SZ    C:\\Program Files\\MyApp',
    '    IconPath    REG_EXPAND_SZ    %ProgramFiles%\\MyApp\\icon.ico',
    '    MultiLine    REG_MULTI_SZ    line1\n    line2',
  ].join('\n')

  it('extracts a REG_SZ path', () => {
    expect(extractRegistryKey(output, 'InstallPath')).toBe('C:\\Program Files\\MyApp')
  })

  it('extracts a REG_EXPAND_SZ path', () => {
    expect(extractRegistryKey(output, 'IconPath')).toBe('%ProgramFiles%\\MyApp\\icon.ico')
  })

  it('extracts first line of a REG_MULTI_SZ value', () => {
    expect(extractRegistryKey(output, 'MultiLine')).toBe('line1')
  })

  it('returns null for missing key', () => {
    expect(extractRegistryKey(output, 'NonExistent')).toBeNull()
  })

  it('is case-insensitive for display name', () => {
    expect(extractRegistryKey(output, 'installpath')).toBe('C:\\Program Files\\MyApp')
  })

  it('handles empty output', () => {
    expect(extractRegistryKey('', 'Test')).toBeNull()
  })
})
