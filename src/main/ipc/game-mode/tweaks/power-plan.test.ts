import type { GameModeSnapshot, PowerPlanInfo } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockActivatePowerPlan = vi.fn()
const mockCreatePowerPlan = vi.fn()
const mockGetActivePowerPlanGuid = vi.fn()
const mockListPowerPlans = vi.fn()
const mockUnlockUltimatePerformance = vi.fn()

vi.mock('../../../services/power-plans', () => ({
  activatePowerPlan: mockActivatePowerPlan,
  createPowerPlan: mockCreatePowerPlan,
  getActivePowerPlanGuid: mockGetActivePowerPlanGuid,
  listPowerPlans: mockListPowerPlans,
  unlockUltimatePerformance: mockUnlockUltimatePerformance,
}))

const { applyMaxPerformancePowerPlan, pickMaxPerformancePlan, restoreOriginalPowerPlan } = await import('./power-plan')

const BALANCED = '381b4222-f694-41f0-9685-ff5bb260df2e'
const HIGH = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'
const ULTIMATE = '0f25382e-e29e-4f06-8898-7998112419de'
const POWER_SAVER = 'a1841308-3541-4fab-bc81-f71556f20b4a'

function plan(guid: string, name: string, flags: Partial<PowerPlanInfo> = {}): PowerPlanInfo {
  return {
    guid,
    name,
    description: name,
    isActive: false,
    isHighPerformance: false,
    isBalanced: false,
    isPowerSaver: false,
    isUltimatePerformance: false,
    ...flags,
  }
}

function snapshot(overrides: Partial<GameModeSnapshot> = {}): GameModeSnapshot {
  return {
    activatedAt: '2026-11-09T10:00:00.000Z',
    active: true,
    services: [],
    killedProcesses: [],
    originalPowerPlanGuid: null,
    originalFocusAssistState: null,
    powerSaveBlockerId: null,
    originalTimerResolution: null,
    nagleInterfaces: [],
    registryTweaks: [],
    gameProcessPriorities: [],
    ...overrides,
  }
}

/** Queue the values `getActivePowerPlanGuid` returns on each successive read. */
function activePlanSequence(...guids: Array<string | null>): void {
  for (const guid of guids) mockGetActivePowerPlanGuid.mockResolvedValueOnce(guid)
}

beforeEach(() => {
  mockActivatePowerPlan.mockReset()
  mockCreatePowerPlan.mockReset()
  mockGetActivePowerPlanGuid.mockReset()
  mockListPowerPlans.mockReset()
  mockUnlockUltimatePerformance.mockReset()

  mockActivatePowerPlan.mockResolvedValue({ success: true })
  mockCreatePowerPlan.mockResolvedValue({ success: false })
  mockGetActivePowerPlanGuid.mockResolvedValue(BALANCED)
  mockListPowerPlans.mockResolvedValue([plan(BALANCED, 'Equilibrado', { isBalanced: true })])
  mockUnlockUltimatePerformance.mockResolvedValue({ success: false })
})

describe('pickMaxPerformancePlan', () => {
  it('prefers Ultimate Performance over High Performance', () => {
    const picked = pickMaxPerformancePlan([
      plan(BALANCED, 'Equilibrado', { isBalanced: true }),
      plan(HIGH, 'Alto desempenho', { isHighPerformance: true }),
      plan(ULTIMATE, 'Desempenho Máximo', { isHighPerformance: true, isUltimatePerformance: true }),
    ])

    expect(picked?.guid).toBe(ULTIMATE)
  })

  it('keeps the currently active max-performance plan instead of switching to another one', () => {
    const picked = pickMaxPerformancePlan([
      plan('91c3989b-1192-41f2-8f75-cba51dce07ea', 'Desempenho Máximo', { isUltimatePerformance: true }),
      plan(ULTIMATE, 'Desempenho Máximo', { isUltimatePerformance: true, isActive: true }),
    ])

    expect(picked?.guid).toBe(ULTIMATE)
  })

  it('falls back to High Performance when no Ultimate plan exists', () => {
    const picked = pickMaxPerformancePlan([
      plan(BALANCED, 'Equilibrado', { isBalanced: true }),
      plan(HIGH, 'Alto desempenho', { isHighPerformance: true }),
    ])

    expect(picked?.guid).toBe(HIGH)
  })

  it('returns null when only balanced or power-saver plans exist', () => {
    expect(
      pickMaxPerformancePlan([
        plan(BALANCED, 'Equilibrado', { isBalanced: true }),
        plan(POWER_SAVER, 'Economia de energia', { isPowerSaver: true }),
      ]),
    ).toBeNull()
  })

  it('ignores entries without a GUID', () => {
    const picked = pickMaxPerformancePlan([
      plan('', 'Desempenho Máximo', { isUltimatePerformance: true }),
      plan(HIGH, 'Alto desempenho', { isHighPerformance: true }),
    ])

    expect(picked?.guid).toBe(HIGH)
  })
})

