import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { OneClickResult } from '@/components/dashboard/types'
import { useHistoryStore } from '@/stores/history-store'
import { useScanStore } from '@/stores/scan-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useStatsStore } from '@/stores/stats-store'
import type { OneClickPhase } from '../components/dashboard/types'

const CLEANER_SCAN_FNS: {
  type: CleanerType
  scan: () => Promise<ScanResult[]>
  clean: (ids: string[]) => Promise<CleanResult>
}[] = [
  { type: CleanerType.System, scan: () => window.dinho.systemScan(), clean: (ids) => window.dinho.systemClean(ids) },
  { type: CleanerType.WinSxS, scan: () => window.dinho.winSxSScan(), clean: () => window.dinho.winSxSClean() },
  { type: CleanerType.Browser, scan: () => window.dinho.browserScan(), clean: (ids) => window.dinho.browserClean(ids) },
  { type: CleanerType.App, scan: () => window.dinho.appScan(), clean: (ids) => window.dinho.appClean(ids) },
  { type: CleanerType.Gaming, scan: () => window.dinho.gamingScan(), clean: (ids) => window.dinho.gamingClean(ids) },
  {
    type: CleanerType.RecycleBin,
    scan: () => window.dinho.recycleBinScan(),
    clean: () => window.dinho.recycleBinClean(),
  },
  {
    type: CleanerType.Shortcut,
    scan: () => window.dinho.shortcutScan(),
    clean: (ids) => window.dinho.shortcutClean(ids),
  },
  {
    type: CleanerType.Environment,
    scan: () => window.dinho.environmentScan(),
    clean: (ids) => window.dinho.environmentClean(ids),
  },
  {
    type: CleanerType.Database,
    scan: () => window.dinho.databaseScan(),
    clean: (ids) => window.dinho.databaseClean(ids),
  },
  {
    type: CleanerType.UninstallLeftovers,
    scan: () => window.dinho.uninstallLeftoversScan(),
    clean: (ids) => window.dinho.uninstallLeftoversClean(ids),
  },
]

interface OneClickCleanDeps {
  phase: OneClickPhase
  setPhase: (p: OneClickPhase) => void
  setPhaseLabel: (label: string) => void
  setResult: (r: OneClickResult | null) => void
  setStepProgress: (p: { current: number; total: number }) => void
  refreshDrives: () => void
  features: { registry: boolean; drivers: boolean }
}

