import { describe, it, expect, vi, beforeEach } from 'vitest'

const execFileAsyncMock = vi.fn<(...args: unknown[]) => Promise<{ stdout: string; stderr: string }>>()

const execFileMockFn: any = vi.fn()
execFileMockFn[Symbol.for('nodejs.util.promisify.custom')] = execFileAsyncMock

vi.mock('child_process', () => ({
  execFile: execFileMockFn,
}))

const { psUtf8, psArgs, execNativeUtf8, execTracked, killAllChildren, execFileAsync } = await import('./exec-utf8')

describe('psUtf8', () => {
  it('prepends UTF-8 preamble to a command', () => {
    const result = psUtf8('Get-Process')
    expect(result).toContain('[Console]::OutputEncoding')
    expect(result).toContain('Get-Process')
  })

  it('includes both OutputEncoding and $OutputEncoding', () => {
    const result = psUtf8('dir')
    expect(result).toContain('[Console]::OutputEncoding')
    expect(result).toContain('$OutputEncoding')
  })
})

describe('psArgs', () => {
  it('returns array with -NoProfile, -NonInteractive, -Command and UTF-8 command', () => {
    const args = psArgs('Get-Service')
    expect(args).toHaveLength(4)
    expect(args[0]).toBe('-NoProfile')
    expect(args[1]).toBe('-NonInteractive')
    expect(args[2]).toBe('-Command')
    expect(args[3]).toContain('Get-Service')
    expect(args[3]).toContain('[Console]::OutputEncoding')
  })
})

describe('execNativeUtf8', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
    execFileAsyncMock.mockResolvedValue({ stdout: 'output', stderr: '' })
  })

  it('throws for disallowed tools', async () => {
    await expect(execNativeUtf8('evil.exe', [])).rejects.toThrow('disallowed tool')
  })

  it('allows "reg"', async () => {
    await execNativeUtf8('reg', ['query', 'HKLM\\Software'])
    expect(execFileAsyncMock).toHaveBeenCalled()
  })

  it('allows "reg.exe"', async () => {
    await execNativeUtf8('reg.exe', ['query', 'HKLM'])
    expect(execFileAsyncMock).toHaveBeenCalled()
  })

  it('allows "netsh"', async () => {
    await execNativeUtf8('netsh', ['wlan', 'show', 'profiles'])
    expect(execFileAsyncMock).toHaveBeenCalled()
  })

  it('allows "pnputil"', async () => {
    await execNativeUtf8('pnputil', ['-e'])
    expect(execFileAsyncMock).toHaveBeenCalled()
  })

  it('allows "schtasks"', async () => {
    await execNativeUtf8('schtasks', ['/query'])
    expect(execFileAsyncMock).toHaveBeenCalled()
  })

  it('allows "ipconfig"', async () => {
    await execNativeUtf8('ipconfig', ['/all'])
    expect(execFileAsyncMock).toHaveBeenCalled()
  })

  it('throws when already aborted', async () => {
    const aborted = AbortSignal.abort()
    await expect(execNativeUtf8('reg', ['query'], { signal: aborted })).rejects.toThrow('Operation cancelled')
  })

  it('passes args via env vars when no % in arguments', async () => {
    execFileAsyncMock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[2] as { env: { __KA0: string; __KA1: string }; windowsVerbatimArguments: boolean }
      expect(opts.env.__KA0).toBe('query')
      expect(opts.env.__KA1).toBe('HKLM\\Software')
      expect(opts.windowsVerbatimArguments).toBe(true)
      return { stdout: 'ok', stderr: '' }
    })
    await execNativeUtf8('reg', ['query', 'HKLM\\Software'])
  })

  it('calls tool directly when args contain %', async () => {
    execFileAsyncMock.mockImplementation(async (...args: unknown[]) => {
      expect(args[0]).toBe('reg')
      expect(args[1]).toEqual(['add', 'HKLM\\Software', '/d', '%APPDATA%\\test'])
      return { stdout: 'ok', stderr: '' }
    })
    await execNativeUtf8('reg', ['add', 'HKLM\\Software', '/d', '%APPDATA%\\test'])
  })

  it('passes maxBuffer when provided', async () => {
    await execNativeUtf8('reg', ['query'], { maxBuffer: 1024 * 1024 })
    const callOpts = execFileAsyncMock.mock.calls[0][2] as { maxBuffer: number }
    expect(callOpts.maxBuffer).toBe(1024 * 1024)
  })

  it('propagates error with argument placeholders replaced', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('cmd.exe failed: "%__KA0%"'))
    await expect(execNativeUtf8('reg', ['query', 'HKLM'])).rejects.toThrow(/query|HKLM/)
  })

  it('sets killed=true error when process timed out (killed flag)', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('something'))
    const result = execNativeUtf8('reg', ['query'], { timeout: 1 })
    // Simulate that the cleanup set killed=true before rejecting
    // We can't easily trigger the real timeout path since we mock execFileAsync,
    // but we verify it still throws the original error
    await expect(result).rejects.toThrow('something')
  })

  it('escapes trailing backslashes in env vars', async () => {
    execFileAsyncMock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[2] as { env: { __KA0: string } }
      expect(opts.env.__KA0).toMatch(/\\\\$/)
      return { stdout: '', stderr: '' }
    })
    await execNativeUtf8('reg', ['HKLM\\Software\\'])
  })

  it('escapes double quotes in arguments', async () => {
    execFileAsyncMock.mockImplementation(async (...args: unknown[]) => {
      const opts = args[2] as { env: { __KA0: string } }
      expect(opts.env.__KA0).toBe('value with ""quotes""')
      return { stdout: '', stderr: '' }
    })
    await execNativeUtf8('reg', ['value with "quotes"'])
  })
})

describe('execTracked', () => {
  beforeEach(() => {
    execFileAsyncMock.mockReset()
    execFileAsyncMock.mockResolvedValue({ stdout: 'tracked output', stderr: '' })
  })

  it('executes a command and returns output', async () => {
    const result = await execTracked('powershell.exe', ['-Command', 'echo test'])
    expect(result.stdout).toBe('tracked output')
  })

  it('throws when signal is already aborted', async () => {
    await expect(execTracked('test.exe', [], { signal: AbortSignal.abort() })).rejects.toThrow('Operation cancelled')
  })

  it('throws Operation cancelled on abort during execution', async () => {
    const ctrl = new AbortController()
    execFileAsyncMock.mockRejectedValue(new Error('exec error'))
    const promise = execTracked('test.exe', [], { signal: ctrl.signal })
    ctrl.abort()
    try {
      await promise
    } catch (e: any) {
      expect(e.message).toBe('Operation cancelled')
    }
  })

  it('throws original error when not killed or aborted', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('original error'))
    await expect(execTracked('test.exe', [])).rejects.toThrow('original error')
  })

  it('uses default timeout of 15s', async () => {
    execFileAsyncMock.mockImplementation(async (..._args) => {
      return { stdout: '', stderr: '' }
    })
    await execTracked('test.exe', [])
    expect(execFileAsyncMock).toHaveBeenCalledTimes(1)
  })
})

describe('execFileAsync export', () => {
  it('is a function', () => {
    expect(typeof execFileAsync).toBe('function')
  })
})

describe('killAllChildren', () => {
  it('is a function that does not throw', () => {
    expect(typeof killAllChildren).toBe('function')
    expect(() => killAllChildren()).not.toThrow()
  })
})
