import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemoryStore } from './memory-store'

function mockMemoryApi() {
  const mock = {
    memoryInfo: vi.fn(),
    memoryOptimize: vi.fn(),
    onMemoryProgress: vi.fn(() => vi.fn()),
  }
  if (typeof window === 'undefined') {
    ;(globalThis as any).window = {}
  }
  ;(window as any).dinho = mock
  return mock
}

const fakeInfo = {
  info: {
    totalBytes: 16_000_000_000,
    availableBytes: 8_000_000_000,
    usedBytes: 8_000_000_000,
    usedPercent: 50,
    cachedBytes: 2_000_000_000,
  },
  processes: [
    { pid: 1234, name: 'chrome.exe', workingSetBytes: 500_000_000 },
    { pid: 5678, name: 'code.exe', workingSetBytes: 300_000_000 },
  ],
}

describe('memory-store', () => {
  let api: ReturnType<typeof mockMemoryApi>

  beforeEach(() => {
    vi.clearAllMocks()
    api = mockMemoryApi()
    useMemoryStore.getState().reset()
  })

  it('starts with default state', () => {
    const state = useMemoryStore.getState()
    expect(state.info).toBeNull()
    expect(state.processes).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.optimizing).toBe(false)
    expect(state.error).toBeNull()
    expect(state.success).toBeNull()
    expect(state.progress).toBeNull()
    expect(state.result).toBeNull()
  })

  it('load sets info and processes on success', async () => {
    api.memoryInfo.mockResolvedValueOnce(fakeInfo)
    await useMemoryStore.getState().load()
    const state = useMemoryStore.getState()
    expect(state.loading).toBe(false)
    expect(state.info).toEqual(fakeInfo.info)
    expect(state.processes).toEqual(fakeInfo.processes)
  })

  it('load sets error on failure', async () => {
    api.memoryInfo.mockRejectedValueOnce(new Error('fail'))
    await useMemoryStore.getState().load()
    const state = useMemoryStore.getState()
    expect(state.loading).toBe(false)
    expect(state.error).toBe('Failed to load memory info')
    expect(state.info).toBeNull()
  })

  it('optimize calls memoryOptimize and subscribes to progress', async () => {
    const unsub = vi.fn()
    api.onMemoryProgress.mockReturnValueOnce(unsub)
    api.memoryOptimize.mockResolvedValueOnce({
      success: true,
      freedBytes: 1_000_000,
      steps: [{ name: 'clear-cache', success: true, freedBytes: 1_000_000 }],
    })
    api.memoryInfo.mockResolvedValueOnce(fakeInfo)
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(api.onMemoryProgress).toHaveBeenCalled()
    expect(api.memoryOptimize).toHaveBeenCalled()
    expect(state.optimizing).toBe(false)
    expect(state.result?.success).toBe(true)
    expect(unsub).toHaveBeenCalled()
  })

  it('optimize sets error on failure', async () => {
    api.memoryOptimize.mockRejectedValueOnce(new Error('fail'))
    api.onMemoryProgress.mockReturnValueOnce(vi.fn())
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(state.optimizing).toBe(false)
    expect(state.error).toBe('Optimization failed')
  })

  it('optimize no-ops if already optimizing', async () => {
    useMemoryStore.setState({ optimizing: true })
    await useMemoryStore.getState().optimize()
    expect(api.memoryOptimize).not.toHaveBeenCalled()
  })

  it('optimize res.success = false with error field', async () => {
    const unsub = vi.fn()
    api.onMemoryProgress.mockReturnValueOnce(unsub)
    api.memoryOptimize.mockResolvedValueOnce({
      success: false,
      freedBytes: 0,
      error: 'Not enough memory',
      steps: [],
    })
    api.memoryInfo.mockRejectedValueOnce(new Error('load fail'))
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(state.result).toMatchObject({ success: false })
    expect(state.optimizing).toBe(false)
  })

  it('optimize res.success = false without error field (fallback msg)', async () => {
    const unsub = vi.fn()
    api.onMemoryProgress.mockReturnValueOnce(unsub)
    api.memoryOptimize.mockResolvedValueOnce({
      success: false,
      freedBytes: 0,
      steps: [],
    })
    api.memoryInfo.mockRejectedValueOnce(new Error('load fail'))
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(state.result).toMatchObject({ success: false })
    expect(state.optimizing).toBe(false)
  })

  it('reset returns to initial state', () => {
    useMemoryStore.setState({
      info: fakeInfo.info,
      processes: fakeInfo.processes,
      loading: true,
      optimizing: true,
      error: 'err',
      success: 'ok',
      progress: { step: 1, totalSteps: 3, label: 'test', detail: 'test' },
      result: { success: true, freedBytes: 0, steps: [] },
    })
    useMemoryStore.getState().reset()
    const state = useMemoryStore.getState()
    expect(state.info).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.optimizing).toBe(false)
    expect(state.error).toBeNull()
  })
})