export function useOneClickClean(deps: OneClickCleanDeps) {
  const { t } = useTranslation('dashboard')
  const excludedSubcategories = useScanStore((s) => s.excludedSubcategories)
  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)
  const addEntry = useHistoryStore((s) => s.addEntry)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const cleanStartRef = useRef<number>(0)

  const { phase, setPhase, setPhaseLabel, setResult, setStepProgress, refreshDrives, features } = deps

  const runCleaners = useCallback(async (): Promise<{ space: number; files: number }> => {
    let totalSpace = 0
    let totalFiles = 0

    for (const { type, scan, clean } of CLEANER_SCAN_FNS) {
      if (type === CleanerType.RecycleBin && protectRecycleBin) continue
      try {
        setPhaseLabel(t('phaseLabelScanningType', { type }))
        const results = await scan()
        const selectedIds = results
          .filter((r) => !excludedSubcategories.has(r.subcategory))
          .flatMap((r) => r.items.map((i) => i.id))
        if (selectedIds.length > 0) {
          setPhaseLabel(t('phaseLabelCleaningType', { type }))
          const res = await clean(selectedIds)
          totalSpace += res.totalCleaned || 0
          totalFiles += res.filesDeleted || 0
        }
      } catch {
        toast.error(t('toastFailedToCleanType', { type }))
      }
    }
    return { space: totalSpace, files: totalFiles }
  }, [excludedSubcategories, protectRecycleBin, t, setPhaseLabel])

  const runRegistry = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelScanningRegistry'))
      const result = await window.dinho.registryScan()
      if (!Array.isArray(result)) return 0
      const selectedIds = result.filter((e) => e?.selected).map((e) => e.id)
      if (selectedIds.length === 0) return 0
      setPhaseLabel(t('phaseLabelFixingRegistry'))
      const res = await window.dinho.registryFix(selectedIds)
      return res?.fixed ?? 0
    } catch {
      toast.error(t('toastRegistryScanFailed'))
      return 0
    }
  }, [t, setPhaseLabel])

  const runMalwareScan = useCallback(async (): Promise<{ found: number; quarantined: number }> => {
    try {
      setPhaseLabel(t('phaseLabelScanningMalware'))
      const result = await window.dinho.malwareScan()
      if (result.threats.length === 0) return { found: 0, quarantined: 0 }
      setPhaseLabel(t('phaseLabelQuarantiningThreats'))
      const paths = result.threats.map((x) => x.path)
      const meta = result.threats.map((x) => ({
        path: x.path,
        detectionName: x.detectionName,
        severity: x.severity,
        source: x.source,
        details: x.details,
      }))
      const actionResult = await window.dinho.malwareQuarantine(paths, meta)
      return { found: result.threats.length, quarantined: actionResult.succeeded }
    } catch {
      toast.error(t('toastMalwareScanFailed'))
      return { found: 0, quarantined: 0 }
    }
  }, [t, setPhaseLabel])

  const runPrivacyCheck = useCallback(async (): Promise<{ score: number; issues: number }> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingPrivacy'))
      const state = await window.dinho.privacyScan()
      return { score: state.score, issues: state.total - state.protected }
    } catch {
      toast.error(t('toastPrivacyCheckFailed'))
      return { score: 0, issues: 0 }
    }
  }, [t, setPhaseLabel])

  const runStartupCheck = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingStartup'))
      const items = await window.dinho.startupList()
      return items.filter((i) => i.enabled && i.impact === 'high').length
    } catch {
      toast.error(t('toastStartupCheckFailed'))
      return 0
    }
  }, [t, setPhaseLabel])

  const runSoftwareUpdateCheck = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingSoftwareUpdates'))
      const result = await window.dinho.softwareUpdateCheck()
      return result.apps.length
    } catch {
      toast.error(t('toastSoftwareUpdateCheckFailed'))
      return 0
    }
  }, [t, setPhaseLabel])

  const runDrivers = useCallback(async (): Promise<{ removed: number; space: number }> => {
    try {
      setPhaseLabel(t('phaseLabelScanningDrivers'))
      const scanResult = await window.dinho.driverScan()
      const stalePackages = scanResult.packages.filter((p) => !p.isCurrent && p.selected)
      if (stalePackages.length === 0) return { removed: 0, space: 0 }
      setPhaseLabel(t('phaseLabelRemovingStaleDrivers'))
      const cleanResult = await window.dinho.driverClean(stalePackages.map((p) => p.publishedName))
      return { removed: cleanResult.removed, space: cleanResult.spaceRecovered }
    } catch {
      toast.error(t('toastDriverCleanupFailed'))
      return { removed: 0, space: 0 }
    }
  }, [t, setPhaseLabel])

  const handleQuickClean = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return
    cleanStartRef.current = Date.now()
    setPhase('scanning')
    setResult(null)
    setStepProgress({ current: 0, total: 2 })
    // Yield to let React render the scanning phase before cleaning starts
    await new Promise<void>((r) => setTimeout(r, 50))

    setPhase('cleaning')
    setStepProgress({ current: 1, total: 2 })
    const { space, files } = await runCleaners()
    setStepProgress({ current: 2, total: 2 })
    const regFixed = features.registry ? await runRegistry() : 0

    const oneClickResult: OneClickResult = {
      spaceRecovered: space,
      filesCleaned: files,
      registryFixed: regFixed,
      driversRemoved: 0,
      threatsFound: 0,
      threatsQuarantined: 0,
      privacyScore: 0,
      privacyIssues: 0,
      startupHighImpact: 0,
      updatesAvailable: 0,
    }

    const totalItems = files + regFixed
    if (totalItems > 0) {
      await addEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: totalItems,
        totalItemsCleaned: totalItems,
        totalItemsSkipped: 0,
        totalSpaceSaved: space,
        categories: [
          ...(files > 0 ? [{ name: 'Quick Clean', itemsFound: files, itemsCleaned: files, spaceSaved: space }] : []),
          ...(regFixed > 0 ? [{ name: 'Registry', itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }] : []),
        ],
        errorCount: 0,
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
    refreshDrives()
  }, [
    phase,
    runCleaners,
    runRegistry,
    addEntry,
    recomputeStats,
    features,
    refreshDrives,
    setPhase,
    setResult,
    setStepProgress,
    setPhaseLabel,
  ])

  const handleFullClean = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return
    cleanStartRef.current = Date.now()
    setPhase('scanning')
    setResult(null)
    const totalSteps = 5 + (features.registry ? 1 : 0) + (features.drivers ? 1 : 0)
    let step = 0
    setStepProgress({ current: step, total: totalSteps })
    // Yield to let React render the scanning phase before cleaning starts
    await new Promise<void>((r) => setTimeout(r, 50))

    setPhase('cleaning')
    setStepProgress({ current: ++step, total: totalSteps })
    const { space, files } = await runCleaners()
    let regFixed = 0
    if (features.registry) {
      setStepProgress({ current: ++step, total: totalSteps })
      regFixed = await runRegistry()
    }
    let drivers = { removed: 0, space: 0 }
    if (features.drivers) {
      setStepProgress({ current: ++step, total: totalSteps })
      drivers = await runDrivers()
    }

    setStepProgress({ current: ++step, total: totalSteps })
    const malware = await runMalwareScan()
    setStepProgress({ current: ++step, total: totalSteps })
    const privacy = await runPrivacyCheck()
    setStepProgress({ current: ++step, total: totalSteps })
    const startupHighImpact = await runStartupCheck()
    setStepProgress({ current: ++step, total: totalSteps })
    const updatesAvailable = await runSoftwareUpdateCheck()

    const oneClickResult: OneClickResult = {
      spaceRecovered: space + drivers.space,
      filesCleaned: files,
      registryFixed: regFixed,
      driversRemoved: drivers.removed,
      threatsFound: malware.found,
      threatsQuarantined: malware.quarantined,
      privacyScore: privacy.score,
      privacyIssues: privacy.issues,
      startupHighImpact,
      updatesAvailable,
    }

    const totalItems = files + regFixed + drivers.removed + malware.quarantined
    if (totalItems > 0 || malware.found > 0) {
      await addEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: totalItems + malware.found,
        totalItemsCleaned: totalItems,
        totalItemsSkipped: 0,
        totalSpaceSaved: space + drivers.space,
        categories: [
          ...(files > 0 ? [{ name: 'Full Clean', itemsFound: files, itemsCleaned: files, spaceSaved: space }] : []),
          ...(regFixed > 0 ? [{ name: 'Registry', itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }] : []),
          ...(drivers.removed > 0
            ? [
                {
                  name: 'Stale Drivers',
                  itemsFound: drivers.removed,
                  itemsCleaned: drivers.removed,
                  spaceSaved: drivers.space,
                },
              ]
            : []),
          ...(malware.quarantined > 0
            ? [{ name: 'Malware', itemsFound: malware.found, itemsCleaned: malware.quarantined, spaceSaved: 0 }]
            : []),
        ],
        errorCount: 0,
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
    refreshDrives()
  }, [
    phase,
    runCleaners,
    runRegistry,
    runDrivers,
    runMalwareScan,
    runPrivacyCheck,
    runStartupCheck,
    runSoftwareUpdateCheck,
    addEntry,
    recomputeStats,
    features,
    refreshDrives,
    setPhase,
    setResult,
    setStepProgress,
    setPhaseLabel,
  ])

  return { handleQuickClean, handleFullClean }
}
