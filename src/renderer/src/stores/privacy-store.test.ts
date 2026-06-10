import { describe, it, expect, beforeEach } from 'vitest'
import { usePrivacyStore } from './privacy-store'

function mockKudu() {
  const mock = {
    privacyScan: vi.fn(),
    privacyApply: vi.fn(),
    privacyRevert: vi.fn(),
    onPrivacyProgress: vi.fn(() => vi.fn()),
  }
  if (typeof window === 'undefined') {
    ;(globalThis as any).window = {}
  }
  ;(window as any).dinho = mock
  return mock
}

describe('privacy-store', () => {
  beforeEach(() => {
    usePrivacyStore.getState().reset()
  })

  it('starts in idle state', () => {
    const state = usePrivacyStore.getState()
    expect(state.state).toBeNull()
    expect(state.status).toBe('idle')
    expect(state.applyResult).toBeNull()
    expect(state.expandedCategories.size).toBe(0)
    expect(state.progress).toBeNull()
  })

  it('setStatus transitions status', () => {
    usePrivacyStore.getState().setStatus('scanning')
    expect(usePrivacyStore.getState().status).toBe('scanning')

    usePrivacyStore.getState().setStatus('applying')
    expect(usePrivacyStore.getState().status).toBe('applying')

    usePrivacyStore.getState().setStatus('done')
    expect(usePrivacyStore.getState().status).toBe('done')
  })

  it('setState stores privacy shield state', () => {
    const mockState = { categories: [], score: 75 } as any
    usePrivacyStore.getState().setState(mockState)
    expect(usePrivacyStore.getState().state).toEqual(mockState)
  })

  it('toggleCategory adds category to expanded set', () => {
    usePrivacyStore.getState().toggleCategory('telemetry')
    expect(usePrivacyStore.getState().expandedCategories.has('telemetry')).toBe(true)
  })

  it('toggleCategory removes category when already expanded', () => {
    usePrivacyStore.getState().toggleCategory('telemetry')
    usePrivacyStore.getState().toggleCategory('telemetry')
    expect(usePrivacyStore.getState().expandedCategories.has('telemetry')).toBe(false)
  })

  it('toggleCategory can track multiple categories', () => {
    usePrivacyStore.getState().toggleCategory('telemetry')
    usePrivacyStore.getState().toggleCategory('tracking')
    usePrivacyStore.getState().toggleCategory('advertising')

    const { expandedCategories } = usePrivacyStore.getState()
    expect(expandedCategories.size).toBe(3)
    expect(expandedCategories.has('telemetry')).toBe(true)
    expect(expandedCategories.has('tracking')).toBe(true)
    expect(expandedCategories.has('advertising')).toBe(true)
  })

  it('setApplyResult stores the apply result', () => {
    const result = { applied: 5, failed: 0, failures: [] } as any
    usePrivacyStore.getState().setApplyResult(result)
    expect(usePrivacyStore.getState().applyResult).toEqual(result)
  })

  it('setProgress tracks scan progress', () => {
    const progress = { current: 3, total: 10, currentSetting: 'Telemetry' } as any
    usePrivacyStore.getState().setProgress(progress)
    expect(usePrivacyStore.getState().progress).toEqual(progress)
  })

  it('setExpandedCategories replaces the set', () => {
    usePrivacyStore.getState().toggleCategory('telemetry')
    usePrivacyStore.getState().setExpandedCategories(new Set(['tracking', 'ads']))
    const { expandedCategories } = usePrivacyStore.getState()
    expect(expandedCategories.size).toBe(2)
    expect(expandedCategories.has('tracking')).toBe(true)
    expect(expandedCategories.has('ads')).toBe(true)
    expect(expandedCategories.has('telemetry')).toBe(false)
  })

  it('reset clears all state back to defaults', () => {
    usePrivacyStore.getState().setStatus('done')
    usePrivacyStore.getState().setState({ categories: [] } as any)
    usePrivacyStore.getState().toggleCategory('telemetry')
    usePrivacyStore.getState().setApplyResult({ applied: 1 } as any)

    usePrivacyStore.getState().reset()

    const state = usePrivacyStore.getState()
    expect(state.status).toBe('idle')
    expect(state.state).toBeNull()
    expect(state.expandedCategories.size).toBe(0)
    expect(state.applyResult).toBeNull()
    expect(state.progress).toBeNull()
  })

  describe('async actions', () => {
    it('scan sets scanning status and calls kudu.privacyScan', async () => {
      const kudu = mockKudu()
      kudu.privacyScan.mockResolvedValue({ categories: [], score: 80 })
      const store = usePrivacyStore.getState()

      await store.scan()

      expect(kudu.onPrivacyProgress).toHaveBeenCalled()
      expect(kudu.privacyScan).toHaveBeenCalled()
      expect(usePrivacyStore.getState().status).toBe('done')
      expect(usePrivacyStore.getState().state).toEqual({ categories: [], score: 80 })
    })

    it('scan resets to idle on error', async () => {
      const kudu = mockKudu()
      kudu.privacyScan.mockRejectedValue(new Error('fail'))
      const store = usePrivacyStore.getState()

      await store.scan()

      expect(usePrivacyStore.getState().status).toBe('idle')
    })

    it('apply calls kudu.privacyApply and re-scans', async () => {
      const kudu = mockKudu()
      kudu.privacyApply.mockResolvedValue({ applied: 3, failed: 0 })
      kudu.privacyScan.mockResolvedValue({ categories: [], score: 100 })
      const store = usePrivacyStore.getState()

      await store.apply(['setting-1', 'setting-2'])

      expect(kudu.privacyApply).toHaveBeenCalledWith(['setting-1', 'setting-2'])
      expect(usePrivacyStore.getState().status).toBe('done')
      expect(usePrivacyStore.getState().applyResult).toEqual({ applied: 3, failed: 0 })
    })

    it('apply sets status done on error', async () => {
      const kudu = mockKudu()
      kudu.privacyApply.mockRejectedValue(new Error('fail'))
      const store = usePrivacyStore.getState()

      await store.apply(['test'])

      expect(usePrivacyStore.getState().status).toBe('done')
    })

    it('revert calls kudu.privacyRevert and re-scans', async () => {
      const kudu = mockKudu()
      kudu.privacyRevert.mockResolvedValue({ applied: 2, failed: 1, failures: [] })
      kudu.privacyScan.mockResolvedValue({ categories: [], score: 50 })
      const store = usePrivacyStore.getState()

      await store.revert(['setting-1'])

      expect(kudu.privacyRevert).toHaveBeenCalledWith(['setting-1'])
      expect(usePrivacyStore.getState().status).toBe('done')
      expect(usePrivacyStore.getState().applyResult).toEqual({ applied: 2, failed: 1, failures: [] })
    })

    it('revert sets status done on error', async () => {
      const kudu = mockKudu()
      kudu.privacyRevert.mockRejectedValue(new Error('fail'))
      const store = usePrivacyStore.getState()

      await store.revert(['test'])

      expect(usePrivacyStore.getState().status).toBe('done')
    })
  })
})
