import { CleanerType } from '@shared/enums'
import { useDashboardStore } from '@/stores/dashboard-store'

/**
 * Runs the same pipeline as the dashboard's "Full maintenance" button, but
 * without UI state. Used by the scheduler when the `full-maintenance` task is
 * selected.
 *
 * `autoApply` mirrors the scheduler semantics: when false, only scans are
 * performed and nothing is repaired, cleaned, installed or optimised.
 */
export interface FullMaintenanceResult {
  status: 'success' | 'partial'
  systemRepairStatus: string
  totalFound: number
  totalCleaned: number
  spaceRecovered: number
  threatsFound: number
  threatsQuarantined: number
  privacyScore: number
  privacyIssues: number
  startupHighImpact: number
  appsFound: number
  appsUpdated: number
  appsFailed: number
  driversFound: number
  driversUpdated: number
  driversFailed: number
  staleDriversRemoved: number
  staleDriversSpace: number
  vulnerabilitiesFound: number
  trimDrives: number
  powerPlanActivated: string
  networkCleaned: number
  memoryFreed: number
  rebootRequired: boolean
}

export async function runFullMaintenance(
  autoApply: boolean,
  protectRecycleBin: boolean,
): Promise<FullMaintenanceResult> {
  const result: FullMaintenanceResult = {
    status: 'success',
    systemRepairStatus: '',
    totalFound: 0,
    totalCleaned: 0,
    spaceRecovered: 0,
    threatsFound: 0,
    threatsQuarantined: 0,
    privacyScore: 0,
    privacyIssues: 0,
    startupHighImpact: 0,
    appsFound: 0,
    appsUpdated: 0,
    appsFailed: 0,
    driversFound: 0,
    driversUpdated: 0,
    driversFailed: 0,
    staleDriversRemoved: 0,
    staleDriversSpace: 0,
    vulnerabilitiesFound: 0,
    trimDrives: 0,
    powerPlanActivated: '',
    networkCleaned: 0,
    memoryFreed: 0,
    rebootRequired: false,
  }

  const markPartial = () => {
    result.status = 'partial'
  }

  // ── 1. System repair (DISM, then SFC only when DISM found/fixed something) ──
  if (autoApply) {
    try {
      const dism = await window.dinho.diskRepairDism()
      result.rebootRequired = Boolean(dism.requiresReboot)
      let repaired = dism.summaryCode === 'dismRepaired'
      let healthy = Boolean(dism.success) && !repaired

      if (dism.needsAdmin) {
        markPartial()
      } else if (!dism.success || repaired) {
        const sfc = await window.dinho.diskRepairSfc('C')
        result.rebootRequired = result.rebootRequired || Boolean(sfc.requiresReboot)
        repaired = repaired || sfc.summaryCode === 'sfcRepaired'
        healthy = healthy || (Boolean(sfc.success) && !repaired)
      }

      if (repaired) result.systemRepairStatus = 'repaired'
      else if (healthy) result.systemRepairStatus = 'healthy'
    } catch {
      markPartial()
    }
  }

  // ── 2. Deep clean (WinSxS component store + every cleaner category) ──
  try {
    if (autoApply) {
      const winsxs = await window.dinho.winSxSClean()
      const winsxsSpace = winsxs?.totalCleaned ?? 0
      const winsxsFiles = winsxs?.filesDeleted ?? 0
      result.totalFound += winsxsFiles
      result.totalCleaned += winsxsFiles
      result.spaceRecovered += winsxsSpace
    }

    const cleanerFns = useDashboardStore.getState().cleanerFns
    for (const cleaner of cleanerFns) {
      // WinSxS was already handled above in apply mode; in scan-only mode it is
      // counted below through its own scan function.
      if (autoApply && cleaner.type === CleanerType.WinSxS) continue
      if (cleaner.type === CleanerType.RecycleBin && protectRecycleBin) continue

      try {
        const scans = await cleaner.scan()
        const found = scans.reduce((sum, scan) => sum + scan.itemCount, 0)
        const size = scans.reduce((sum, scan) => sum + scan.totalSize, 0)
        result.totalFound += found

        if (!autoApply) continue
        const ids = scans.flatMap((scan) => scan.items.map((item) => item.id))
        if (ids.length === 0) continue
        const cleaned = await cleaner.clean(ids)
        result.totalCleaned += cleaned.filesDeleted ?? found
        result.spaceRecovered += cleaned.totalCleaned ?? size
      } catch {
        markPartial()
      }
    }
  } catch {
    markPartial()
  }

  // ── 3. Registry ──
  try {
    const entries = await window.dinho.registryScan()
    result.totalFound += entries.length
    if (autoApply && entries.length > 0) {
      const fixed = await window.dinho.registryFix(entries.map((entry) => entry.id))
      result.totalCleaned += fixed.fixed
    }
  } catch {
    markPartial()
  }

  // ── 4. Malware scan + quarantine ──
  try {
    const scan = await window.dinho.malwareScan()
    result.threatsFound = scan.threats.length
    result.totalFound += result.threatsFound
    if (autoApply && scan.threats.length > 0) {
      const paths = scan.threats.map((threat) => threat.path)
      const meta = scan.threats.map((threat) => ({
        path: threat.path,
        detectionName: threat.detectionName,
        severity: threat.severity,
        source: threat.source,
        details: threat.details,
      }))
      const action = await window.dinho.malwareQuarantine(paths, meta)
      result.threatsQuarantined = action.succeeded
      result.totalCleaned += result.threatsQuarantined
    }
  } catch {
    markPartial()
  }

  // ── 5. Privacy check (read-only) ──
  try {
    const state = await window.dinho.privacyScan()
    result.privacyScore = state.score
    result.privacyIssues = state.total - state.protected
  } catch {
    markPartial()
  }

  // ── 6. High-impact startup apps (read-only) ──
  try {
    const items = await window.dinho.startupList()
    result.startupHighImpact = items.filter((item) => item.enabled && item.impact === 'high').length
  } catch {
    markPartial()
  }

  // ── 7. Application updates ──
  try {
    const check = await window.dinho.softwareUpdateCheck()
    if (!check.failure) {
      const apps = check.apps.filter((app) => app.selected !== false)
      result.appsFound = apps.length
      result.totalFound += apps.length
      if (autoApply && apps.length > 0) {
        const run = await window.dinho.softwareUpdateRun(
          apps.map((app) => app.id),
          check.packageManagerName ?? undefined,
        )
        result.appsUpdated = run.succeeded ?? 0
        result.appsFailed = run.failed ?? 0
        result.totalCleaned += result.appsUpdated
      }
    }
  } catch {
    markPartial()
  }

  // ── 8. Driver updates ──
  try {
    const scan = await window.dinho.driverUpdateScan()
    const updates = scan.updates.filter((update) => update.selected !== false)
    result.driversFound = updates.length
    result.totalFound += updates.length
    if (autoApply && updates.length > 0) {
      const install = await window.dinho.driverUpdateInstall(updates.map((update) => update.updateId))
      result.driversUpdated = install.installed ?? 0
      result.driversFailed = install.failed ?? 0
      result.rebootRequired = result.rebootRequired || Boolean(install.rebootRequired)
      result.totalCleaned += result.driversUpdated
    }
  } catch {
    markPartial()
  }

  // ── 9. Stale driver removal ──
  try {
    const scan = await window.dinho.driverScan()
    const stale = scan.packages.filter((pkg) => !pkg.isCurrent && pkg.selected)
    result.totalFound += stale.length
    if (autoApply && stale.length > 0) {
      const cleaned = await window.dinho.driverClean(stale.map((pkg) => pkg.publishedName))
      result.staleDriversRemoved = cleaned.removed
      result.staleDriversSpace = cleaned.spaceRecovered
      result.totalCleaned += cleaned.removed
      result.spaceRecovered += cleaned.spaceRecovered
    }
  } catch {
    markPartial()
  }

  // ── 10. Vulnerability scan (read-only) ──
  try {
    const scan = await window.dinho.vulnerabilityScan()
    result.vulnerabilitiesFound = scan.vulnerable
    result.totalFound += result.vulnerabilitiesFound
  } catch {
    markPartial()
  }

  // ── 11. Performance: TRIM, power plan, network, memory ──
  if (autoApply) {
    try {
      const drives = await window.dinho.diskTrimList()
      const ids = drives
        .filter(
          (drive) =>
            !drive.isRemovable &&
            drive.trimSupport === 'supported' &&
            (drive.mediaType === 'SSD' || drive.mediaType === 'NVMe'),
        )
        .map((drive) => drive.id)
      if (ids.length > 0) {
        const trimmed = await window.dinho.diskTrimRun(ids)
        result.trimDrives = trimmed.filter((entry) => entry.success).length
      }
    } catch {
      markPartial()
    }

    try {
      const plans = await window.dinho.powerPlansList()
      const target = plans.find((plan) => plan.isUltimatePerformance) ?? plans.find((plan) => plan.isHighPerformance)
      if (target) {
        if (target.isActive) {
          result.powerPlanActivated = target.name
        } else {
          const activated = await window.dinho.powerPlansActivate(target.guid)
          if (activated.success) {
            result.powerPlanActivated = target.name
          }
        }
      }
    } catch {
      markPartial()
    }

    try {
      const items = await window.dinho.networkScan()
      const ids = items.filter((item) => item.selected).map((item) => item.id)
      if (ids.length > 0) {
        const cleaned = await window.dinho.networkClean(ids)
        result.networkCleaned = cleaned.cleaned
      }
    } catch {
      markPartial()
    }

    try {
      const memory = await window.dinho.memoryOptimize()
      if (memory.success) result.memoryFreed = memory.freedBytes
    } catch {
      markPartial()
    }
  }

  return result
}
