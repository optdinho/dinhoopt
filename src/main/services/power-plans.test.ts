import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExecFileAsync = vi.fn()

vi.mock('./exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mockExecFileAsync(...args),
  psUtf8: (s: string) => s,
}))

import {
  activatePowerPlan,
  createPowerPlan,
  deletePowerPlan,
  getActivePowerPlanGuid,
  listPowerPlans,
  ULTIMATE_PERFORMANCE_GUID,
  unlockUltimatePerformance,
} from './power-plans'

beforeEach(() => {
  vi.clearAllMocks()
})

function mockPsSuccess(stdout: string) {
  mockExecFileAsync.mockResolvedValue({ stdout, stderr: '' })
}

function mockExecFileSuccess() {
  mockExecFileAsync.mockResolvedValue({ stdout: '', stderr: '' })
}

function mockFailure(message: string) {
  mockExecFileAsync.mockRejectedValue(new Error(message))
}

describe('listPowerPlans', () => {
  it('flags the hidden Ultimate Performance scheme', async () => {
    const json = JSON.stringify([
      {
        Guid: ULTIMATE_PERFORMANCE_GUID,
        Name: 'Desempenho Máximo',
        IsActive: false,
        IsHighPerformance: true,
        IsBalanced: false,
        IsPowerSaver: false,
        IsUltimatePerformance: true,
      },
    ])
    mockPsSuccess(json)
    const plans = await listPowerPlans()
    expect(plans[0]!.isUltimatePerformance).toBe(true)
  })

  it('reports isUltimatePerformance false when powercfg does not flag it', async () => {
    const json = JSON.stringify([
      {
        Guid: '381b4222-f694-41f0-9685-ff5bb260df2e',
        Name: 'Equilibrado',
        IsActive: true,
        IsHighPerformance: false,
        IsBalanced: true,
        IsPowerSaver: false,
        IsUltimatePerformance: false,
      },
    ])
    mockPsSuccess(json)
    const plans = await listPowerPlans()
    expect(plans[0]!.isUltimatePerformance).toBe(false)
  })

  it('returns parsed power plans from powercfg', async () => {
    const json = JSON.stringify([
      {
        Guid: 'a-b-c',
        Name: 'Balanced',
        IsActive: true,
        IsHighPerformance: false,
        IsBalanced: true,
        IsPowerSaver: false,
      },
      {
        Guid: 'd-e-f',
        Name: 'High Performance',
        IsActive: false,
        IsHighPerformance: true,
        IsBalanced: false,
        IsPowerSaver: false,
      },
    ])
    mockPsSuccess(json)
    const plans = await listPowerPlans()
    expect(plans).toHaveLength(2)
    expect(plans[0]!).toEqual({
      guid: 'a-b-c',
      name: 'Balanced',
      description: 'Balanced',
      isActive: true,
      isHighPerformance: false,
      isBalanced: true,
      isPowerSaver: false,
      isUltimatePerformance: false,
    })
    expect(plans[1]).toEqual({
      guid: 'd-e-f',
      name: 'High Performance',
      description: 'High Performance',
      isActive: false,
      isHighPerformance: true,
      isBalanced: false,
      isPowerSaver: false,
      isUltimatePerformance: false,
    })
  })

  it('returns empty array when output is empty', async () => {
    mockPsSuccess('')
    expect(await listPowerPlans()).toEqual([])
  })

  it('returns empty array when output is []', async () => {
    mockPsSuccess('[]')
    expect(await listPowerPlans()).toEqual([])
  })

  it('handles single object (not array) JSON', async () => {
    const json = JSON.stringify({
      Guid: 'x-y-z',
      Name: 'Power Saver',
      IsActive: true,
      IsHighPerformance: false,
      IsBalanced: false,
      IsPowerSaver: true,
    })
    mockPsSuccess(json)
    const plans = await listPowerPlans()
    expect(plans).toHaveLength(1)
    expect(plans[0]!.guid).toBe('x-y-z')
    expect(plans[0]!.isPowerSaver).toBe(true)
  })

  it('throws when execFileAsync rejects', async () => {
    mockFailure('powershell error')
    await expect(listPowerPlans()).rejects.toThrow('powershell error')
  })

  it('calls powershell with correct args', async () => {
    mockPsSuccess('[]')
    await listPowerPlans()
    const args = mockExecFileAsync.mock.calls[0]!
    expect(args[0]).toBe('powershell.exe')
    expect((args[1] as string[])[1]).toBe('-NonInteractive')
    expect((args[1] as string[])[3]).toContain('powercfg /LIST')
  })
})