describe('applyMaxPerformancePowerPlan', () => {
  it('captures the previous plan, activates the best one and records both GUIDs', async () => {
    mockListPowerPlans.mockResolvedValue([
      plan(BALANCED, 'Equilibrado', { isBalanced: true }),
      plan(HIGH, 'Alto desempenho', { isHighPerformance: true }),
    ])
    activePlanSequence(BALANCED, HIGH)
    const snap = snapshot()

    await applyMaxPerformancePowerPlan(snap)

    expect(snap.originalPowerPlanGuid).toBe(BALANCED)
    expect(snap.appliedPowerPlanGuid).toBe(HIGH)
    expect(mockActivatePowerPlan).toHaveBeenCalledExactlyOnceWith(HIGH)
  })

  it('does not touch the active plan when it already is the best one', async () => {
    mockGetActivePowerPlanGuid.mockResolvedValue(ULTIMATE)
    mockListPowerPlans.mockResolvedValue([
      plan(ULTIMATE, 'Desempenho Máximo', { isUltimatePerformance: true, isActive: true }),
    ])
    const snap = snapshot()

    await applyMaxPerformancePowerPlan(snap)

    expect(mockActivatePowerPlan).not.toHaveBeenCalled()
    expect(snap.originalPowerPlanGuid).toBe(ULTIMATE)
    expect(snap.appliedPowerPlanGuid).toBe(ULTIMATE)
  })

  it('leaves the plan untouched when the active plan cannot be read', async () => {
    mockGetActivePowerPlanGuid.mockResolvedValue(null)
    const snap = snapshot()

    await expect(applyMaxPerformancePowerPlan(snap)).rejects.toThrow(/active power plan/i)

    expect(mockActivatePowerPlan).not.toHaveBeenCalled()
    expect(snap.originalPowerPlanGuid).toBeNull()
    expect(snap.appliedPowerPlanGuid).toBeUndefined()
  })

  it('unlocks Ultimate Performance when no max-performance plan exists yet', async () => {
    mockUnlockUltimatePerformance.mockResolvedValue({ success: true, guid: ULTIMATE })
    activePlanSequence(BALANCED, ULTIMATE)
    const snap = snapshot()

    await applyMaxPerformancePowerPlan(snap)

    expect(mockUnlockUltimatePerformance).toHaveBeenCalledOnce()
    expect(mockActivatePowerPlan).toHaveBeenCalledExactlyOnceWith(ULTIMATE)
    expect(snap.appliedPowerPlanGuid).toBe(ULTIMATE)
  })

  it('creates a plan when Ultimate Performance cannot be unlocked', async () => {
    mockUnlockUltimatePerformance.mockResolvedValue({ success: false, error: 'not available' })
    mockCreatePowerPlan.mockResolvedValue({ success: true, guid: ULTIMATE })
    activePlanSequence(BALANCED, ULTIMATE)
    const snap = snapshot()

    await applyMaxPerformancePowerPlan(snap)

    expect(mockCreatePowerPlan).toHaveBeenCalledOnce()
    expect(mockActivatePowerPlan).toHaveBeenCalledExactlyOnceWith(ULTIMATE)
    expect(snap.appliedPowerPlanGuid).toBe(ULTIMATE)
  })

  it('fails without changing anything when no max-performance plan can be resolved', async () => {
    mockCreatePowerPlan.mockResolvedValue({ success: false, error: 'denied' })
    const snap = snapshot()

    await expect(applyMaxPerformancePowerPlan(snap)).rejects.toThrow(/No high performance power plan/i)

    expect(mockActivatePowerPlan).not.toHaveBeenCalled()
    expect(snap.appliedPowerPlanGuid).toBeUndefined()
  })

  it('surfaces the activation error', async () => {
    mockListPowerPlans.mockResolvedValue([plan(HIGH, 'Alto desempenho', { isHighPerformance: true })])
    mockActivatePowerPlan.mockResolvedValue({ success: false, error: 'Access denied' })
    const snap = snapshot()

    await expect(applyMaxPerformancePowerPlan(snap)).rejects.toThrow('Access denied')

    expect(snap.appliedPowerPlanGuid).toBeUndefined()
  })

  it('fails when the read-back shows a different plan', async () => {
    mockListPowerPlans.mockResolvedValue([plan(HIGH, 'Alto desempenho', { isHighPerformance: true })])
    activePlanSequence(BALANCED, BALANCED)
    const snap = snapshot()

    await expect(applyMaxPerformancePowerPlan(snap)).rejects.toThrow(/expected/i)

    expect(snap.appliedPowerPlanGuid).toBeUndefined()
  })

  it('does not fail when the read-back cannot be read', async () => {
    mockListPowerPlans.mockResolvedValue([plan(HIGH, 'Alto desempenho', { isHighPerformance: true })])
    activePlanSequence(BALANCED, null)
    const snap = snapshot()

    await applyMaxPerformancePowerPlan(snap)

    expect(snap.appliedPowerPlanGuid).toBe(HIGH)
  })

  it('normalises GUIDs to lower case', async () => {
    mockListPowerPlans.mockResolvedValue([plan(HIGH.toUpperCase(), 'Alto desempenho', { isHighPerformance: true })])
    activePlanSequence(BALANCED, HIGH)
    const snap = snapshot()

    await applyMaxPerformancePowerPlan(snap)

    expect(snap.appliedPowerPlanGuid).toBe(HIGH)
  })
})

