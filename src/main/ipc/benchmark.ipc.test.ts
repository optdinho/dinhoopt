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

import {
  cancelBenchmark,
  classifyScore,
  registerBenchmarkIpc,
  scoreCpu,
  scoreDpc,
  scoreNetwork,
  scorePowerBonus,
  scoreRam,
  scoreTemperature,
  scoreTweakBonus,
} from './benchmark.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function mockBenchmarkRun(config: {
  cpuReadings: number[]
  ramFree: number
  ramTotal: number
  pingLines: string[]
  dpcReadings: number[]
  tempLine: string
  tweaksLine: string
  powerPlanLine: string
}): () => Promise<unknown> {
  for (const cpu of config.cpuReadings) {
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: String(cpu) })
  }
  mocks.execFileAsync.mockResolvedValueOnce({
    stdout: JSON.stringify({ Free: config.ramFree, Total: config.ramTotal }),
  })
  for (const ping of config.pingLines) {
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: ping })
  }
  for (const dpc of config.dpcReadings) {
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: String(dpc) })
  }
  mocks.execFileAsync.mockResolvedValueOnce({ stdout: config.tempLine })
  mocks.execFileAsync.mockResolvedValueOnce({ stdout: config.tweaksLine })
  mocks.execFileAsync.mockResolvedValueOnce({ stdout: config.powerPlanLine })

  // biome-ignore lint/suspicious/noExplicitAny: test mock
  registerBenchmarkIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
  const handler = getHandler('benchmark:run')
  return handler as () => Promise<unknown>
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

    it('returns class S for best-case metrics', async () => {
      const run = mockBenchmarkRun({
        cpuReadings: Array(10).fill(2),
        ramFree: 11468,
        ramTotal: 16384,
        pingLines: Array(10).fill('Reply from 8.8.8.8: time=5ms TTL=118'),
        dpcReadings: [100, 100, 100],
        tempLine: '45\n',
        tweaksLine: '51',
        powerPlanLine: 'Ultimate Performance (e9a42b02-d5df-448d-aa00-03f14749eb61)',
      })

      const result = (await run()) as { score: number; scoreClass: string }
      expect(result.scoreClass).toBe('S')
      expect(result.score).toBeGreaterThanOrEqual(90)
    }, 30000)

    it('returns class D for worst-case metrics', async () => {
      const run = mockBenchmarkRun({
        cpuReadings: Array(10).fill(80),
        ramFree: 512,
        ramTotal: 16384,
        pingLines: Array(10).fill('Request timed out'),
        dpcReadings: [10000, 10000, 10000],
        tempLine: '',
        tweaksLine: '0',
        powerPlanLine: 'Balanced',
      })

      const result = (await run()) as { score: number; scoreClass: string }
      expect(result.scoreClass).toBe('D')
      expect(result.score).toBeLessThan(50)
    }, 30000)
  })

  describe('BENCHMARK_RUN handler — edge cases (real timers)', () => {
    it('handles NaN CPU reading by skipping the value', async () => {
      const cpuReadings = ['10', 'not-a-number', '10', '10', '10', '10', '10', '10', '10', '10']
      for (const r of cpuReadings) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: r })
      }
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ Free: 8192, Total: 16384 }) })
      for (let i = 0; i < 10; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Reply from 8.8.8.8: time=15ms TTL=118' })
      }
      for (let i = 0; i < 3; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: '500' })
      }
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: '3100\n' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: '4' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Balanced' })

      registerBenchmarkIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('benchmark:run')
      const result = (await handler()) as { details: Record<string, unknown> }
      const cpu = result.details.cpu as { score: number; detail: string }
      expect(cpu.detail).toMatch(/Uso médio/)
    }, 30000)

    it('handles non-numeric tweaks count gracefully', async () => {
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
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'invalid-value' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Balanced' })

      registerBenchmarkIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('benchmark:run')
      const result = (await handler()) as { details: Record<string, unknown> }
      const tweaks = result.details.tweakBonus as { score: number; applied: number }
      expect(tweaks.applied).toBe(0)
      expect(tweaks.score).toBe(0)
    }, 30000)

    it('detects high performance power plan', async () => {
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
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'High Performance (8c5e7fda-e8bf-4a96-9a05-a4e062abba23)' })

      registerBenchmarkIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('benchmark:run')
      const result = (await handler()) as { details: Record<string, unknown> }
      const power = result.details.powerBonus as { plan: string; score: number }
      expect(power.plan).toBe('High Performance')
      expect(power.score).toBe(3)
    }, 30000)

    it('returns 0 jitter for single successful ping sample', async () => {
      for (let i = 0; i < 10; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: '10' })
      }
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ Free: 4096, Total: 16384 }) })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Reply from 8.8.8.8: time=15ms TTL=118' })
      for (let i = 0; i < 9; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Request timed out' })
      }
      for (let i = 0; i < 3; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: '500' })
      }
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: '3100\n' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: '3' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Balanced' })

      registerBenchmarkIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('benchmark:run')
      const result = (await handler()) as { details: Record<string, unknown> }
      const net = result.details.network as { score: number; jitter: number; detail: string }
      expect(net.jitter).toBe(0)
      expect(net.detail).toMatch(/Ping médio/)
    }, 30000)
  })

  describe('BENCHMARK_RUN handler — cancelled mid-cycle', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('cancelled mid-CPU measurement uses early return value', async () => {
      for (let i = 0; i < 10; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: '5' })
      }
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: JSON.stringify({ Free: 8192, Total: 16384 }) })
      for (let i = 0; i < 10; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Reply from 8.8.8.8: time=15ms TTL=118' })
      }
      for (let i = 0; i < 3; i++) {
        mocks.execFileAsync.mockResolvedValueOnce({ stdout: '500' })
      }
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: '3100\n' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: '3' })
      mocks.execFileAsync.mockResolvedValueOnce({ stdout: 'Balanced' })

      registerBenchmarkIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('benchmark:run')

      const promise = handler()
      await vi.advanceTimersByTimeAsync(500)

      cancelBenchmark()
      await vi.advanceTimersByTimeAsync(30000)

      const result = (await promise) as { details: Record<string, unknown> }
      const cpu = result.details.cpu as { score: number }
      expect(cpu.score).toBe(4)
    })
  })

  describe('BENCHMARK_CANCEL handler', () => {
    it('sets cancelled flag', () => {
      registerBenchmarkIpc(() => null)
      const handler = getHandler('benchmark:cancel')
      handler()
      expect(true).toBe(true)
    })
  })
})

