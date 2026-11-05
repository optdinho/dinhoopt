import { CleanerType } from '@shared/enums'
import type { PerfQuickStats } from '@shared/types'
import { Cpu, Database, Download, MemoryStick, Search, Server, Zap } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ActionButtons } from '@/components/dashboard/ActionButtons'
import { AutoMaintenancePhaseList } from '@/components/dashboard/AutoMaintenancePhaseList'
import {
  type AutoMaintenanceOptions,
  type AutoMaintenancePhase,
  countAutoMaintenanceSteps,
  DEFAULT_AUTO_MAINTENANCE_OPTIONS,
} from '@/components/dashboard/auto-maintenance'
import { GameClipsCard } from '@/components/dashboard/GameClipsCard'
import { GameModeCard } from '@/components/dashboard/GameModeCard'
import { HealthCard } from '@/components/dashboard/HealthCard'
import { MiniGauge } from '@/components/dashboard/MiniGauge'
import { ProgressBanner } from '@/components/dashboard/ProgressBanner'
import { ResultBanner } from '@/components/dashboard/ResultBanner'
import type { OneClickPhase, OneClickResult } from '@/components/dashboard/types'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import { usePlatform } from '@/hooks/usePlatform'
import { formatBytes } from '@/lib/utils'
import { useGameModeStore } from '@/stores/game-mode-store'
import { useHistoryStore } from '@/stores/history-store'
import { usePerfStore } from '@/stores/perf-store'
import { useScanStore } from '@/stores/scan-store'
import { useServiceStore } from '@/stores/service-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useStartupStore } from '@/stores/startup-store'
import { useStatsStore } from '@/stores/stats-store'
import { useUpdaterStore } from '@/stores/updater-store'

import { CLEANER_SCAN_FNS, MiniGaugeSkeleton } from './dashboard/DashboardComponents'

