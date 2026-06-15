import { describe, expect, it } from 'vitest'
import { convertWinapp2Vars, parseWinapp2 } from './winapp2-import.ipc'

describe('convertWinapp2Vars', () => {
  it('converts %AppData% to ${APPDATA}', () => {
    expect(convertWinapp2Vars('%AppData%\\SomeApp')).toBe('${APPDATA}\\SomeApp')
  })

  it('converts %LocalAppData% to ${LOCALAPPDATA}', () => {
    expect(convertWinapp2Vars('%LocalAppData%\\Temp')).toBe('${LOCALAPPDATA}\\Temp')
  })

  it('converts %ProgramFiles% to ${PROGRAMFILES}', () => {
    expect(convertWinapp2Vars('%ProgramFiles%\\App')).toBe('${PROGRAMFILES}\\App')
  })

  it('converts %ProgramFiles(x86)% to ${PROGRAMFILES_X86}', () => {
    expect(convertWinapp2Vars('%ProgramFiles(x86)%\\App')).toBe('${PROGRAMFILES_X86}\\App')
  })

  it('converts %WinDir% to ${WINDIR}', () => {
    expect(convertWinapp2Vars('%WinDir%\\Temp')).toBe('${WINDIR}\\Temp')
  })

  it('converts %UserProfile% to ${HOME}', () => {
    expect(convertWinapp2Vars('%UserProfile%\\App')).toBe('${HOME}\\App')
  })

  it('converts %SystemDrive% to ${SYSTEMDRIVE}', () => {
    expect(convertWinapp2Vars('%SystemDrive%\\Temp')).toBe('${SYSTEMDRIVE}\\Temp')
  })

  it('converts %Temp% to ${LOCALAPPDATA}\\Temp', () => {
    expect(convertWinapp2Vars('%Temp%\\cache')).toBe('${LOCALAPPDATA}\\Temp\\cache')
  })

  it('converts %Documents% to ${HOME}\\Documents', () => {
    expect(convertWinapp2Vars('%Documents%\\MyApp')).toBe('${HOME}\\Documents\\MyApp')
  })

  it('handles mixed variables in one string', () => {
    expect(convertWinapp2Vars('%AppData%\\App\\%WinDir%\\Temp')).toBe('${APPDATA}\\App\\${WINDIR}\\Temp')
  })

  it('leaves normal paths unchanged', () => {
    expect(convertWinapp2Vars('C:\\Temp\\test')).toBe('C:\\Temp\\test')
  })
})

