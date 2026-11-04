import { describe, expect, it } from 'vitest'
import {
  type AutoMaintenanceOptions,
  countAutoMaintenanceSteps,
  DEFAULT_AUTO_MAINTENANCE_OPTIONS,
} from './auto-maintenance'

function options(overrides: Partial<AutoMaintenanceOptions> = {}): AutoMaintenanceOptions {
  return { ...DEFAULT_AUTO_MAINTENANCE_OPTIONS, ...overrides }
}

describe('countAutoMaintenanceSteps', () => {
  it('counts every phase when the platform supports registry and drivers', () => {
    // 1 repair + 2 deep clean + 1 registry + 1 software + 1 drivers + 4 performance
    expect(countAutoMaintenanceSteps(options(), true, true)).toBe(10)
  })

  it('drops the registry and driver steps when the platform does not support them', () => {
    expect(countAutoMaintenanceSteps(options(), false, false)).toBe(8)
  })

  it('returns zero when every phase is deselected', () => {
    const none = options({
      systemRepair: false,
      deepClean: false,
      registry: false,
      softwareUpdates: false,
      driverUpdates: false,
      performance: false,
    })

    expect(countAutoMaintenanceSteps(none, true, true)).toBe(0)
  })

  it('counts a single selected phase', () => {
    const onlyClean = options({
      systemRepair: false,
      registry: false,
      softwareUpdates: false,
      driverUpdates: false,
      performance: false,
    })

    expect(countAutoMaintenanceSteps(onlyClean, true, true)).toBe(2)
  })

  it('does not count unsupported phases even when the option is on', () => {
    const onlyUnsupported = options({
      systemRepair: false,
      deepClean: false,
      softwareUpdates: false,
      performance: false,
    })

    expect(countAutoMaintenanceSteps(onlyUnsupported, false, false)).toBe(0)
  })

  it('counts performance as four steps', () => {
    const onlyPerformance = options({
      systemRepair: false,
      deepClean: false,
      registry: false,
      softwareUpdates: false,
      driverUpdates: false,
    })

    expect(countAutoMaintenanceSteps(onlyPerformance, true, true)).toBe(4)
  })
})
