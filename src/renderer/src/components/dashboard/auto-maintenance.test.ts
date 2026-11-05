import { describe, expect, it } from 'vitest'
import {
  type AutoMaintenanceOptions,
  countAutoMaintenanceSteps,
  DEFAULT_AUTO_MAINTENANCE_OPTIONS,
} from './auto-maintenance'

function options(overrides: Partial<AutoMaintenanceOptions> = {}): AutoMaintenanceOptions {
  return { ...DEFAULT_AUTO_MAINTENANCE_OPTIONS, ...overrides }
}

function only(overrides: Partial<AutoMaintenanceOptions> = {}): AutoMaintenanceOptions {
  const disabled = Object.fromEntries(
    (Object.keys(DEFAULT_AUTO_MAINTENANCE_OPTIONS) as Array<keyof AutoMaintenanceOptions>).map((key) => [key, false]),
  ) as AutoMaintenanceOptions
  return { ...disabled, ...overrides }
}

describe('countAutoMaintenanceSteps', () => {
  it('counts every phase when the platform supports registry and drivers', () => {
    // 1 repair + 2 deep clean + 1 registry + 1 malware + 1 privacy + 1 startup
    // + 1 software + 1 drivers + 1 stale drivers + 1 vulnerabilities + 4 performance
    expect(countAutoMaintenanceSteps(options(), true, true)).toBe(15)
  })

  it('drops the registry and driver steps when the platform does not support them', () => {
    expect(countAutoMaintenanceSteps(options(), false, false)).toBe(12)
  })

  it('returns zero when every phase is deselected', () => {
    expect(countAutoMaintenanceSteps(only(), true, true)).toBe(0)
  })

  it('counts a single selected phase', () => {
    expect(countAutoMaintenanceSteps(only({ deepClean: true }), true, true)).toBe(2)
  })

  it('does not count unsupported phases even when the option is on', () => {
    expect(
      countAutoMaintenanceSteps(only({ registry: true, driverUpdates: true, staleDrivers: true }), false, false),
    ).toBe(0)
  })

  it('counts performance as four steps', () => {
    expect(countAutoMaintenanceSteps(only({ performance: true }), true, true)).toBe(4)
  })

  it('counts one step for each security and cleanup phase', () => {
    const security = only({ malware: true, privacy: true, startup: true, vulnerabilities: true })

    expect(countAutoMaintenanceSteps(security, true, true)).toBe(4)
  })

  it('counts stale driver removal only when drivers are supported', () => {
    const stale = only({ staleDrivers: true })

    expect(countAutoMaintenanceSteps(stale, true, true)).toBe(1)
    expect(countAutoMaintenanceSteps(stale, true, false)).toBe(0)
  })
})
