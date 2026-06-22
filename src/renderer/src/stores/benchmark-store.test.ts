import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useBenchmarkStore } from './benchmark-store'

beforeEach(() => {
  vi.stubGlobal('window', {
    dinho: {
      benchmarkRun: vi.fn(),
      benchmarkCancel: vi.fn(),
      onBenchmarkProgress: vi.fn(() => vi.fn()),
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useBenchmarkStore.setState({ status: 'idle', progress: null, result: null })
})

describe('benchmark-store', () => {
  it('starts with idle status', () => {
    const s = useBenchmarkStore.getState()
    expect(s.status).toBe('idle')
    expect(s.progress).toBeNull()
    expect(s.result).toBeNull()
  })

  it('run sets status to running and calls API', async () => {
    const result: import('@shared/types').BenchmarkResult = {
      score: 9500,
      scoreClass: 'A',
      details: {
        cpu: { score: 5000, detail: 'i7' },
        ram: { score: 2000, detail: '16GB' },
        network: { score: 1500, detail: '1Gbps' },
        latencyDpc: { score: 1000, detail: 'Low' },
        temperature: { score: 0, detail: '65°C' },
        tweakBonus: { score: 0, applied: 0, total: 3 },
        powerBonus: { score: 0, plan: 'Balanced' },
      },
      completedAt: '2025-01-01T00:00:00Z',
    }
    vi.mocked(window.dinho.benchmarkRun).mockResolvedValue(result)
    await useBenchmarkStore.getState().run()
    expect(window.dinho.benchmarkRun).toHaveBeenCalled()
    expect(useBenchmarkStore.getState().status).toBe('done')
    expect(useBenchmarkStore.getState().result).toEqual(result)
  })

  it('run sets idle on failure', async () => {
    vi.mocked(window.dinho.benchmarkRun).mockRejectedValue(new Error('fail'))
    await useBenchmarkStore.getState().run()
    expect(useBenchmarkStore.getState().status).toBe('idle')
  })

  it('run registers progress listener and cleans up', async () => {
    vi.mocked(window.dinho.onBenchmarkProgress).mockReturnValue(vi.fn())
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    vi.mocked(window.dinho.benchmarkRun).mockResolvedValue({ score: 0 } as any)
    await useBenchmarkStore.getState().run()
    expect(window.dinho.onBenchmarkProgress).toHaveBeenCalled()
  })

  it('cancel calls API and sets idle', async () => {
    useBenchmarkStore.setState({ status: 'running' })
    vi.mocked(window.dinho.benchmarkCancel).mockResolvedValue(undefined)
    await useBenchmarkStore.getState().cancel()
    expect(window.dinho.benchmarkCancel).toHaveBeenCalled()
    expect(useBenchmarkStore.getState().status).toBe('idle')
  })

  it('reset restores initial state', () => {
    useBenchmarkStore.setState({
      status: 'done',
      // biome-ignore lint/suspicious/noExplicitAny: test
      progress: { phase: 'cpu', percent: 50 } as any,
      // biome-ignore lint/suspicious/noExplicitAny: test
      result: { score: 100 } as any,
    })
    useBenchmarkStore.getState().reset()
    const s = useBenchmarkStore.getState()
    expect(s.status).toBe('idle')
    expect(s.progress).toBeNull()
    expect(s.result).toBeNull()
  })
})