describe('activatePowerPlan', () => {
  const validGuid = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

  it('activates a power plan by GUID', async () => {
    mockExecFileSuccess()
    const result = await activatePowerPlan(validGuid)
    expect(result).toEqual({ success: true })
  })

  it('returns error for invalid GUID', async () => {
    const result = await activatePowerPlan('not-a-guid')
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Invalid GUID')
  })

  it('returns error for non-string input', async () => {
    const result = await activatePowerPlan(123 as any)
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Invalid GUID')
  })

  it('catches powercfg failure and returns error', async () => {
    mockFailure('Access denied')
    const result = await activatePowerPlan(validGuid)
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Access denied')
  })
})

describe('createPowerPlan', () => {
  it('creates a plan from high-performance template', async () => {
    mockPsSuccess('GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c')
    const result = await createPowerPlan('My Plan')
    expect(result.success).toBe(true)
    expect(result.guid).toBe('8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c')
  })

  it('uses default name when name is empty string', async () => {
    mockPsSuccess('GUID: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    const result = await createPowerPlan('')
    expect(result.success).toBe(true)
    expect(result.guid).toBeTruthy()
  })

  it('returns error for name with only special chars (everything stripped)', async () => {
    const result = await createPowerPlan('!!!@@@###')
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Invalid plan name')
  })

  it('sanitizes name and slices to 100 chars', async () => {
    mockPsSuccess('GUID: aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee')
    const longName = 'A'.repeat(200)
    await createPowerPlan(longName)
    const nameArg = mockExecFileAsync.mock.calls[1]?.[1]?.[3] ?? ''
    expect(nameArg).not.toContain(longName)
    expect(nameArg.length).toBeLessThan(200)
  })

  it('returns error when output has no GUID match', async () => {
    mockPsSuccess('No GUID found in output')
    const result = await createPowerPlan('My Plan')
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Failed to create')
  })

  it('catches error from execFileAsync', async () => {
    mockFailure('Permission denied')
    const result = await createPowerPlan('My Plan')
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Permission denied')
  })
})

describe('deletePowerPlan', () => {
  const validGuid = '8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c'

  it('deletes a plan by GUID', async () => {
    mockExecFileSuccess()
    const result = await deletePowerPlan(validGuid)
    expect(result).toEqual({ success: true })
  })

  it('requires valid GUID', async () => {
    const result = await deletePowerPlan('bad')
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Invalid GUID')
  })

  it('catches powercfg error', async () => {
    mockFailure('Plan is active')
    const result = await deletePowerPlan(validGuid)
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Plan is active')
  })
})

describe('unlockUltimatePerformance', () => {
  it('clones the Ultimate Performance scheme and returns its new GUID', async () => {
    mockPsSuccess('Power Scheme GUID: 11111111-2222-3333-4444-555555555555')
    const result = await unlockUltimatePerformance()
    expect(result).toEqual({ success: true, guid: '11111111-2222-3333-4444-555555555555' })
  })

  it('duplicates the official Ultimate Performance GUID, not High Performance', async () => {
    mockPsSuccess('Power Scheme GUID: 11111111-2222-3333-4444-555555555555')
    await unlockUltimatePerformance()
    const script = mockExecFileAsync.mock.calls[0]?.[1]?.[3] ?? ''
    expect(script).toContain(ULTIMATE_PERFORMANCE_GUID)
    expect(script).not.toContain('8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c')
  })

  it('reports failure when the scheme does not exist on this build', async () => {
    mockPsSuccess('Unable to create a new power scheme The power scheme, subgroup or setting specified does not exist.')
    const result = await unlockUltimatePerformance()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/not available on this Windows build/i)
  })

  it('reports failure when powercfg emits no GUID', async () => {
    mockPsSuccess('')
    const result = await unlockUltimatePerformance()
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('reports failure when the scheme is already unlocked', async () => {
    mockPsSuccess('Power scheme GUID: 11111111-2222-3333-4444-555555555555 already exists')
    const result = await unlockUltimatePerformance()
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already/i)
  })

  it('catches powercfg errors', async () => {
    mockFailure('Access denied')
    const result = await unlockUltimatePerformance()
    expect(result.success).toBe(false)
    expect(result.error).toMatch('Access denied')
  })
})

describe('getActivePowerPlanGuid', () => {
  it('returns the GUID from powercfg output', async () => {
    mockPsSuccess('8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c (Balanced)')
    const guid = await getActivePowerPlanGuid()
    expect(guid).toBe('8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c')
  })

  it('returns null when no GUID found', async () => {
    mockPsSuccess('No active scheme')
    const guid = await getActivePowerPlanGuid()
    expect(guid).toBeNull()
  })

  it('returns null on execFileAsync error', async () => {
    mockFailure('powercfg not found')
    const guid = await getActivePowerPlanGuid()
    expect(guid).toBeNull()
  })
})
