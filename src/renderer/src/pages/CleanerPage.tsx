import { CleanerType, ScanStatus } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { FileText, Layers, Loader2, Search, ShieldAlert, Sparkles, TriangleAlert, Wifi } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CleanSummary } from '@/components/cleaner/CleanSummary'
import { NetworkCleanupModal } from '@/components/cleaner/NetworkCleanupModal'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { loadReport, ReportCard, type ReportData, saveReport } from '@/components/shared/ReportCard'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { usePlatform } from '@/hooks/usePlatform'
import logger from '@/lib/renderer-logger'
import { formatBytes, formatNumber } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useScanStore } from '@/stores/scan-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useStatsStore } from '@/stores/stats-store'
import { CategoryResultsPanel } from './cleaner/CategoryResultsPanel'
import { CLEANER_GROUPS, categories, isDeepCleanCategory } from './cleaner/CleanerPageConstants'

type CleanMode = 'quick' | 'full'

export function CleanerPage() {
  const { t } = useTranslation('cleaner')
  const { platform } = usePlatform()
  const store = useScanStore()
  const recomputeStats = useStatsStore((s) => s.recompute)
  const addEntry = useHistoryStore((s) => s.addEntry)

  const protectRecycleBin = useSettingsStore((s) => s.settings.cleaner.protectRecycleBin)
  const visibleCategories = useMemo(
    () => (protectRecycleBin ? categories.filter((c) => c.type !== CleanerType.RecycleBin) : categories),
    [protectRecycleBin],
  )
  // The normal scan and the quick clean skip the deep categories (WinSxS); it
  // is analysed and cleaned only by the full clean flow.
  const scanCategories = useMemo(
    () => visibleCategories.filter((c) => !isDeepCleanCategory(c.type)),
    [visibleCategories],
  )
  const groupedCategories = useMemo(
    () =>
      CLEANER_GROUPS.map((groupKey) => ({
        groupKey,
        items: visibleCategories.filter((c) => c.group === groupKey),
      })).filter((g) => g.items.length > 0),
    [visibleCategories],
  )
  const [activeCategory, setActiveCategory] = useState<CleanerType>(CleanerType.System)
  const [showConfirm, setShowConfirm] = useState(false)
  const [cleanMode, setCleanMode] = useState<CleanMode>('quick')
  const [showNetworkModal, setShowNetworkModal] = useState(false)
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set())
  const cleanStartRef = useRef<number>(0)
  const cleaningRef = useRef(false)
  const [scanningCategory, setScanningCategory] = useState<CleanerType | null>(null)
  const [report, setReport] = useState<ReportData | null>(() => loadReport())

  const scanIndexRef = useRef(0)
  const cleanIndexRef = useRef(0)
  const cleanTotalRef = useRef(1)
  const totalCategoriesRef = useRef(scanCategories.length)
  totalCategoriesRef.current = scanCategories.length
  const setProgress = useScanStore((s) => s.setProgress)

  useEffect(() => {
    if (!window.dinho?.onScanProgress) return
    return window.dinho.onScanProgress((data) => {
      // Branch on the page's own status rather than the event phase: the WinSxS
      // analysis emitted during a full clean reports phase 'scanning' while the
      // page is already cleaning, which would otherwise mix the two tracks.
      const cleaning = useScanStore.getState().status === ScanStatus.Cleaning
      const total = Math.max(cleaning ? cleanTotalRef.current : totalCategoriesRef.current, 1)
      const base = ((cleaning ? cleanIndexRef.current : scanIndexRef.current) / total) * 100
      const slice = Math.min(data.progress, 100) / total
      setProgress({ ...data, progress: Math.min(100, base + slice) })
    })
  }, [setProgress])

  const [failedCategories, setFailedCategories] = useState<string[]>([])
  const [elevationSkipped, setElevationSkipped] = useState<string[]>([])

  const handleRelaunch = useCallback(() => {
    window.dinho.elevationRelaunch()
  }, [])

  const performScan = useCallback(async (): Promise<ScanResult[]> => {
    store.setStatus(ScanStatus.Scanning)
    store.setResults([])
    setExpandedGroups(new Set())
    setFailedCategories([])
    setElevationSkipped([])
    const collected: ScanResult[] = []
    const failed: string[] = []
    const skippedForElevation: string[] = []
    try {
      const scanFns: Partial<Record<CleanerType, () => Promise<ScanResult[]>>> = {
        [CleanerType.System]: () => window.dinho.systemScan(),
        [CleanerType.Browser]: () => window.dinho.browserScan(),
        [CleanerType.App]: () => window.dinho.appScan(),
        [CleanerType.Gaming]: () => window.dinho.gamingScan(),
        [CleanerType.RecycleBin]: () => window.dinho.recycleBinScan(),
        [CleanerType.Shortcut]: () => window.dinho.shortcutScan(),
        [CleanerType.Environment]: () => window.dinho.environmentScan(),
        [CleanerType.Database]: () => window.dinho.databaseScan(),
        [CleanerType.UninstallLeftovers]: () => window.dinho.uninstallLeftoversScan(),
      }
      for (let ci = 0; ci < scanCategories.length; ci++) {
        const cat = scanCategories[ci]
        if (!cat) continue
        scanIndexRef.current = ci
        setScanningCategory(cat.type)
        try {
          const scanFn = scanFns[cat.type]
          if (!scanFn) continue
          const results = await scanFn()
          const elevationMarker = results.find((r) => r.subcategory === '__elevation_required')
          if (elevationMarker?.group) {
            skippedForElevation.push(...elevationMarker.group.split(', '))
          }
          const clean = results.filter((r) => r.subcategory !== '__elevation_required')
          store.addResults(clean)
          collected.push(...clean)
        } catch (err) {
          logger.error('CleanerPage', `Scan failed for category ${cat.type}`, err)
          failed.push(t(cat.labelKey))
        }
      }
      if (failed.length > 0) setFailedCategories(failed)
      if (skippedForElevation.length > 0) setElevationSkipped(skippedForElevation)
      setScanningCategory(null)
      store.setStatus(ScanStatus.Complete)
    } catch (err) {
      logger.error('CleanerPage', 'Scan failed', err)
      setScanningCategory(null)
      store.setStatus(ScanStatus.Error)
    }
    store.setProgress(null)
    return collected
  }, [store, scanCategories, t])

  const handleScan = useCallback(() => {
    void performScan()
  }, [performScan])

  const requestClean = useCallback((mode: CleanMode) => {
    setCleanMode(mode)
    setShowConfirm(true)
  }, [])

  const runClean = useCallback(
    async (mode: CleanMode) => {
      // Guard against a second run while one is in flight: the confirm button
      // stays clickable during the dialog's exit animation.
      if (cleaningRef.current) return
      cleaningRef.current = true
      setShowConfirm(false)
      store.setStatus(ScanStatus.Cleaning)
      cleanStartRef.current = Date.now()
      try {
        let results = store.results
        if (mode === 'full') {
          // A full clean must cover every category. If the light categories were
          // never analysed (e.g. a machine whose only reclaimable data is WinSxS)
          // run the normal scan first, then add the deep category.
          if (store.status !== ScanStatus.Complete) {
            results = await performScan()
          }
          try {
            const deepRaw = await window.dinho.winSxSScan()
            const elevationMarker = deepRaw.find((r) => r.subcategory === '__elevation_required')
            if (elevationMarker?.group) {
              const skipped = elevationMarker.group.split(', ')
              setElevationSkipped((prev) => [...prev, ...skipped])
            }
            const deepResults = deepRaw.filter((r) => r.subcategory !== '__elevation_required')
            store.addResults(deepResults)
            results = [...results, ...deepResults]
          } catch (err) {
            logger.error('CleanerPage', 'WinSxS analyse failed', err)
          }
        }

        // Merge by (category, subcategory) so a re-run full clean — whose store
        // already holds the previous WinSxS entry — does not process it twice.
        const byKey = new Map<string, ScanResult>()
        for (const r of results) byKey.set(`${r.category}:${r.subcategory}`, r)
        results = [...byKey.values()]

        const cleanCategories =
          mode === 'quick' ? visibleCategories.filter((c) => !isDeepCleanCategory(c.type)) : visibleCategories

        const cleanFns: Partial<Record<CleanerType, (ids: string[]) => Promise<CleanResult>>> = {
          [CleanerType.System]: (ids) => window.dinho.systemClean(ids),
          [CleanerType.WinSxS]: () => window.dinho.winSxSClean(),
          [CleanerType.Browser]: (ids) => window.dinho.browserClean(ids),
          [CleanerType.App]: (ids) => window.dinho.appClean(ids),
          [CleanerType.Gaming]: (ids) => window.dinho.gamingClean(ids),
          [CleanerType.RecycleBin]: () => window.dinho.recycleBinClean(),
          [CleanerType.Shortcut]: (ids) => window.dinho.shortcutClean(ids),
          [CleanerType.Environment]: (ids) => window.dinho.environmentClean(ids),
          [CleanerType.Database]: (ids) => window.dinho.databaseClean(ids),
          [CleanerType.UninstallLeftovers]: (ids) => window.dinho.uninstallLeftoversClean(ids),
        }
        let totalCleaned = 0
        let totalFiles = 0
        let totalSkipped = 0
        let anyNeedsElevation = false
        const allErrors: { path: string; reason: string }[] = []
        const categoryBreakdown: Array<{
          name: string
          type: string
          found: number
          cleaned: number
          space: number
        }> = []

        // Clean every found item except the subcategories the user unchecked
        // (those are persisted exclusions, shared with the Dashboard one-click
        // clean). Per-item selection is not an opt-in list.
        const isExcluded = (r: ScanResult) => store.excludedSubcategories.has(`${r.category}:${r.subcategory}`)
        const activeCount = cleanCategories.filter((cat) =>
          results.some((r) => r.category === cat.type && !isExcluded(r) && r.items.length > 0),
        ).length
        cleanTotalRef.current = Math.max(activeCount, 1)
        let activeIndex = 0

        store.setProgress({
          phase: 'cleaning',
          category: '',
          currentPath: '',
          progress: 0,
          itemsFound: 0,
          sizeFound: 0,
        })

        for (const cat of cleanCategories) {
          const catResults = results.filter((r) => r.category === cat.type && !isExcluded(r))
          const catItemsAll = catResults.flatMap((r) => r.items)
          if (catItemsAll.length === 0) continue
          cleanIndexRef.current = activeIndex
          try {
            const cleanFn = cleanFns[cat.type]
            if (!cleanFn) continue
            const result = await cleanFn(catItemsAll.map((item) => item.id))
            if (result) {
              totalCleaned += result.totalCleaned || 0
              totalFiles += result.filesDeleted || 0
              totalSkipped += result.filesSkipped || 0
              if (result.needsElevation) anyNeedsElevation = true
              if (result.errors?.length) allErrors.push(...result.errors)
              categoryBreakdown.push({
                name: t(cat.labelKey),
                type: cat.type,
                found: catItemsAll.length,
                cleaned: result.filesDeleted || 0,
                space: result.totalCleaned || 0,
              })
            }
          } catch (err) {
            logger.error('CleanerPage', `Clean failed for category ${cat.type}`, err)
            // Surface the failure instead of dropping the category silently:
            // count it as an error and keep it in the breakdown with 0 cleaned.
            allErrors.push({
              path: t(cat.labelKey),
              reason: err instanceof Error ? err.message : String(err),
            })
            categoryBreakdown.push({
              name: t(cat.labelKey),
              type: cat.type,
              found: catItemsAll.length,
              cleaned: 0,
              space: 0,
            })
          }
          activeIndex++
        }

        const totalFound = results.reduce((s, r) => s + r.itemCount, 0)
        const duration = Date.now() - cleanStartRef.current
        await addEntry({
          id: Date.now().toString(),
          type: 'cleaner',
          timestamp: new Date().toISOString(),
          duration,
          totalItemsFound: totalFound,
          totalItemsCleaned: totalFiles,
          totalItemsSkipped: totalSkipped,
          totalSpaceSaved: totalCleaned,
          categories: categoryBreakdown.map((d) => ({
            name: d.name,
            itemsFound: d.found,
            itemsCleaned: d.cleaned,
            spaceSaved: d.space,
          })),
          errorCount: allErrors.length,
        })
        recomputeStats()

        const totalSizeBefore = store.getTotalSize()
        store.setCleanSummary({
          totalCleaned,
          filesDeleted: totalFiles,
          filesSkipped: totalSkipped,
          errors: allErrors,
          needsElevation: anyNeedsElevation,
          categories: categoryBreakdown,
          duration,
          totalSizeBefore,
        })
        const reportData: ReportData = {
          timestamp: new Date().toISOString(),
          spaceBefore: totalSizeBefore,
          spaceAfter: totalSizeBefore - totalCleaned,
          spaceFreed: totalCleaned,
          filesDeleted: totalFiles,
          duration,
          categories: categoryBreakdown,
        }
        saveReport(reportData)
        setReport(reportData)
        store.setStatus(ScanStatus.Complete)
      } catch (err) {
        logger.error('CleanerPage', 'Clean failed', err)
        store.setStatus(ScanStatus.Error)
      } finally {
        cleaningRef.current = false
      }
      store.setProgress(null)
    },
    [store, t, visibleCategories, addEntry, recomputeStats, performScan],
  )

  const toggleGroup = (key: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleSubcategorySelection = (result: ScanResult) => {
    store.toggleSubcategory(result)
  }

  const isScanning = store.status === ScanStatus.Scanning
  const isCleaning = store.status === ScanStatus.Cleaning
  const hasResults = store.results.length > 0

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex items-center gap-2.5" data-testid="page-header-actions">
            <button
              type="button"
              onClick={handleScan}
              disabled={isScanning || isCleaning}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              {t('scanButton')}
            </button>
            <button
              type="button"
              onClick={() => requestClean('quick')}
              disabled={!hasResults || isScanning || isCleaning}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
                boxShadow: hasResults ? '0 4px 20px rgba(245,158,11,0.2)' : 'none',
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              {t('quickCleanButton')}
            </button>
            <button
              type="button"
              onClick={() => requestClean('full')}
              disabled={isScanning || isCleaning}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <Layers className="h-4 w-4" strokeWidth={1.8} />
              {t('fullCleanButton')}
            </button>
          </div>
        }
      />

      <div className="flex gap-5">
        {/* Category sidebar */}
        <div className="w-64 shrink-0 space-y-4">
          {hasResults && (
            <div
              className="rounded-2xl p-4"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
            >
              <p className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {t('totalRecoverable')}
              </p>
              <p className="text-[20px] font-bold tracking-tight text-amber-400">{formatBytes(store.getTotalSize())}</p>
              <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {t('itemsCount', { count: formatNumber(store.results.reduce((s, r) => s + r.itemCount, 0)) })}
              </p>
            </div>
          )}

          {groupedCategories.map((group) => (
            <div key={group.groupKey} data-testid={`category-group-${group.groupKey}`}>
              <div className="mb-1.5 flex items-center gap-2.5 px-4" data-testid={`group-heading-${group.groupKey}`}>
                <span
                  className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em]"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {t(group.groupKey)}
                </span>
                <div className="h-px flex-1" style={{ background: 'var(--border-subtle)' }} />
              </div>

              <div className="space-y-0.5">
                {group.items.map((cat) => {
                  const count = store.results
                    .filter((r) => r.category === cat.type)
                    .reduce((sum, r) => sum + r.itemCount, 0)
                  const isActive = activeCategory === cat.type
                  return (
                    <button
                      type="button"
                      key={cat.type}
                      onClick={() => setActiveCategory(cat.type)}
                      className="relative w-full rounded-xl px-4 py-2.5 text-left transition-all hover:bg-[var(--bg-hover)]"
                      style={{
                        background: isActive ? 'var(--accent-muted-bg)' : 'transparent',
                        color: isActive ? 'var(--accent-hover)' : 'var(--text-muted)',
                      }}
                    >
                      {isActive && (
                        <div
                          className="absolute left-0 top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-r-full"
                          style={{ background: 'var(--accent)' }}
                        />
                      )}
                      <div className="flex items-center gap-3">
                        {scanningCategory === cat.type ? (
                          <Loader2
                            className="h-[17px] w-[17px] shrink-0 animate-spin text-amber-400"
                            strokeWidth={1.8}
                          />
                        ) : (
                          <cat.icon className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
                        )}
                        <span className="flex-1 min-w-0 text-[13px] font-medium">{t(cat.labelKey)}</span>
                        {count > 0 && (
                          <span
                            className="shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[11px]"
                            style={{ background: 'var(--bg-hover-2)', color: 'var(--text-muted)' }}
                          >
                            {count}
                          </span>
                        )}
                      </div>
                      {isActive && (
                        <p
                          className="mt-1 pl-[29px] text-[11px] leading-relaxed"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {t(cat.descriptionKey)}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}

          <button
            type="button"
            onClick={() => setShowNetworkModal(true)}
            className="flex w-full items-center gap-3 rounded-xl px-4 py-2.5 text-[13px] font-medium transition-all hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text-muted)' }}
          >
            <Wifi className="h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
            {t('networkLink')}
          </button>
        </div>

        {/* Item panel */}
        <div className="flex-1 min-w-0">
          {(isScanning || isCleaning) && store.progress && (
            <ScanProgress
              status={isScanning ? 'scanning' : 'cleaning'}
              progress={store.progress.progress}
              currentPath={store.progress.currentPath}
              itemsFound={store.progress.itemsFound}
              sizeFound={store.progress.sizeFound}
              className="mb-5"
            />
          )}

          {failedCategories.length > 0 && store.status === ScanStatus.Complete && (
            <div
              className="mb-5 flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: 'var(--accent-muted-bg)', border: '1px solid rgba(245,158,11,0.12)' }}
            >
              <TriangleAlert className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} />
              <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {t('scannersFailed')} <span className="text-amber-400 font-medium">{failedCategories.join(', ')}</span>
              </p>
            </div>
          )}

          {elevationSkipped.length > 0 && store.status === ScanStatus.Complete && !store.cleanSummary && (
            <div
              className="mb-5 flex items-center gap-3 rounded-2xl px-4 py-3"
              style={{ background: 'var(--accent-muted-bg)', border: '1px solid var(--accent-muted-border)' }}
            >
              <ShieldAlert className="h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} />
              <div className="flex-1 min-w-0">
                <p className="text-[12px] text-zinc-300">
                  <span className="font-medium">{t('categoriesSkipped', { count: elevationSkipped.length })}</span>
                  <span style={{ color: 'var(--text-muted)' }}> {t('categoriesSkippedSuffix')}</span>
                </p>
                <p className="text-[11px] mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
                  {elevationSkipped.slice(0, 4).join(', ')}
                  {elevationSkipped.length > 4
                    ? ` ${t('categoriesSkippedMore', { count: elevationSkipped.length - 4 })}`
                    : ''}
                </p>
              </div>
              {platform !== 'darwin' && (
                <button
                  type="button"
                  onClick={handleRelaunch}
                  className="shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium text-amber-400 transition-colors hover:bg-amber-500/15"
                  style={{ border: '1px solid rgba(245,158,11,0.2)' }}
                >
                  {t('relaunchAsAdmin')}
                </button>
              )}
            </div>
          )}

          {store.cleanSummary && store.status === ScanStatus.Complete && (
            <CleanSummary summary={store.cleanSummary} onRelaunchAsAdmin={handleRelaunch} platform={platform} />
          )}

          {report && !hasResults && !isScanning && <ReportCard report={report} icon={FileText} />}

          {!hasResults && !isScanning && (
            <EmptyState
              icon={Search}
              title={t('noScanResultsTitle')}
              description={t('noScanResultsDescription')}
              showLastScan
              lastScanType="cleaner"
              actions={[
                {
                  label: t('startScan'),
                  onClick: handleScan,
                  icon: Search,
                },
              ]}
            />
          )}

          {hasResults && (
            <CategoryResultsPanel
              activeCategory={activeCategory}
              expandedGroups={expandedGroups}
              toggleGroup={toggleGroup}
              toggleSubcategorySelection={toggleSubcategorySelection}
            />
          )}
        </div>
      </div>

      <NetworkCleanupModal open={showNetworkModal} onClose={() => setShowNetworkModal(false)} />

      <ConfirmDialog
        open={showConfirm}
        onConfirm={() => runClean(cleanMode)}
        onCancel={() => setShowConfirm(false)}
        title={t(cleanMode === 'full' ? 'confirmFullCleanTitle' : 'confirmQuickCleanTitle')}
        description={t(cleanMode === 'full' ? 'confirmFullCleanDescription' : 'confirmQuickCleanDescription')}
        confirmLabel={t(cleanMode === 'full' ? 'confirmFullCleanLabel' : 'confirmQuickCleanLabel')}
        variant="warning"
      />
    </div>
  )
}
