import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileAsyncMock = vi.fn()

vi.mock('./exec-utf8', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./exec-utf8')>()
  return { ...actual, execFileAsync: execFileAsyncMock }
})

const logger = {
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

vi.mock('./logger.service', () => ({
  getLogger: () => logger,
}))

const { addDefenderExclusion, getDefenderExclusionStatus, isValidDefenderExclusionPath, removeDefenderExclusion } =
  await import('./defender-exclusions')

function decodedScript(callIndex: number): string {
  const args = execFileAsyncMock.mock.calls[callIndex]?.[1] as string[] | undefined
  return Buffer.from(args?.[3] ?? '', 'base64').toString('utf16le')
}

describe('isValidDefenderExclusionPath', () => {
  it('accepts absolute drive paths', () => {
    expect(isValidDefenderExclusionPath('C:\\Games')).toBe(true)
    expect(isValidDefenderExclusionPath('D:\\SteamLibrary\\steamapps')).toBe(true)
    expect(isValidDefenderExclusionPath('c:\\games\\')).toBe(true)
    expect(isValidDefenderExclusionPath('  C:\\Games  ')).toBe(true)
  })

  it('rejects empty and non-string input', () => {
    expect(isValidDefenderExclusionPath('')).toBe(false)
    expect(isValidDefenderExclusionPath('   ')).toBe(false)
    expect(isValidDefenderExclusionPath(null)).toBe(false)
    expect(isValidDefenderExclusionPath(42)).toBe(false)
    expect(isValidDefenderExclusionPath({})).toBe(false)
  })

  it('rejects relative and UNC paths', () => {
    expect(isValidDefenderExclusionPath('Games')).toBe(false)
    expect(isValidDefenderExclusionPath('.\\Games')).toBe(false)
    expect(isValidDefenderExclusionPath('\\\\server\\share')).toBe(false)
  })

  it('rejects shell metacharacters and quotes', () => {
    expect(isValidDefenderExclusionPath('C:\\Games; rm -rf C:\\')).toBe(false)
    expect(isValidDefenderExclusionPath('C:\\Games|calc')).toBe(false)
    expect(isValidDefenderExclusionPath('C:\\Games&calc')).toBe(false)
    expect(isValidDefenderExclusionPath('C:\\Games`calc`')).toBe(false)
    expect(isValidDefenderExclusionPath('C:\\Ga"mes')).toBe(false)
    expect(isValidDefenderExclusionPath("C:\\Ga'mes")).toBe(false)
    expect(isValidDefenderExclusionPath('C:\\Games\nD:\\')).toBe(false)
    expect(isValidDefenderExclusionPath('C:\\Games<D>')).toBe(false)
  })

  it('rejects traversal segments', () => {
    expect(isValidDefenderExclusionPath('C:\\Games\\..\\Windows')).toBe(false)
    expect(isValidDefenderExclusionPath('C:\\Games/../Windows')).toBe(false)
  })

  it('rejects paths longer than 260 characters', () => {
    expect(isValidDefenderExclusionPath(`C:\\${'a'.repeat(260)}`)).toBe(false)
  })
})

describe('defender exclusions', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
    execFileAsyncMock.mockResolvedValue({ stdout: 'OK', stderr: '' })
  })

  it('adds an exclusion through Add-MpPreference', async () => {
    const result = await addDefenderExclusion('C:\\Games')
    expect(result).toEqual({ success: true })
    const script = decodedScript(0)
    expect(script).toContain("Add-MpPreference -ExclusionPath 'C:\\Games'")
    expect(script).toContain('-ErrorAction Stop')
  })

  it('removes an exclusion through Remove-MpPreference', async () => {
    const result = await removeDefenderExclusion('C:\\Games')
    expect(result).toEqual({ success: true })
    const script = decodedScript(0)
    expect(script).toContain("Remove-MpPreference -ExclusionPath 'C:\\Games'")
  })

  it('trims the path before building the command', async () => {
    await addDefenderExclusion('  C:\\Games  ')
    expect(decodedScript(0)).toContain("'C:\\Games'")
  })

  it('does not execute PowerShell for an invalid path', async () => {
    const result = await addDefenderExclusion('Games; calc')
    expect(result).toEqual({ success: false, error: 'Invalid exclusion path' })
    expect(execFileAsyncMock).not.toHaveBeenCalled()
  })

  it('surfaces the PowerShell error message', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'ERR Access is denied', stderr: '' })
    const result = await addDefenderExclusion('C:\\Games')
    expect(result).toEqual({ success: false, error: 'Access is denied' })
    expect(logger.warning).toHaveBeenCalled()
  })

  it('reports a thrown error as a failure', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('timeout'))
    const result = await removeDefenderExclusion('C:\\Games')
    expect(result).toEqual({ success: false, error: 'timeout' })
    expect(logger.error).toHaveBeenCalled()
  })

  it('reports a thrown non-Error as a failure', async () => {
    execFileAsyncMock.mockRejectedValue('boom')
    const result = await removeDefenderExclusion('C:\\Games')
    expect(result).toEqual({ success: false, error: 'boom' })
  })
})

describe('getDefenderExclusionStatus', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
  })

  it('parses supported status, tamper protection and exclusions', async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify({
        supported: true,
        tamperProtection: true,
        exclusions: ['C:\\Games', 'D:\\Tools'],
      }),
      stderr: '',
    })
    const status = await getDefenderExclusionStatus()
    expect(status).toEqual({
      supported: true,
      tamperProtection: true,
      exclusions: ['C:\\Games', 'D:\\Tools'],
    })
  })

  it('wraps a single exclusion string in an array', async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify({ supported: true, tamperProtection: null, exclusions: 'C:\\Games' }),
      stderr: '',
    })
    const status = await getDefenderExclusionStatus()
    expect(status.exclusions).toEqual(['C:\\Games'])
    expect(status.tamperProtection).toBeNull()
  })

  it('filters out non-string and empty exclusions', async () => {
    execFileAsyncMock.mockResolvedValue({
      stdout: JSON.stringify({ supported: true, exclusions: ['C:\\Games', '', 42, null] }),
      stderr: '',
    })
    const status = await getDefenderExclusionStatus()
    expect(status.exclusions).toEqual(['C:\\Games'])
  })

  it('returns an unsupported status when the JSON is malformed', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'not json', stderr: '' })
    const status = await getDefenderExclusionStatus()
    expect(status).toEqual({ supported: false, tamperProtection: null, exclusions: [] })
    expect(logger.warning).toHaveBeenCalled()
  })

  it('returns an unsupported status when PowerShell throws', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('boom'))
    const status = await getDefenderExclusionStatus()
    expect(status).toEqual({ supported: false, tamperProtection: null, exclusions: [] })
  })
})
