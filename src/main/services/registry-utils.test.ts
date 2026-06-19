import { describe, expect, it, vi } from 'vitest'
import { REGISTRY_UNINSTALL_PATHS, execReg, extractRegistryKey, parseRegDword, parseRegValue } from './registry-utils'

vi.mock('./exec-utf8', () => ({
  execNativeUtf8: vi.fn((_cmd: string, args: string[], _opts?: unknown) =>
    Promise.resolve({ stdout: `mocked output for ${args.join(' ')}`, stderr: '' }),
  ),
}))

describe('REGISTRY_UNINSTALL_PATHS', () => {
  it('has three standard paths', () => {
    expect(REGISTRY_UNINSTALL_PATHS).toHaveLength(3)
  })

  it('includes HKLM Uninstall path', () => {
    expect(REGISTRY_UNINSTALL_PATHS[0]).toBe('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
  })

  it('includes WOW6432Node path', () => {
    expect(REGISTRY_UNINSTALL_PATHS[1]).toBe('HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
  })

  it('includes HKCU Uninstall path', () => {
    expect(REGISTRY_UNINSTALL_PATHS[2]).toBe('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall')
  })
})

describe('parseRegValue', () => {
  const output = [
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion',
    '    ProgramFilesDir    REG_SZ    C:\\Program Files',
    '    ProgramFilesDir (x86)    REG_SZ    C:\\Program Files (x86)',
    '    CommonFilesDir    REG_EXPAND_SZ    C:\\Program Files\\Common Files',
    '    DevicePath    REG_EXPAND_SZ    %SystemRoot%\\inf',
    '',
  ].join('\r\n')

  it('parses a REG_SZ value from output', () => {
    expect(parseRegValue(output, 'ProgramFilesDir')).toBe('C:\\Program Files')
  })

  it('parses a REG_SZ value with spaces in name', () => {
    expect(parseRegValue(output, 'ProgramFilesDir (x86)')).toBe('C:\\Program Files (x86)')
  })

  it('returns null for REG_EXPAND_SZ values', () => {
    expect(parseRegValue(output, 'CommonFilesDir')).toBeNull()
  })

  it('returns null when value name not found', () => {
    expect(parseRegValue(output, 'NonExistentValue')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(parseRegValue('', 'Test')).toBeNull()
  })

  it('handles value with special regex characters in name', () => {
    const specialOutput = '    Test.Value+1$    REG_SZ    special-path\r\n'
    expect(parseRegValue(specialOutput, 'Test.Value+1$')).toBe('special-path')
  })
})

describe('parseRegDword', () => {
  const output = [
    '    SomeValue    REG_DWORD    0x00000001',
    '    EnableLUA    REG_DWORD    0x00000000',
    '    MaxSize    REG_DWORD    0x00050000',
    '    TextValue    REG_SZ    hello',
  ].join('\r\n')

  it('parses a REG_DWORD value of 1', () => {
    expect(parseRegDword(output, 'SomeValue')).toBe(1)
  })

  it('parses a REG_DWORD value of 0', () => {
    expect(parseRegDword(output, 'EnableLUA')).toBe(0)
  })

  it('parses a larger REG_DWORD value', () => {
    expect(parseRegDword(output, 'MaxSize')).toBe(0x50000)
  })

  it('returns null for REG_SZ values', () => {
    expect(parseRegDword(output, 'TextValue')).toBeNull()
  })

  it('returns null when value name not found', () => {
    expect(parseRegDword(output, 'NonExistent')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(parseRegDword('', 'Test')).toBeNull()
  })
})

describe('extractRegistryKey', () => {
  const output = [
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{App1}',
    '    DisplayName    REG_SZ    My Application',
    '    InstallLocation    REG_SZ    C:\\Program Files\\MyApp',
    '',
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{App2}',
    '    DisplayName    REG_EXPAND_SZ    Another App',
    '    UninstallString    REG_EXPAND_SZ    C:\\Another\\uninstall.exe',
  ].join('\r\n')

  it('extracts a REG_SZ value', () => {
    expect(extractRegistryKey(output, 'DisplayName')).toBe('My Application')
  })

  it('extracts a REG_EXPAND_SZ value', () => {
    const result = extractRegistryKey(output, 'UninstallString')
    expect(result).toBe('C:\\Another\\uninstall.exe')
  })

  it('returns null when display name not found', () => {
    expect(extractRegistryKey(output, 'NonExistent')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(extractRegistryKey('', 'Test')).toBeNull()
  })

  it('handles special characters in display name', () => {
    const specialOutput = '    [Test+Key]    REG_SZ    C:\\path\r\n'
    expect(extractRegistryKey(specialOutput, '[Test+Key]')).toBe('C:\\path')
  })
})

describe('execReg', () => {
  it('calls execNativeUtf8 with reg command', async () => {
    const { execNativeUtf8 } = await import('./exec-utf8')
    const result = await execReg(['query', 'HKLM\\Software', '/v', 'Test'])
    expect(execNativeUtf8).toHaveBeenCalledWith('reg', ['query', 'HKLM\\Software', '/v', 'Test'], undefined)
    expect(result.stdout).toContain('mocked output')
  })

  it('passes options through', async () => {
    const { execNativeUtf8 } = await import('./exec-utf8')
    const opts = { timeout: 5000 }
    await execReg(['query', 'HKLM'], opts)
    expect(execNativeUtf8).toHaveBeenCalledWith('reg', ['query', 'HKLM'], opts)
  })
})