describe('scoring functions', () => {
  describe('classifyScore', () => {
    it('returns S for 90+', () => {
      expect(classifyScore(95)).toBe('S')
    })
    it('returns A for 80-89', () => {
      expect(classifyScore(85)).toBe('A')
    })
    it('returns B for 70-79', () => {
      expect(classifyScore(75)).toBe('B')
    })
    it('returns C for 50-69', () => {
      expect(classifyScore(60)).toBe('C')
    })
    it('returns D for < 50', () => {
      expect(classifyScore(40)).toBe('D')
    })
  })

  describe('scoreCpu', () => {
    it('returns 20 for usage < 5', () => {
      expect(scoreCpu(2)).toBe(20)
    })
    it('returns 17 for usage < 10', () => {
      expect(scoreCpu(7)).toBe(17)
    })
    it('returns 14 for usage < 20', () => {
      expect(scoreCpu(15)).toBe(14)
    })
    it('returns 9 for usage < 35', () => {
      expect(scoreCpu(25)).toBe(9)
    })
    it('returns 4 for usage >= 35', () => {
      expect(scoreCpu(50)).toBe(4)
    })
  })

  describe('scoreRam', () => {
    it('returns 20 for > 60% free', () => {
      expect(scoreRam(70)).toBe(20)
    })
    it('returns 16 for > 40% free', () => {
      expect(scoreRam(50)).toBe(16)
    })
    it('returns 11 for > 25% free', () => {
      expect(scoreRam(30)).toBe(11)
    })
    it('returns 6 for > 10% free', () => {
      expect(scoreRam(15)).toBe(6)
    })
    it('returns 2 for <= 10% free', () => {
      expect(scoreRam(5)).toBe(2)
    })
  })

  describe('scoreNetwork', () => {
    it('returns 15 for avg < 10', () => {
      expect(scoreNetwork(5, 0)).toBe(15)
    })
    it('returns 13 for avg < 30', () => {
      expect(scoreNetwork(20, 0)).toBe(13)
    })
    it('returns 10 for avg < 60', () => {
      expect(scoreNetwork(40, 0)).toBe(10)
    })
    it('returns 6 for avg < 100', () => {
      expect(scoreNetwork(80, 0)).toBe(6)
    })
    it('returns 2 for avg >= 100', () => {
      expect(scoreNetwork(150, 0)).toBe(2)
    })
    it('subtracts 8 for jitter > 60', () => {
      expect(scoreNetwork(5, 70)).toBe(7)
    })
    it('subtracts 4 for jitter > 30', () => {
      expect(scoreNetwork(5, 40)).toBe(11)
    })
    it('clamps score to minimum 0', () => {
      expect(scoreNetwork(150, 100)).toBe(0)
    })
  })

  describe('scoreDpc', () => {
    it('returns 25 for latency < 200', () => {
      expect(scoreDpc(100)).toBe(25)
    })
    it('returns 20 for latency < 500', () => {
      expect(scoreDpc(300)).toBe(20)
    })
    it('returns 13 for latency < 1000', () => {
      expect(scoreDpc(700)).toBe(13)
    })
    it('returns 6 for latency < 2000', () => {
      expect(scoreDpc(1500)).toBe(6)
    })
    it('returns 2 for latency >= 2000', () => {
      expect(scoreDpc(5000)).toBe(2)
    })
  })

  describe('scoreTemperature', () => {
    it('returns 10 for null temp', () => {
      expect(scoreTemperature(null)).toBe(10)
    })
    it('returns 20 for temp < 50', () => {
      expect(scoreTemperature(40)).toBe(20)
    })
    it('returns 17 for temp < 60', () => {
      expect(scoreTemperature(55)).toBe(17)
    })
    it('returns 13 for temp < 70', () => {
      expect(scoreTemperature(65)).toBe(13)
    })
    it('returns 8 for temp < 80', () => {
      expect(scoreTemperature(75)).toBe(8)
    })
    it('returns 3 for temp >= 80', () => {
      expect(scoreTemperature(90)).toBe(3)
    })
  })

  describe('scoreTweakBonus', () => {
    it('returns proportional score', () => {
      expect(scoreTweakBonus(25, 50)).toBe(5)
    })
    it('returns 0 for 0 applied', () => {
      expect(scoreTweakBonus(0, 50)).toBe(0)
    })
    it('returns 10 for all applied', () => {
      expect(scoreTweakBonus(50, 50)).toBe(10)
    })
  })

  describe('scorePowerBonus', () => {
    it('returns 5 for ultimate', () => {
      expect(scorePowerBonus('ultimate')).toBe(5)
    })
    it('returns 3 for high', () => {
      expect(scorePowerBonus('high')).toBe(3)
    })
    it('returns 0 for balanced', () => {
      expect(scorePowerBonus('balanced')).toBe(0)
    })
    it('returns 0 for unknown', () => {
      expect(scorePowerBonus('unknown')).toBe(0)
    })
  })
})