describe('parseWinapp2', () => {
  it('parses a normal section header', () => {
    const content = '[Test Section]\r\nLangSecRef=302\r\nDefault=True\r\n'
    const result = parseWinapp2(content)
    expect(result.sections).toHaveLength(1)
    expect(result.sections[0]!.sectionName).toBe('Test Section')
    expect(result.sections[0]!.suffix).toBe('')
    expect(result.sections[0]!.langSecRef).toBe(302)
    expect(result.sections[0]!.default).toBe(true)
  })

  it('parses a warning section (* suffix)', () => {
    const content = '[Warning Section*]\r\nLangSecRef=302\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.sectionName).toBe('Warning Section')
    expect(result.sections[0]!.suffix).toBe('*')
    expect(result.sections[0]!.warning).toBe(true)
  })

  it('parses uncheckable section (% suffix)', () => {
    const content = '[Always Section%]\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.sectionName).toBe('Always Section')
    expect(result.sections[0]!.suffix).toBe('%')
  })

  it('parses FileKey entries', () => {
    const content = '[Test]\r\nFileKey1=%AppData%\\App\\Cache|*.*|RECURSE\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.fileKeys).toHaveLength(1)
    expect(result.sections[0]!.fileKeys[0]!.path).toBe('${APPDATA}\\App\\Cache')
    expect(result.sections[0]!.fileKeys[0]!.fileMask).toBe('*.*')
    expect(result.sections[0]!.fileKeys[0]!.recurse).toBe(true)
    expect(result.sections[0]!.fileKeys[0]!.removeSelf).toBe(false)
  })

  it('parses FileKey with REMOVESELF', () => {
    const content = '[Test]\r\nFileKey1=%AppData%\\App\\Cache|*.*|RECURSE|REMOVESELF\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.fileKeys[0]!.removeSelf).toBe(true)
  })

  it('parses FileKey without RECURSE', () => {
    const content = '[Test]\r\nFileKey1=%Temp%\\cache|*.tmp\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.fileKeys[0]!.recurse).toBe(false)
    expect(result.sections[0]!.fileKeys[0]!.fileMask).toBe('*.tmp')
  })

  it('parses multiple FileKey entries', () => {
    const content = '[Test]\r\nFileKey1=%AppData%\\App\\Cache|*.*\r\nFileKey2=%LocalAppData%\\App\\Logs|*.log\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.fileKeys).toHaveLength(2)
    expect(result.sections[0]!.fileKeys[1]!.path).toBe('${LOCALAPPDATA}\\App\\Logs')
  })

  it('parses RegKey entries', () => {
    const content = '[Test]\r\nRegKey1=HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Test\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.regKeys).toHaveLength(1)
    expect(result.sections[0]!.regKeys[0]!).toBe('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run\\Test')
  })

  it('parses Detect entries', () => {
    const content = '[Test]\r\nDetect=HKLM\\Software\\SomeApp\r\nDetectFile=%ProgramFiles%\\SomeApp\\app.exe\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.detect).toHaveLength(1)
    expect(result.sections[0]!.detectFile).toHaveLength(1)
  })

  it('parses DetectHKLM and DetectHKCU', () => {
    const content =
      '[Test]\r\nDetectHKLM=Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\App\r\nDetectHKCU=Software\\App\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.detectHklm).toHaveLength(1)
    expect(result.sections[0]!.detectHkcu).toHaveLength(1)
  })

  it('parses DetectHKCUSoftware entries', () => {
    const content = '[Test]\r\nDetectHKCUSoftware=Software\\App\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.detectHkcuSoftware).toHaveLength(1)
  })

  it('defaults Default to false when not specified', () => {
    const content = '[Test]\r\nLangSecRef=302\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.default).toBe(false)
  })

  it('parses Default=False correctly', () => {
    const content = '[Test]\r\nDefault=False\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.default).toBe(false)
  })

  it('parses Warn=True to set warning flag', () => {
    const content = '[Test]\r\nWarn=True\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.warning).toBe(true)
  })

  it('parses multiple sections', () => {
    const content = '[Section1]\r\nLangSecRef=302\r\n\r\n[Section2*]\r\nLangSecRef=303\r\n'
    const result = parseWinapp2(content)
    expect(result.sections).toHaveLength(2)
    expect(result.totalSections).toBe(2)
    expect(result.sections[0]!.sectionName).toBe('Section1')
    expect(result.sections[1]!.sectionName).toBe('Section2')
    expect(result.sections[1]!.suffix).toBe('*')
  })

  it('handles empty content', () => {
    const result = parseWinapp2('')
    expect(result.sections).toHaveLength(0)
    expect(result.totalSections).toBe(0)
  })

  it('handles content with no sections', () => {
    const result = parseWinapp2('; just a comment\r\n; another comment')
    expect(result.sections).toHaveLength(0)
  })

  it('skips comment lines and empty lines', () => {
    const content = '; comment\r\n\r\n[Section1]\r\n; inner comment\r\nLangSecRef=302\r\n'
    const result = parseWinapp2(content)
    expect(result.sections).toHaveLength(1)
  })

  it('parses LangSecRef as number', () => {
    const content = '[Test]\r\nLangSecRef=302\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.langSecRef).toBe(302)
  })

  it('handles sections without LangSecRef', () => {
    const content = '[Test]\r\nFileKey1=%Temp%\\test|*.*\r\n'
    const result = parseWinapp2(content)
    expect(result.sections[0]!.langSecRef).toBeUndefined()
  })

  it('handles CRLF and LF line endings', () => {
    const crlf = parseWinapp2('[Test]\r\nDefault=True\r\n')
    const lf = parseWinapp2('[Test]\nDefault=True\n')
    expect(crlf.sections[0]!.default).toBe(true)
    expect(lf.sections[0]!.default).toBe(true)
  })
})
