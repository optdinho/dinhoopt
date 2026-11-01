import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileAsyncMock = vi.fn()

vi.mock('../../../services/exec-utf8', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../services/exec-utf8')>()
  return { ...actual, execFileAsync: execFileAsyncMock }
})

const { clearStandbyMemory, emptyWorkingSetForBackground } = await import('./performance')

function decodedScript(callIndex: number): string {
  const args = execFileAsyncMock.mock.calls[callIndex]?.[1] as string[] | undefined
  return Buffer.from(args?.[3] ?? '', 'base64').toString('utf16le')
}

describe('game-mode memory tweaks', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
    execFileAsyncMock.mockResolvedValue({ stdout: '', stderr: '' })
  })

  it('emptyWorkingSetForBackground ends with an explicit exit driven by its own counters', async () => {
    await emptyWorkingSetForBackground()
    const script = decodedScript(0)
    expect(script).toContain('SetProcessWorkingSetSize')
    expect(script).toMatch(/\$ok = 0/)
    expect(script).toMatch(/\$fail = 0/)
    expect(script).toMatch(/if \(\$ok -eq 0 -and \$fail -gt 0\) \{ exit 1 \}/)
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })

  it('clearStandbyMemory purges the standby list with the required privilege', async () => {
    await clearStandbyMemory()
    const script = decodedScript(0)
    expect(script).toContain('NtSetSystemInformation')
    expect(script).toContain('SeProfileSingleProcessPrivilege')
    expect(script).toContain('int command = 4')
    expect(script).toContain('$threshold')
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })

  it('clearStandbyMemory reports the purge result and memory deltas', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'OK 0 1000 1500', stderr: '' })
    const result = await clearStandbyMemory()
    expect(result).toEqual({
      purged: true,
      availableMbBefore: 1000,
      availableMbAfter: 1500,
      skipped: false,
    })
  })

  it('clearStandbyMemory skips the purge when free memory is below the threshold', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'SKIP 0 400 400', stderr: '' })
    const result = await clearStandbyMemory()
    expect(result).toEqual({
      purged: false,
      availableMbBefore: 400,
      availableMbAfter: 400,
      skipped: true,
    })
  })

  it('clearStandbyMemory reports no purge when the native call fails', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: 'OK -3 1000 1000', stderr: '' })
    const result = await clearStandbyMemory()
    expect(result.purged).toBe(false)
    expect(result.skipped).toBe(false)
  })
})