export function DashboardPage() {
  const { t } = useTranslation('dashboard')
  const { features } = usePlatform()
  const stats = useStatsStore((s) => s.stats)
  const statsLoaded = useStatsStore((s) => s.loaded)
  const recomputeStats = useStatsStore((s) => s.recompute)
  const entries = useHistoryStore((s) => s.entries)
  const addEntry = useHistoryStore((s) => s.addEntry)
  const excludedSubcategories = useScanStore((s) => s.excludedSubcategories)
  const updaterHasChecked = useUpdaterStore((s) => s.hasChecked)
  const serviceHasScanned = useServiceStore((s) => s.hasScanned)
  const startupCount = useStartupStore((s) => s.items.length)
  const gameModeActive = useGameModeStore((s) => s.active)

  const cleanStartRef = useRef<number>(0)
  const [phase, setPhase] = useState<OneClickPhase>('idle')
  const [phaseLabel, setPhaseLabel] = useState('')
  const [result, setResult] = useState<OneClickResult | null>(null)
  const [showQuickConfirm, setShowQuickConfirm] = useState(false)
  const [showFullConfirm, setShowFullConfirm] = useState(false)
  const [showAutoMaintenanceConfirm, setShowAutoMaintenanceConfirm] = useState(false)
  const [autoMaintenanceOptions, setAutoMaintenanceOptions] = useState<AutoMaintenanceOptions>(
    DEFAULT_AUTO_MAINTENANCE_OPTIONS,
  )
  const [stepProgress, setStepProgress] = useState({ current: 0, total: 0 })

  const setDiskHealth = usePerfStore((s) => s.setDiskHealth)

  // ── Lightweight system metrics (no heavy process polling) ──
  const [perf, setPerf] = useState<PerfQuickStats | null>(null)

  useEffect(() => {
    let cancelled = false
    const api = window.dinho
    api?.perfQuickStats?.().catch(() => {})
    const poll = async () => {
      try {
        const data = await api?.perfQuickStats?.()
        if (!cancelled && data) setPerf(data)
      } catch {
        // silently ignore polling errors
      }
    }
    const iv = setInterval(poll, 5000)
    const initial = setTimeout(poll, 500)
    return () => {
      cancelled = true
      clearInterval(iv)
      clearTimeout(initial)
    }
  }, [])

  // Fetch disk health once on mount (stored in perf-store for HealthCard to read)
  useEffect(() => {
    window.dinho
      ?.perfGetDiskHealth?.()
      .then(setDiskHealth)
      .catch(() => {})
  }, [setDiskHealth])

  // ── Health score (memoized) ────────────────────────────────

  const toolCoverage = useMemo(() => {
    const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 1000
    const recentEntries = entries.filter((e) => new Date(e.timestamp).getTime() > twoWeeksAgo)
    const recentTypes = new Set(recentEntries.map((e) => e.type))
    const allTypes = new Set(entries.map((e) => e.type))

    const historyTools = [
      { key: 'cleaner' as const, label: t('toolLabelCleaner'), icon: Search, color: '#f59e0b' },
      ...(features.registry
        ? [{ key: 'registry' as const, label: t('toolLabelRegistry'), icon: Database, color: '#3b82f6' }]
        : []),
      ...(features.drivers
        ? [{ key: 'drivers' as const, label: t('toolLabelDrivers'), icon: Cpu, color: '#a855f7' }]
        : []),
    ]

    const historyResults = historyTools.map((x) => ({
      ...x,
      usedRecently: recentTypes.has(x.key),
      usedEver: allTypes.has(x.key),
    }))

    const sessionTools = [
      { key: 'updater', label: t('toolLabelUpdater'), icon: Download, color: '#06b6d4', active: updaterHasChecked },
      { key: 'services', label: t('toolLabelServices'), icon: Server, color: '#ec4899', active: serviceHasScanned },
      { key: 'startup', label: t('toolLabelStartup'), icon: Zap, color: '#22c55e', active: startupCount > 0 },
    ]

    const sessionResults = sessionTools.map((x) => ({
      key: x.key,
      label: x.label,
      icon: x.icon,
      color: x.color,
      usedRecently: x.active,
      usedEver: x.active,
    }))

    return [...historyResults, ...sessionResults]
  }, [entries, features, t, updaterHasChecked, serviceHasScanned, startupCount])

  const healthScore = useMemo(() => {
    const totalTools = toolCoverage.length
    const doneTools = toolCoverage.filter((x) => x.usedRecently).length
    let score = Math.round((doneTools / totalTools) * 60)

    if (stats.lastScanDate) {
      const daysSinceScan = (Date.now() - new Date(stats.lastScanDate).getTime()) / (1000 * 60 * 60 * 24)
      score -= Math.min(20, Math.round(daysSinceScan * (20 / 7)))
    } else {
      score -= 10
    }

    if (stats.lastScanDate) score += 40
    return Math.max(0, Math.min(100, score))
  }, [toolCoverage, stats.lastScanDate])

  // ── One-click clean callbacks (unchanged logic) ────────────

  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)

  const runCleaners = useCallback(
    async (skipTypes: readonly CleanerType[] = []): Promise<{ space: number; files: number }> => {
      let totalSpace = 0
      let totalFiles = 0

      for (const { type, scan, clean } of CLEANER_SCAN_FNS) {
        if (skipTypes.includes(type)) continue
        if (type === CleanerType.RecycleBin && protectRecycleBin) continue
        try {
          setPhaseLabel(t('phaseLabelScanningType', { type }))
          const results = await scan()
          const selectedIds = results
            .filter((r) => !excludedSubcategories.has(`${r.category}:${r.subcategory}`))
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
    },
    [excludedSubcategories, protectRecycleBin, t],
  )

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
  }, [t])

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
  }, [t])

  const runPrivacyCheck = useCallback(async (): Promise<{ score: number; issues: number }> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingPrivacy'))
      const state = await window.dinho.privacyScan()
      return { score: state.score, issues: state.total - state.protected }
    } catch {
      toast.error(t('toastPrivacyCheckFailed'))
      return { score: 0, issues: 0 }
    }
  }, [t])

  const runStartupCheck = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingStartup'))
      const items = await window.dinho.startupList()
      return items.filter((i) => i.enabled && i.impact === 'high').length
    } catch {
      toast.error(t('toastStartupCheckFailed'))
      return 0
    }
  }, [t])

  const runSoftwareUpdateCheck = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingSoftwareUpdates'))
      const result = await window.dinho.softwareUpdateCheck()
      return result.apps.length
    } catch {
      toast.error(t('toastSoftwareUpdateCheckFailed'))
      return 0
    }
  }, [t])

  const runNetworkCleanup = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelCleaningNetwork'))
      const items = await window.dinho.networkScan()
      if (items.length === 0) return 0
      const ids = items.filter((i) => i.selected).map((i) => i.id)
      if (ids.length === 0) return 0
      const res = await window.dinho.networkClean(ids)
      return res.cleaned
    } catch {
      toast.error(t('toastNetworkCleanupFailed'))
      return 0
    }
  }, [t])

  const runVulnerabilityScan = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelScanningVulnerabilities'))
      const result = await window.dinho.vulnerabilityScan()
      return result.vulnerable
    } catch {
      toast.error(t('toastVulnScanFailed'))
      return 0
    }
  }, [t])

  const runMemoryOptimize = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelOptimizingMemory'))
      const res = await window.dinho.memoryOptimize()
      return res.success ? res.freedBytes : 0
    } catch {
      toast.error(t('toastMemoryOptimizeFailed'))
      return 0
    }
  }, [t])

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
  }, [t])

  // ── Full system maintenance building blocks ────────────────

  /**
   * DISM restores the component store; SFC only runs when DISM reports repairs
   * or fails, matching the documented order (DISM first, then SFC).
   */
  const runWindowsRepair = useCallback(async (): Promise<{ status: string; reboot: boolean }> => {
    try {
      setPhaseLabel(t('phaseLabelDismCheck'))
      const dism = await window.dinho.diskRepairDism()
      let reboot = dism.requiresReboot
      let repaired = dism.summaryCode === 'dismRepaired'
      let healthy = dism.success && !repaired

      if (dism.needsAdmin) {
        toast.error(t('toastWindowsRepairFailed'))
        return { status: '', reboot }
      }

      if (!dism.success || repaired) {
        setPhaseLabel(t('phaseLabelSfcRepair'))
        const sfc = await window.dinho.diskRepairSfc('C')
        reboot = reboot || sfc.requiresReboot
        repaired = repaired || sfc.summaryCode === 'sfcRepaired'
        healthy = healthy || (sfc.success && !repaired)
      }

      if (repaired) return { status: t('resultSystemRepaired'), reboot }
      if (healthy) return { status: t('resultSystemHealthy'), reboot }
      return { status: '', reboot }
    } catch {
      toast.error(t('toastWindowsRepairFailed'))
      return { status: '', reboot: false }
    }
  }, [t])

  const runWinSxSCleanup = useCallback(async (): Promise<{ space: number; files: number }> => {
    try {
      setPhaseLabel(t('phaseLabelWinsxsClean'))
      const res = await window.dinho.winSxSClean()
      return { space: res?.totalCleaned ?? 0, files: res?.filesDeleted ?? 0 }
    } catch {
      toast.error(t('toastWinsxsCleanFailed'))
      return { space: 0, files: 0 }
    }
  }, [t])

  const runSoftwareUpdates = useCallback(async (): Promise<{ updated: number; failed: number }> => {
    try {
      setPhaseLabel(t('phaseLabelCheckingSoftwareUpdates'))
      const check = await window.dinho.softwareUpdateCheck()
      if (check.failure || check.apps.length === 0) return { updated: 0, failed: 0 }
      const ids = check.apps.filter((a) => a.selected).map((a) => a.id)
      if (ids.length === 0) return { updated: 0, failed: 0 }
      setPhaseLabel(t('phaseLabelUpdatingSoftware', { count: ids.length }))
      const res = await window.dinho.softwareUpdateRun(ids)
      return { updated: res.succeeded ?? 0, failed: res.failed ?? 0 }
    } catch {
      toast.error(t('toastSoftwareUpdateCheckFailed'))
      return { updated: 0, failed: 0 }
    }
  }, [t])

  const runDriverUpdates = useCallback(async (): Promise<{ updated: number; failed: number; reboot: boolean }> => {
    try {
      setPhaseLabel(t('phaseLabelScanningDrivers'))
      const scan = await window.dinho.driverUpdateScan()
      const updates = scan.updates.filter((u) => u.selected)
      if (updates.length === 0) return { updated: 0, failed: 0, reboot: false }
      setPhaseLabel(t('phaseLabelInstallingDrivers', { count: updates.length }))
      const res = await window.dinho.driverUpdateInstall(updates.map((u) => u.updateId))
      return {
        updated: res.installed ?? 0,
        failed: res.failed ?? 0,
        reboot: Boolean(res.rebootRequired),
      }
    } catch {
      toast.error(t('toastDriverUpdateFailed'))
      return { updated: 0, failed: 0, reboot: false }
    }
  }, [t])

  const runTrim = useCallback(async (): Promise<number> => {
    try {
      setPhaseLabel(t('phaseLabelRunningTrim'))
      const drives = await window.dinho.diskTrimList()
      const ids = drives
        .filter(
          (d) => !d.isRemovable && d.trimSupport === 'supported' && (d.mediaType === 'SSD' || d.mediaType === 'NVMe'),
        )
        .map((d) => d.id)
      if (ids.length === 0) return 0
      const results = await window.dinho.diskTrimRun(ids)
      return results.filter((r) => r.success).length
    } catch {
      toast.error(t('toastTrimFailed'))
      return 0
    }
  }, [t])

  const runHighPerformancePlan = useCallback(async (): Promise<string> => {
    try {
      setPhaseLabel(t('phaseLabelActivatingPowerPlan'))
      const plans = await window.dinho.powerPlansList()
      const target = plans.find((p) => p.isUltimatePerformance) ?? plans.find((p) => p.isHighPerformance)
      if (!target) return ''
      if (target.isActive) return target.name
      const res = await window.dinho.powerPlansActivate(target.guid)
      return res.success ? target.name : ''
    } catch {
      toast.error(t('toastPowerPlanFailed'))
      return ''
    }
  }, [t])

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
      networkCleaned: 0,
      vulnerabilitiesFound: 0,
      memoryFreed: 0,
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
          ...(files > 0
            ? [{ name: t('historyQuickClean'), itemsFound: files, itemsCleaned: files, spaceSaved: space }]
            : []),
          ...(regFixed > 0
            ? [{ name: t('historyRegistry'), itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }]
            : []),
        ],
        errorCount: 0,
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
  }, [phase, runCleaners, runRegistry, addEntry, recomputeStats, features, t])

  const handleFullClean = useCallback(async () => {
    if (phase !== 'idle' && phase !== 'done') return
    cleanStartRef.current = Date.now()
    setPhase('scanning')
    setResult(null)
    const totalSteps = 8 + (features.registry ? 1 : 0) + (features.drivers ? 1 : 0)
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
    setStepProgress({ current: ++step, total: totalSteps })
    const networkCleaned = await runNetworkCleanup()
    setStepProgress({ current: ++step, total: totalSteps })
    const vulnerabilitiesFound = await runVulnerabilityScan()
    setStepProgress({ current: ++step, total: totalSteps })
    const memoryFreed = await runMemoryOptimize()

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
      networkCleaned,
      vulnerabilitiesFound,
      memoryFreed,
    }

    const totalItems = files + regFixed + drivers.removed + malware.quarantined + networkCleaned
    if (totalItems > 0 || malware.found > 0 || vulnerabilitiesFound > 0) {
      await addEntry({
        id: Date.now().toString(),
        type: 'cleaner',
        timestamp: new Date().toISOString(),
        duration: Date.now() - cleanStartRef.current,
        totalItemsFound: totalItems + malware.found + vulnerabilitiesFound,
        totalItemsCleaned: totalItems,
        totalItemsSkipped: 0,
        totalSpaceSaved: space + drivers.space,
        categories: [
          ...(files > 0
            ? [{ name: t('historyFullClean'), itemsFound: files, itemsCleaned: files, spaceSaved: space }]
            : []),
          ...(regFixed > 0
            ? [{ name: t('historyRegistry'), itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }]
            : []),
          ...(drivers.removed > 0
            ? [
                {
                  name: t('historyStaleDrivers'),
                  itemsFound: drivers.removed,
                  itemsCleaned: drivers.removed,
                  spaceSaved: drivers.space,
                },
              ]
            : []),
          ...(malware.quarantined > 0
            ? [
                {
                  name: t('historyMalware'),
                  itemsFound: malware.found,
                  itemsCleaned: malware.quarantined,
                  spaceSaved: 0,
                },
              ]
            : []),
          ...(networkCleaned > 0
            ? [{ name: t('historyNetwork'), itemsFound: networkCleaned, itemsCleaned: networkCleaned, spaceSaved: 0 }]
            : []),
        ],
        errorCount: 0,
      })
      recomputeStats()
    }

    setResult(oneClickResult)
    setPhase('done')
    setPhaseLabel('')
  }, [
    phase,
    runCleaners,
    runRegistry,
    runDrivers,
    runMalwareScan,
    runPrivacyCheck,
    runStartupCheck,
    runSoftwareUpdateCheck,
    runNetworkCleanup,
    runVulnerabilityScan,
    runMemoryOptimize,
    addEntry,
    recomputeStats,
    features,
    t,
  ])

  const handleAutoMaintenance = useCallback(
    async (options: AutoMaintenanceOptions) => {
      if (phase !== 'idle' && phase !== 'done') return
      const totalSteps = countAutoMaintenanceSteps(options, features.registry, features.drivers)
      if (totalSteps === 0) return
      cleanStartRef.current = Date.now()
      setPhase('scanning')
      setResult(null)
      let step = 0
      setStepProgress({ current: step, total: totalSteps })
      // Yield to let React render the scanning phase before the pipeline starts
      await new Promise<void>((r) => setTimeout(r, 50))

      setPhase('cleaning')

      let repair = { status: '', reboot: false }
      if (options.systemRepair) {
        setStepProgress({ current: ++step, total: totalSteps })
        repair = await runWindowsRepair()
      }

      let winsxs = { space: 0, files: 0 }
      let deepClean = { space: 0, files: 0 }
      if (options.deepClean) {
        setStepProgress({ current: ++step, total: totalSteps })
        winsxs = await runWinSxSCleanup()
        setStepProgress({ current: ++step, total: totalSteps })
        // WinSxS was just cleaned above; skip it here so it is not analysed and
        // cleaned a second time by the generic cleaner loop.
        deepClean = await runCleaners([CleanerType.WinSxS])
      }

      let regFixed = 0
      if (options.registry && features.registry) {
        setStepProgress({ current: ++step, total: totalSteps })
        regFixed = await runRegistry()
      }

      let malware = { found: 0, quarantined: 0 }
      if (options.malware) {
        setStepProgress({ current: ++step, total: totalSteps })
        malware = await runMalwareScan()
      }

      let privacy = { score: 0, issues: 0 }
      if (options.privacy) {
        setStepProgress({ current: ++step, total: totalSteps })
        privacy = await runPrivacyCheck()
      }

      let startupHighImpact = 0
      if (options.startup) {
        setStepProgress({ current: ++step, total: totalSteps })
        startupHighImpact = await runStartupCheck()
      }

      let software = { updated: 0, failed: 0 }
      if (options.softwareUpdates) {
        setStepProgress({ current: ++step, total: totalSteps })
        software = await runSoftwareUpdates()
      }

      let driverUpdates = { updated: 0, failed: 0, reboot: false }
      if (options.driverUpdates && features.drivers) {
        setStepProgress({ current: ++step, total: totalSteps })
        driverUpdates = await runDriverUpdates()
      }

      let staleDrivers = { removed: 0, space: 0 }
      if (options.staleDrivers && features.drivers) {
        setStepProgress({ current: ++step, total: totalSteps })
        staleDrivers = await runDrivers()
      }

      let vulnerabilitiesFound = 0
      if (options.vulnerabilities) {
        setStepProgress({ current: ++step, total: totalSteps })
        vulnerabilitiesFound = await runVulnerabilityScan()
      }

      let trimDrives = 0
      let powerPlanActivated = ''
      let networkCleaned = 0
      let memoryFreed = 0
      if (options.performance) {
        setStepProgress({ current: ++step, total: totalSteps })
        trimDrives = await runTrim()
        setStepProgress({ current: ++step, total: totalSteps })
        powerPlanActivated = await runHighPerformancePlan()
        setStepProgress({ current: ++step, total: totalSteps })
        networkCleaned = await runNetworkCleanup()
        setStepProgress({ current: ++step, total: totalSteps })
        memoryFreed = await runMemoryOptimize()
      }

      const spaceRecovered = deepClean.space + winsxs.space + staleDrivers.space
      const filesCleaned = deepClean.files + winsxs.files

      const oneClickResult: OneClickResult = {
        spaceRecovered,
        filesCleaned,
        registryFixed: regFixed,
        driversRemoved: staleDrivers.removed,
        threatsFound: malware.found,
        threatsQuarantined: malware.quarantined,
        privacyScore: privacy.score,
        privacyIssues: privacy.issues,
        startupHighImpact,
        // Failed updates are still available, so surface them as such.
        updatesAvailable: software.failed,
        networkCleaned,
        vulnerabilitiesFound,
        memoryFreed,
        ...(repair.status ? { systemRepairStatus: repair.status } : {}),
        appsUpdated: software.updated,
        driversUpdated: driverUpdates.updated,
        trimDrives,
        ...(powerPlanActivated ? { powerPlanActivated } : {}),
        rebootRequired: repair.reboot || driverUpdates.reboot,
      }

      const totalItems =
        filesCleaned +
        regFixed +
        networkCleaned +
        software.updated +
        driverUpdates.updated +
        staleDrivers.removed +
        malware.quarantined
      const totalFound = totalItems + malware.found + vulnerabilitiesFound
      if (totalFound > 0 || spaceRecovered > 0) {
        await addEntry({
          id: Date.now().toString(),
          type: 'cleaner',
          timestamp: new Date().toISOString(),
          duration: Date.now() - cleanStartRef.current,
          totalItemsFound: totalFound,
          totalItemsCleaned: totalItems,
          totalItemsSkipped: software.failed + driverUpdates.failed,
          totalSpaceSaved: spaceRecovered,
          categories: [
            ...(filesCleaned > 0
              ? [
                  {
                    name: t('historyAutoMaintenance'),
                    itemsFound: filesCleaned,
                    itemsCleaned: filesCleaned,
                    spaceSaved: spaceRecovered,
                  },
                ]
              : []),
            ...(regFixed > 0
              ? [{ name: t('historyRegistry'), itemsFound: regFixed, itemsCleaned: regFixed, spaceSaved: 0 }]
              : []),
            ...(malware.quarantined > 0
              ? [
                  {
                    name: t('historyMalware'),
                    itemsFound: malware.found,
                    itemsCleaned: malware.quarantined,
                    spaceSaved: 0,
                  },
                ]
              : []),
            ...(staleDrivers.removed > 0
              ? [
                  {
                    name: t('historyStaleDrivers'),
                    itemsFound: staleDrivers.removed,
                    itemsCleaned: staleDrivers.removed,
                    spaceSaved: staleDrivers.space,
                  },
                ]
              : []),
            ...(software.updated > 0
              ? [
                  {
                    name: t('historyAppsUpdated'),
                    itemsFound: software.updated,
                    itemsCleaned: software.updated,
                    spaceSaved: 0,
                  },
                ]
              : []),
            ...(driverUpdates.updated > 0
              ? [
                  {
                    name: t('historyDriversUpdated'),
                    itemsFound: driverUpdates.updated,
                    itemsCleaned: driverUpdates.updated,
                    spaceSaved: 0,
                  },
                ]
              : []),
          ],
          errorCount: software.failed + driverUpdates.failed,
        })
        recomputeStats()
      }

      setResult(oneClickResult)
      setPhase('done')
      setPhaseLabel('')
    },
    [
      phase,
      runWindowsRepair,
      runWinSxSCleanup,
      runCleaners,
      runRegistry,
      runMalwareScan,
      runPrivacyCheck,
      runStartupCheck,
      runSoftwareUpdates,
      runDriverUpdates,
      runDrivers,
      runVulnerabilityScan,
      runTrim,
      runHighPerformancePlan,
      runNetworkCleanup,
      runMemoryOptimize,
      addEntry,
      recomputeStats,
      features,
      t,
    ],
  )

  const toggleAutoMaintenancePhase = useCallback((target: AutoMaintenancePhase) => {
    setAutoMaintenanceOptions((prev) => ({ ...prev, [target]: !prev[target] }))
  }, [])

  const isRunning = phase === 'scanning' || phase === 'cleaning'

  // ── Helpers ────────────────────────────────────────────────

  const cpuPct = perf?.cpuPercent ?? 0
  const ramPct = perf?.memPercent ?? 0

  const loading = !statsLoaded

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="animate-fade-in flex h-full flex-col overflow-y-auto">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      <StaggerContainer className="flex-1 space-y-4 px-0 pb-8">
        {/* ── Row 1: MiniGauges (PC State) ──────────────────── */}
        <StaggerItem>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
            {loading ? (
              Array.from({ length: 2 }).map((_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: skeleton placeholder
                <MiniGaugeSkeleton key={i} />
              ))
            ) : (
              <>
                <MiniGauge
                  icon={Cpu}
                  label={t('gaugeCpu')}
                  percent={Math.round(cpuPct)}
                  detail={`${Math.round(cpuPct)}%`}
                />
                <MiniGauge
                  icon={MemoryStick}
                  label={t('gaugeRam')}
                  percent={Math.round(ramPct)}
                  detail={perf ? `${formatBytes(perf.memUsedBytes)} / ${formatBytes(perf.memTotalBytes)}` : '—'}
                />
              </>
            )}
          </div>
        </StaggerItem>

        {/* ── Row 2: Health + Game Mode + Clips ────────────── */}
        <StaggerItem>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <ErrorBoundary>
              <HealthCard
                healthScore={healthScore}
                toolCoverage={toolCoverage}
                memPercent={Math.round(ramPct)}
                totalSpaceSaved={stats.totalSpaceSaved}
                totalFilesCleaned={stats.totalFilesCleaned}
                totalScans={stats.totalScans}
              />
            </ErrorBoundary>
            {features.gameMode && (
              <ErrorBoundary>
                <GameModeCard gameModeActive={gameModeActive} />
              </ErrorBoundary>
            )}
            {features.clips && (
              <ErrorBoundary>
                <GameClipsCard />
              </ErrorBoundary>
            )}
          </div>
        </StaggerItem>

        {/* ── Row 3: Action Center ────────────────────────────── */}
        <StaggerItem>
          <ActionButtons
            onQuickClean={() => setShowQuickConfirm(true)}
            onFullClean={() => setShowFullConfirm(true)}
            onAutoMaintenance={() => setShowAutoMaintenanceConfirm(true)}
            isRunning={isRunning}
            hasRegistry={features.registry}
          />

          <div className="mt-4">
            <ProgressBanner isRunning={isRunning} phaseLabel={phaseLabel} stepProgress={stepProgress} />
          </div>
          {phase === 'done' && <ResultBanner result={result} />}
        </StaggerItem>
      </StaggerContainer>

      <ConfirmDialog
        open={showQuickConfirm}
        onConfirm={() => {
          setShowQuickConfirm(false)
          handleQuickClean()
        }}
        onCancel={() => setShowQuickConfirm(false)}
        title={t('quickCleanConfirmTitle')}
        description={
          features.registry
            ? t('quickCleanConfirmDescriptionWithRegistry')
            : t('quickCleanConfirmDescriptionWithoutRegistry')
        }
        confirmLabel={t('quickCleanConfirmLabel')}
        variant="warning"
      />

      <ConfirmDialog
        open={showFullConfirm}
        onConfirm={() => {
          setShowFullConfirm(false)
          handleFullClean()
        }}
        onCancel={() => setShowFullConfirm(false)}
        title={t('fullCleanConfirmTitle')}
        description={
          features.registry
            ? t('fullCleanConfirmDescriptionWithRegistry')
            : t('fullCleanConfirmDescriptionWithoutRegistry')
        }
        confirmLabel={t('fullCleanConfirmLabel')}
        variant="warning"
      />

      <ConfirmDialog
        open={showAutoMaintenanceConfirm}
        onConfirm={() => {
          if (countAutoMaintenanceSteps(autoMaintenanceOptions, features.registry, features.drivers) === 0) {
            toast.error(t('autoMaintenanceNoPhasesSelected'))
            return
          }
          setShowAutoMaintenanceConfirm(false)
          handleAutoMaintenance(autoMaintenanceOptions)
        }}
        onCancel={() => setShowAutoMaintenanceConfirm(false)}
        title={t('autoMaintenanceConfirmTitle')}
        description={t('autoMaintenanceConfirmDescription')}
        confirmLabel={t('autoMaintenanceConfirmLabel')}
        variant="warning"
      >
        <AutoMaintenancePhaseList
          options={autoMaintenanceOptions}
          onChange={toggleAutoMaintenancePhase}
          hasRegistry={features.registry}
          hasDrivers={features.drivers}
        />
      </ConfirmDialog>
    </div>
  )
}
