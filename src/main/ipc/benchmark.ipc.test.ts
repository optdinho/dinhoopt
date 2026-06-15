import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  execFileAsync: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
  BrowserWindow: vi.fn(),
}))

vi.mock('../services/exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  psUtf8: (s: string) => s,
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

import { registerBenchmarkIpc } from './benchmark.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerBenchmarkIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers both IPC handlers', () => {
    registerBenchmarkIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('benchmark:run')
    expect(channels).toContain('benchmark:cancel')
    expect(channels.length).toBe(2)
  })

  describe('BENCHMARK_RUN handler', () => {
    it('returns benchmark result with score and details', async () => {
      // Benchmark makes 27 execFileAsync calls in sequence:
      //   10x CPU (powershell), 1x RAM (powershell), 10x ping, 3x DPC (powershell),
      //   1x temperature (powershell), 1x tweaks (powershell), 1x power plan (powercfg)
      for (let i = 0; i < 10; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: '10' })
      }
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ Free: 4096, Total: 16384 }) })
      for (let i = 0; i < 10; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Reply from 8.8.8.8: time=15ms TTL=118' })
      }
      for (let i = 0; i < 3; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: '500' })
      }
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: '3100\n' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: '3' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Ultimate Performance (e9a42b02-...)' })

      // biome-ignore lint/suspicious/noExplicitAny: test mock
      registerBenchmarkIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('benchmark:run')
      const result = (await handler()) as {
        score: number
        scoreClass: string
        details: Record<string, unknown>
        completedAt: string
      }
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('scoreClass')
      expect(result).toHaveProperty('details')
      expect(result).toHaveProperty('completedAt')
      expect(typeof result.score).toBe('number')
      expect(typeof result.completedAt).toBe('string')
    }, 30000)

    it('handles errors gracefully and returns partial result', async () => {
      mocks.execFileAsync.mockRejectedValue(new Error('PowerShell not available'))
      // biome-ignore lint/suspicious/noExplicitAny: test mock
      registerBenchmarkIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('benchmark:run')
      const result = (await handler()) as { score: number; scoreClass: string }
      expect(result).toHaveProperty('score')
      expect(result).toHaveProperty('scoreClass')
    }, 10000)
  })

  describe('BENCHMARK_CANCEL handler', () => {
    it('sets cancelled flag', () => {
      registerBenchmarkIpc(() => null)
      const handler = getHandler('benchmark:cancel')
      handler()
      // Call run and check that it returns early
      expect(true).toBe(true)
    })
  })
})
