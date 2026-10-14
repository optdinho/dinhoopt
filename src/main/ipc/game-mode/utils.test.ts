import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileAsyncMock = vi.fn()

vi.mock('../../services/exec-utf8', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/exec-utf8')>()
  return { ...actual, execFileAsync: execFileAsyncMock }
})

const { ps } = await import('./utils')

describe('game-mode ps()', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
    execFileAsyncMock.mockResolvedValue({ stdout: 'ok', stderr: '' })
  })

  it('runs the script via -EncodedCommand (verbatim), never -Command', async () => {
    await ps('Write-Output "x"', 1234)

    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
    const [file, args, opts] = execFileAsyncMock.mock.calls[0] as [string, string[], { timeout: number }]
    expect(file).toBe('powershell.exe')
    expect(args).toContain('-EncodedCommand')
    expect(args).not.toContain('-Command')

    const decoded = Buffer.from(args[3] ?? '', 'base64').toString('utf16le')
    expect(decoded).toContain('[Console]::OutputEncoding')
    expect(decoded).toContain('Write-Output "x"')
    expect(opts.timeout).toBe(1234)
  })

  it('uses the requested timeout', async () => {
    await ps('Write-Output ok', 3000)
    const opts = execFileAsyncMock.mock.calls[0]?.[2] as { timeout: number }
    expect(opts.timeout).toBe(3000)
  })

  it('returns trimmed stdout', async () => {
    execFileAsyncMock.mockResolvedValue({ stdout: '  hello\r\n', stderr: '' })
    await expect(ps('x')).resolves.toBe('hello')
  })
})