describe('restoreOriginalPowerPlan', () => {
  it('restores the original plan when the active plan is still the one we applied', async () => {
    activePlanSequence(HIGH, BALANCED)

    await restoreOriginalPowerPlan(BALANCED, HIGH)

    expect(mockActivatePowerPlan).toHaveBeenCalledExactlyOnceWith(BALANCED)
  })

  it('leaves a plan the user changed manually alone', async () => {
    mockGetActivePowerPlanGuid.mockResolvedValue(ULTIMATE)

    await restoreOriginalPowerPlan(BALANCED, HIGH)

    expect(mockActivatePowerPlan).not.toHaveBeenCalled()
  })

  it('does nothing when the original plan is already active', async () => {
    mockGetActivePowerPlanGuid.mockResolvedValue(BALANCED)

    await restoreOriginalPowerPlan(BALANCED, HIGH)

    expect(mockActivatePowerPlan).not.toHaveBeenCalled()
  })

  it('does nothing when the active plan cannot be read and an applied GUID is recorded', async () => {
    mockGetActivePowerPlanGuid.mockResolvedValue(null)

    await restoreOriginalPowerPlan(BALANCED, HIGH)

    expect(mockActivatePowerPlan).not.toHaveBeenCalled()
  })

  it('restores legacy snapshots that have no applied GUID', async () => {
    activePlanSequence(ULTIMATE, BALANCED)

    await restoreOriginalPowerPlan(BALANCED, null)

    expect(mockActivatePowerPlan).toHaveBeenCalledExactlyOnceWith(BALANCED)
  })

  it('does nothing when there is no original GUID to restore', async () => {
    await restoreOriginalPowerPlan('', HIGH)

    expect(mockGetActivePowerPlanGuid).not.toHaveBeenCalled()
    expect(mockActivatePowerPlan).not.toHaveBeenCalled()
  })

  it('surfaces the restore error', async () => {
    mockActivatePowerPlan.mockResolvedValue({ success: false, error: 'Access denied' })
    activePlanSequence(HIGH, BALANCED)

    await expect(restoreOriginalPowerPlan(BALANCED, HIGH)).rejects.toThrow('Access denied')
  })

  it('fails when the read-back does not match the original plan', async () => {
    activePlanSequence(HIGH, HIGH)

    await expect(restoreOriginalPowerPlan(BALANCED, HIGH)).rejects.toThrow(/expected/i)
  })

  it('does not fail when the read-back cannot be read', async () => {
    activePlanSequence(HIGH, null)

    await expect(restoreOriginalPowerPlan(BALANCED, HIGH)).resolves.toBeUndefined()
  })
})
