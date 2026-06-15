import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDriverAgentStore } from './driver-agent-store'

function makeCandidate(
  updateId: string,
  overrides: Partial<{
    approved: boolean
    consensusLabel: import('@shared/driver-agent-types').DriverCandidate['consensusLabel']
  }> = {},
) {
  return {
    updateId,
    deviceName: 'Device',
    deviceId: 'DEVICE\\001',
    className: 'Display',
    currentVersion: '0.9',
    availableVersion: '1.0',
    currentDate: '2024-01-01',
    availableDate: '2025-01-01',
    provider: 'TestCorp',
    updateTitle: `Driver ${updateId}`,
    downloadSize: '10 MB',
    verdicts: [],
    consensusScore: 80,
    consensusLabel: overrides.consensusLabel ?? 'recommended',
    approved: overrides.approved ?? false,
  }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    dinho: {
      driverAgentEvaluate: vi.fn(),
      driverAgentApprove: vi.fn(),
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useDriverAgentStore.setState({
    result: null,
    evaluating: false,
    installing: false,
    error: null,
    installResult: null,
  })
})

describe('driver-agent-store', () => {
  it('starts with default state', () => {
    const s = useDriverAgentStore.getState()
    expect(s.result).toBeNull()
    expect(s.evaluating).toBe(false)
    expect(s.installing).toBe(false)
    expect(s.error).toBeNull()
    expect(s.installResult).toBeNull()
  })

  it('evaluate calls API and stores result', async () => {
    const result: import('@shared/driver-agent-types').AgentEvaluationResult = {
      candidates: [makeCandidate('1'), makeCandidate('2')],
      totalCandidates: 2,
      evaluatedAt: '2025-01-01',
      criticalCount: 0,
      recommendedCount: 2,
      optionalCount: 0,
      cautionCount: 0,
      skipCount: 0,
    }
    vi.mocked(window.dinho.driverAgentEvaluate).mockResolvedValue(result)
    await useDriverAgentStore.getState().evaluate()
    expect(useDriverAgentStore.getState().result).toEqual(result)
    expect(useDriverAgentStore.getState().evaluating).toBe(false)
  })

  it('evaluate sets error on failure', async () => {
    vi.mocked(window.dinho.driverAgentEvaluate).mockRejectedValue(new Error('no network'))
    await useDriverAgentStore.getState().evaluate()
    expect(useDriverAgentStore.getState().evaluating).toBe(false)
    expect(useDriverAgentStore.getState().error).toBe('no network')
  })

  it('approveSelected does nothing when no candidates selected', async () => {
    useDriverAgentStore.setState({
      result: {
        candidates: [makeCandidate('1', { approved: false })],
        totalCandidates: 1,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 0,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 0,
      },
    })
    await useDriverAgentStore.getState().approveSelected()
    expect(window.dinho.driverAgentApprove).not.toHaveBeenCalled()
  })

  it('approveSelected calls API with selected ids and removes approved', async () => {
    const candidates = [makeCandidate('1', { approved: true }), makeCandidate('2', { approved: false })]
    useDriverAgentStore.setState({
      result: {
        candidates,
        totalCandidates: 2,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 2,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 0,
      },
    })
    vi.mocked(window.dinho.driverAgentApprove).mockResolvedValue({ success: true })
    await useDriverAgentStore.getState().approveSelected()
    expect(window.dinho.driverAgentApprove).toHaveBeenCalledWith(['1'])
    const r = useDriverAgentStore.getState().result
    expect(r!.candidates).toHaveLength(1)
    expect(r!.candidates[0]!.updateId).toBe('2')
    expect(r!.totalCandidates).toBe(1)
  })

  it('approveSelected sets installResult on API failure', async () => {
    useDriverAgentStore.setState({
      result: {
        candidates: [makeCandidate('1', { approved: true })],
        totalCandidates: 1,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 1,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 0,
      },
    })
    vi.mocked(window.dinho.driverAgentApprove).mockResolvedValue({ success: false, error: 'reboot required' })
    await useDriverAgentStore.getState().approveSelected()
    expect(useDriverAgentStore.getState().installResult).toEqual({ success: false, error: 'reboot required' })
    expect(useDriverAgentStore.getState().installing).toBe(false)
  })

  it('approveSelected sets error on exception', async () => {
    useDriverAgentStore.setState({
      result: {
        candidates: [makeCandidate('1', { approved: true })],
        totalCandidates: 1,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 1,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 0,
      },
    })
    vi.mocked(window.dinho.driverAgentApprove).mockRejectedValue(new Error('timeout'))
    await useDriverAgentStore.getState().approveSelected()
    expect(useDriverAgentStore.getState().error).toBe('timeout')
  })

  it('toggleCandidate toggles approved field', () => {
    useDriverAgentStore.setState({
      result: {
        candidates: [makeCandidate('1')],
        totalCandidates: 1,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 1,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 0,
      },
    })
    useDriverAgentStore.getState().toggleCandidate('1')
    expect(useDriverAgentStore.getState().result!.candidates[0]!.approved).toBe(true)
    useDriverAgentStore.getState().toggleCandidate('1')
    expect(useDriverAgentStore.getState().result!.candidates[0]!.approved).toBe(false)
  })

  it('approveAll sets approved for non-skip candidates', () => {
    useDriverAgentStore.setState({
      result: {
        candidates: [makeCandidate('1'), makeCandidate('2', { consensusLabel: 'skip' })],
        totalCandidates: 2,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 1,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 1,
      },
    })
    useDriverAgentStore.getState().approveAll()
    const c = useDriverAgentStore.getState().result!.candidates
    expect(c[0]!.approved).toBe(true)
    expect(c[1]!.approved).toBe(false)
  })

  it('clearAll sets all approved to false', () => {
    useDriverAgentStore.setState({
      result: {
        candidates: [makeCandidate('1', { approved: true }), makeCandidate('2', { approved: true })],
        totalCandidates: 2,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 2,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 0,
      },
    })
    useDriverAgentStore.getState().clearAll()
    expect(useDriverAgentStore.getState().result!.candidates.every((c) => !c.approved)).toBe(true)
  })

  it('getSelectedIds returns approved candidate ids', () => {
    useDriverAgentStore.setState({
      result: {
        candidates: [makeCandidate('1', { approved: true }), makeCandidate('2')],
        totalCandidates: 2,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 1,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 0,
      },
    })
    expect(useDriverAgentStore.getState().getSelectedIds()).toEqual(['1'])
  })

  it('getSelectedIds returns empty array when result is null', () => {
    expect(useDriverAgentStore.getState().getSelectedIds()).toEqual([])
  })

  it('reset restores initial state', () => {
    useDriverAgentStore.setState({
      result: {
        candidates: [],
        totalCandidates: 0,
        evaluatedAt: '',
        criticalCount: 0,
        recommendedCount: 0,
        optionalCount: 0,
        cautionCount: 0,
        skipCount: 0,
      },
      evaluating: true,
    })
    useDriverAgentStore.getState().reset()
    const s = useDriverAgentStore.getState()
    expect(s.result).toBeNull()
    expect(s.evaluating).toBe(false)
    expect(s.installing).toBe(false)
    expect(s.error).toBeNull()
  })
})
