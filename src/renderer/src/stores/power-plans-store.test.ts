import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePowerPlansStore } from './power-plans-store'

function makePlan(
  overrides: Partial<{
    guid: string
    name: string
    description: string
    isActive: boolean
    isHighPerformance: boolean
    isBalanced: boolean
    isPowerSaver: boolean
  }> = {},
) {
  return {
    guid: overrides.guid ?? 'guid-1',
    name: overrides.name ?? 'Balanced',
    description: overrides.description ?? '',
    isActive: overrides.isActive ?? false,
    isHighPerformance: overrides.isHighPerformance ?? false,
    isBalanced: overrides.isBalanced ?? true,
    isPowerSaver: overrides.isPowerSaver ?? false,
  }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    dinho: {
      powerPlansList: vi.fn(),
      powerPlansActivate: vi.fn(),
      powerPlansCreate: vi.fn(),
      powerPlansDelete: vi.fn(),
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  usePowerPlansStore.setState({
    plans: [],
    loading: false,
    activating: false,
    error: null,
    activeGuid: null,
    lastResult: null,
  })
})

describe('power-plans-store', () => {
  it('starts with default values', () => {
    const s = usePowerPlansStore.getState()
    expect(s.plans).toEqual([])
    expect(s.loading).toBe(false)
    expect(s.activating).toBe(false)
    expect(s.error).toBeNull()
    expect(s.activeGuid).toBeNull()
    expect(s.lastResult).toBeNull()
  })

  it('loadPlans fetches plans and sets activeGuid', async () => {
    const plans = [makePlan({ guid: 'a', isActive: true }), makePlan({ guid: 'b' })]
    vi.mocked(window.dinho.powerPlansList).mockResolvedValue(plans)
    await usePowerPlansStore.getState().loadPlans()
    const s = usePowerPlansStore.getState()
    expect(s.plans).toEqual(plans)
    expect(s.loading).toBe(false)
    expect(s.activeGuid).toBe('a')
  })

  it('loadPlans handles no active plan', async () => {
    vi.mocked(window.dinho.powerPlansList).mockResolvedValue([makePlan({ guid: 'a', isActive: false })])
    await usePowerPlansStore.getState().loadPlans()
    expect(usePowerPlansStore.getState().activeGuid).toBeNull()
  })

  it('loadPlans sets error on failure', async () => {
    vi.mocked(window.dinho.powerPlansList).mockRejectedValue(new Error('fail'))
    await usePowerPlansStore.getState().loadPlans()
    const s = usePowerPlansStore.getState()
    expect(s.loading).toBe(false)
    expect(s.error).toBeTruthy()
  })

  it('activatePlan calls API and updates state on success', async () => {
    usePowerPlansStore.setState({ plans: [makePlan({ guid: 'a' }), makePlan({ guid: 'b', isActive: true })] })
    vi.mocked(window.dinho.powerPlansActivate).mockResolvedValue({ success: true })
    await usePowerPlansStore.getState().activatePlan('a')
    const s = usePowerPlansStore.getState()
    expect(s.activating).toBe(false)
    expect(s.activeGuid).toBe('a')
    expect(s.plans.find((p) => p.guid === 'a')!.isActive).toBe(true)
    expect(s.plans.find((p) => p.guid === 'b')!.isActive).toBe(false)
    expect(s.lastResult).toEqual({ success: true })
  })

  it('activatePlan sets error on API failure', async () => {
    vi.mocked(window.dinho.powerPlansActivate).mockResolvedValue({ success: false, error: 'access denied' })
    await usePowerPlansStore.getState().activatePlan('a')
    const s = usePowerPlansStore.getState()
    expect(s.activating).toBe(false)
    expect(s.error).toBe('access denied')
    expect(s.lastResult).toEqual({ success: false, error: 'access denied' })
  })

  it('activatePlan sets error on exception', async () => {
    vi.mocked(window.dinho.powerPlansActivate).mockRejectedValue(new Error('network'))
    await usePowerPlansStore.getState().activatePlan('a')
    expect(usePowerPlansStore.getState().error).toBeTruthy()
  })

  it('createPlan calls API and reloads plans on success', async () => {
    vi.mocked(window.dinho.powerPlansCreate).mockResolvedValue({ success: true })
    vi.mocked(window.dinho.powerPlansList).mockResolvedValue([])
    await usePowerPlansStore.getState().createPlan('My Plan')
    expect(window.dinho.powerPlansCreate).toHaveBeenCalledWith('My Plan')
    expect(window.dinho.powerPlansList).toHaveBeenCalled()
  })

  it('createPlan sets error on API failure', async () => {
    vi.mocked(window.dinho.powerPlansCreate).mockResolvedValue({ success: false, error: 'exists' })
    await usePowerPlansStore.getState().createPlan('My Plan')
    expect(usePowerPlansStore.getState().error).toBe('exists')
  })

  it('createPlan sets error on exception', async () => {
    vi.mocked(window.dinho.powerPlansCreate).mockRejectedValue(new Error('fail'))
    await usePowerPlansStore.getState().createPlan('My Plan')
    expect(usePowerPlansStore.getState().error).toBeTruthy()
  })

  it('deletePlan removes plan and clears activeGuid if deleted was active', async () => {
    usePowerPlansStore.setState({ plans: [makePlan({ guid: 'a', isActive: true })], activeGuid: 'a' })
    vi.mocked(window.dinho.powerPlansDelete).mockResolvedValue({ success: true })
    await usePowerPlansStore.getState().deletePlan('a')
    const s = usePowerPlansStore.getState()
    expect(s.plans).toHaveLength(0)
    expect(s.activeGuid).toBeNull()
  })

  it('deletePlan keeps activeGuid when deleting inactive plan', async () => {
    usePowerPlansStore.setState({
      plans: [makePlan({ guid: 'a', isActive: true }), makePlan({ guid: 'b' })],
      activeGuid: 'a',
    })
    vi.mocked(window.dinho.powerPlansDelete).mockResolvedValue({ success: true })
    await usePowerPlansStore.getState().deletePlan('b')
    expect(usePowerPlansStore.getState().activeGuid).toBe('a')
  })

  it('deletePlan sets error on failure', async () => {
    vi.mocked(window.dinho.powerPlansDelete).mockResolvedValue({ success: false, error: 'in use' })
    await usePowerPlansStore.getState().deletePlan('a')
    expect(usePowerPlansStore.getState().error).toBe('in use')
  })

  it('deletePlan sets error on exception', async () => {
    vi.mocked(window.dinho.powerPlansDelete).mockRejectedValue(new Error('fail'))
    await usePowerPlansStore.getState().deletePlan('a')
    expect(usePowerPlansStore.getState().error).toBeTruthy()
  })

  it('clearError clears error', () => {
    usePowerPlansStore.setState({ error: 'some error' })
    usePowerPlansStore.getState().clearError()
    expect(usePowerPlansStore.getState().error).toBeNull()
  })
})
