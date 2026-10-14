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

  it('clearStandbyMemory ends with an explicit exit driven by its own counters', async () => {
    await clearStandbyMemory()
    const script = decodedScript(0)
    expect(script).toContain('SetProcessWorkingSetSize')
    expect(script).toMatch(/if \(\$ok -eq 0 -and \$fail -gt 0\) \{ exit 1 \}/)
    expect(script.trimEnd().endsWith('exit 0')).toBe(true)
  })
})
