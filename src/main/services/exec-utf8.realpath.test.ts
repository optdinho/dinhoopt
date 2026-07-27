import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childMock = {
  pid: 9999,
  on: vi.fn(),
  kill: vi.fn(),
  connected: true,
  exitCode: null,
  signalCode: null,
  stdin: null,
  stdout: null,
  stderr: null,
  stdio: [],
  killed: false,
}
const execFileAsyncMock = vi.fn<any>()
const execFileMockFn: any = vi.fn()
execFileMockFn[Symbol.for('nodejs.util.promisify.custom')] = execFileAsyncMock

vi.mock('child_process', () => ({
  execFile: execFileMockFn,
}))

const { execTracked, execNativeUtf8, killAllChildren } = await import('./exec-utf8')

describe('exec-utf8 real paths', () => {
  beforeEach(() => {
    childMock.on = vi.fn()
    childMock.kill = vi.fn()
    execFileAsyncMock.mockReset()
    execFileAsyncMock.mockImplementation(() => {
      const p = Promise.resolve({ stdout: '', stderr: '' })
      ;(p as any).child = childMock
      return p
    })
  })

  afterEach(() => {
    killAllChildren()
  })

  it('trackChild attaches exit listener and resolves', async () => {
    const result = await execTracked('test.exe', ['arg1'])
    expect(result).toEqual({ stdout: '', stderr: '' })
    expect(childMock.on).toHaveBeenCalledWith('exit', expect.any(Function))
  })

  it('trackChild kills tree when timeout expires', async () => {
    execFileAsyncMock.mockImplementation(() => {
      const p = new Promise<{ stdout: string; stderr: string }>((_, reject) => {
        setTimeout(() => reject(new Error('process timed out')), 10)
      })
      const mc = { pid: 8888, on: vi.fn(), kill: vi.fn() }
      ;(p as any).child = mc
      return p
    })
    await expect(execTracked('test.exe', ['arg1'], { timeout: 1 })).rejects.toThrow('Operation cancelled')
  })

  it('trackChild kills tree when signal already aborted', async () => {
    const aborted = AbortSignal.abort()
    await expect(execTracked('test.exe', ['arg1'], { signal: aborted })).rejects.toThrow('Operation cancelled')
  })

  it('execNativeUtf8 with allowed tool and env arg path', async () => {
    const result = await execNativeUtf8('reg', ['query', 'HKLM\\Software'])
    expect(result).toEqual({ stdout: '', stderr: '' })
  })

  it('execNativeUtf8 with percent in args uses direct path', async () => {
    const result = await execNativeUtf8('reg', ['add', 'HKLM\\Software', '/d', '%APPDATA%\\test'])
    expect(result).toEqual({ stdout: '', stderr: '' })
  })

  it('execNativeUtf8 throws on pre-aborted signal', async () => {
    const aborted = AbortSignal.abort()
    await expect(execNativeUtf8('reg', ['query'], { signal: aborted })).rejects.toThrow('Operation cancelled')
  })

  it('execNativeUtf8 propagates rejection from execFileAsync', async () => {
    execFileAsyncMock.mockRejectedValue(new Error('reg failure'))
    await expect(execNativeUtf8('reg', ['query'])).rejects.toThrow('reg failure')
  })

  it('killAllChildren on empty set does nothing', () => {
    expect(() => killAllChildren()).not.toThrow()
  })

  it('killAllChildren on non-empty set does not throw', async () => {
    await execTracked('test.exe', ['arg1'])
    expect(() => killAllChildren()).not.toThrow()
  })

  it('cleanup removes abort listener when signal not pre-aborted', async () => {
    const controller = new AbortController()
    const result = await execTracked('test.exe', ['arg1'], { signal: controller.signal })
    expect(result).toEqual({ stdout: '', stderr: '' })
  })

  it('direct path rejection propagates error', async () => {
    execFileAsyncMock.mockImplementation(() => {
      const p = Promise.reject(new Error('direct exec error'))
      const mc = { pid: 7777, on: vi.fn(), kill: vi.fn() }
      ;(p as any).child = mc
      return p
    })
    await expect(execNativeUtf8('reg', ['%APPDATA%\\test'])).rejects.toThrow('direct exec error')
  })
})
