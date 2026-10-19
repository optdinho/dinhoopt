import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useMemoryStore } from './memory-store'

const mocks = vi.hoisted(() => ({
  logger: { error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/lib/renderer-logger', () => ({ default: mocks.logger }))

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
    mocks.logger.error.mockClear()
    mocks.logger.info.mockClear()
    mocks.logger.warning.mockClear()
    api = mockMemoryApi()
    useMemoryStore.setState({
      info: null,
      processes: [],
      loading: false,
      optimizing: false,
      errorKind: null,
      success: null,
      progress: null,
      result: null,
    })
  })

  it('starts with default state', () => {
    const state = useMemoryStore.getState()
    expect(state.info).toBeNull()
    expect(state.processes).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.optimizing).toBe(false)
    expect(state.errorKind).toBeNull()
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

  it('load sets errorKind on failure and logs it', async () => {
    api.memoryInfo.mockRejectedValueOnce(new Error('fail'))
    await useMemoryStore.getState().load()
    const state = useMemoryStore.getState()
    expect(state.loading).toBe(false)
    expect(state.errorKind).toBe('load')
    expect(state.info).toBeNull()
    expect(mocks.logger.error).toHaveBeenCalledWith('memory-store', 'Failed to load memory info', expect.anything())
  })

  it('optimize subscribes to progress and unsubscribes', async () => {
    const unsub = vi.fn()
    api.onMemoryProgress.mockReturnValue(unsub)
    api.memoryOptimize.mockResolvedValue({
      success: true,
      freedBytes: 1_000_000,
      steps: [{ name: 'gc', success: true, freedBytes: 1_000_000 }],
    })
    api.memoryInfo.mockResolvedValue(fakeInfo)
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(api.onMemoryProgress).toHaveBeenCalled()
    expect(api.memoryOptimize).toHaveBeenCalled()
    expect(state.optimizing).toBe(false)
    expect(state.result?.success).toBe(true)
    expect(unsub).toHaveBeenCalled()
  })

  it('optimize sets non-partial success and refreshes info', async () => {
    api.onMemoryProgress.mockReturnValue(vi.fn())
    api.memoryOptimize.mockResolvedValueOnce({
      success: true,
      freedBytes: 1_000_000,
      steps: [{ name: 'gc', success: true, freedBytes: 1_000_000 }],
    })
    api.memoryInfo.mockResolvedValueOnce(fakeInfo)
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(state.success).toEqual({ freedBytes: 1_000_000, partial: false })
    expect(state.errorKind).toBeNull()
    expect(state.info).toEqual(fakeInfo.info)
  })

  it('optimize flags partial success when one step fails', async () => {
    api.memoryOptimize.mockResolvedValueOnce({
      success: true,
      freedBytes: 2_097_152,
      steps: [
        { name: 'gc', success: true, freedBytes: 2_097_152 },
        { name: 'workingset', success: false, freedBytes: 0, error: 'nope' },
      ],
    })
    api.memoryInfo.mockResolvedValueOnce(fakeInfo)
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(state.success).toEqual({ freedBytes: 2_097_152, partial: true })
    expect(state.errorKind).toBeNull()
  })

  it('optimize sets errorKind when no step succeeds', async () => {
    api.memoryOptimize.mockResolvedValueOnce({
      success: false,
      freedBytes: 0,
      steps: [{ name: 'gc', success: false, freedBytes: 0 }],
    })
    api.memoryInfo.mockResolvedValueOnce(fakeInfo)
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(state.errorKind).toBe('optimize')
    expect(state.success).toBeNull()
    expect(state.result?.success).toBe(false)
    expect(state.optimizing).toBe(false)
  })

  it('optimize sets errorKind and logs on rejection', async () => {
    api.memoryOptimize.mockRejectedValueOnce(new Error('fail'))
    api.onMemoryProgress.mockReturnValueOnce(vi.fn())
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(state.optimizing).toBe(false)
    expect(state.errorKind).toBe('optimize')
    expect(mocks.logger.error).toHaveBeenCalledWith('memory-store', 'Memory optimization failed', expect.anything())
  })

  it('keeps the success result when the post-optimize refresh fails', async () => {
    api.memoryOptimize.mockResolvedValueOnce({
      success: true,
      freedBytes: 500,
      steps: [{ name: 'gc', success: true, freedBytes: 500 }],
    })
    api.memoryInfo.mockRejectedValueOnce(new Error('refresh fail'))
    await useMemoryStore.getState().optimize()
    const state = useMemoryStore.getState()
    expect(state.success).toEqual({ freedBytes: 500, partial: false })
    expect(state.errorKind).toBeNull()
    expect(mocks.logger.error).toHaveBeenCalledWith(
      'memory-store',
      expect.stringContaining('refresh'),
      expect.anything(),
    )
  })

  it('optimize no-ops if already optimizing', async () => {
    useMemoryStore.setState({ optimizing: true })
    await useMemoryStore.getState().optimize()
    expect(api.memoryOptimize).not.toHaveBeenCalled()
  })

  it('clearError and clearSuccess reset their flags', () => {
    useMemoryStore.setState({ errorKind: 'load', success: { freedBytes: 1, partial: false } })
    useMemoryStore.getState().clearError()
    expect(useMemoryStore.getState().errorKind).toBeNull()
    useMemoryStore.getState().clearSuccess()
    expect(useMemoryStore.getState().success).toBeNull()
  })
})
