export type AutoMaintenancePhase =
  | 'systemRepair'
  | 'deepClean'
  | 'registry'
  | 'softwareUpdates'
  | 'driverUpdates'
  | 'performance'

export type AutoMaintenanceOptions = Record<AutoMaintenancePhase, boolean>

export const DEFAULT_AUTO_MAINTENANCE_OPTIONS: AutoMaintenanceOptions = {
  systemRepair: true,
  deepClean: true,
  registry: true,
  softwareUpdates: true,
  driverUpdates: true,
  performance: true,
}

/**
 * Number of progress steps the selected phases will actually run.
 * Kept next to the pipeline so the bar always finishes at 100%.
 */
export function countAutoMaintenanceSteps(
  options: AutoMaintenanceOptions,
  hasRegistry: boolean,
  hasDrivers: boolean,
): number {
  return (
    (options.systemRepair ? 1 : 0) +
    (options.deepClean ? 2 : 0) +
    (options.registry && hasRegistry ? 1 : 0) +
    (options.softwareUpdates ? 1 : 0) +
    (options.driverUpdates && hasDrivers ? 1 : 0) +
    (options.performance ? 4 : 0)
  )
}
