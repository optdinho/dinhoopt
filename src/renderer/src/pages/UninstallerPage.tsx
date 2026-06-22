import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { UninstallerProgramCard } from '@/components/uninstaller/UninstallerProgramCard'
import { UninstallerToolbar } from '@/components/uninstaller/UninstallerToolbar'
import { isUnused } from '@/components/uninstaller/constants'
import logger from '@/lib/renderer-logger'
import { formatBytes } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'
import { UNUSED_THRESHOLD_DAYS, useUninstallerStore } from '@/stores/uninstaller-store'
import type { InstalledProgram, UninstallProgress } from '@shared/types'
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  Loader2,
  MinusSquare,
  Package,
  Search,
  Shield,
  Square,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

export function UninstallerPage() {
  const { t } = useTranslation('uninstaller')
  const programs = useUninstallerStore((s) => s.programs)
  const loading = useUninstallerStore((s) => s.loading)
  const uninstalling = useUninstallerStore((s) => s.uninstalling)
  const progress = useUninstallerStore((s) => s.progress)
  const uninstallResult = useUninstallerStore((s) => s.uninstallResult)
  const error = useUninstallerStore((s) => s.error)
  const hasLoaded = useUninstallerStore((s) => s.hasLoaded)
  const searchQuery = useUninstallerStore((s) => s.searchQuery)
  const sortField = useUninstallerStore((s) => s.sortField)
  const sortDirection = useUninstallerStore((s) => s.sortDirection)
  const filterMode = useUninstallerStore((s) => s.filterMode)
  const selectedIds = useUninstallerStore((s) => s.selectedIds)

  const [confirmProgram, setConfirmProgram] = useState<InstalledProgram | null>(null)
  const [confirmForceRemove, setConfirmForceRemove] = useState<InstalledProgram | null>(null)
  const [confirmBatch, setConfirmBatch] = useState(false)
  const uninstallStartRef = useRef<number>(0)
  const lastFailedProgramRef = useRef<InstalledProgram | null>(null)
  const addEntry = useHistoryStore((s) => s.addEntry)
  const recomputeStats = useStatsStore((s) => s.recompute)

  const handleLoad = useCallback(async () => {
    const store = useUninstallerStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setUninstallResult(null)
    store.setExpandedItemId(null)
    try {
      const result = await window.dinho.uninstallerList()
      const s = useUninstallerStore.getState()
      s.setPrograms(result.programs)
      s.setHasLoaded(true)
      s.fetchSafetyRatings()
    } catch (err) {
      logger.error('UninstallerPage', 'Failed to list programs', err)
      toast.error(t('failedToLoadToast'))
      useUninstallerStore.getState().setError(t('failedToLoadError'))
    } finally {
      useUninstallerStore.getState().setLoading(false)
    }
  }, [t])

  useEffect(() => {
    const cleanup = window.dinho.onUninstallerProgress((data: UninstallProgress) => {
      useUninstallerStore.getState().setProgress(data)
    })
    return () => {
      cleanup()
    }
  }, [])

  useEffect(() => {
    if (!hasLoaded && !loading) handleLoad()
  }, [hasLoaded, loading, handleLoad])

  useEffect(() => {
    if (hasLoaded && Object.keys(useUninstallerStore.getState().safetyRatings).length === 0) {
      useUninstallerStore.getState().fetchSafetyRatings()
    }
  }, [hasLoaded])

  const handleUninstall = useCallback(async () => {
    if (!confirmProgram) return
    const program = confirmProgram
    setConfirmProgram(null)
    const store = useUninstallerStore.getState()
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()
    lastFailedProgramRef.current = program
    try {
      const result = await window.dinho.uninstallerUninstall(program.id)
      const s = useUninstallerStore.getState()
      s.setUninstallResult(result)
      s.setProgress(null)
      if (result.success) {
        lastFailedProgramRef.current = null
        s.removeProgram(program.id)
        if (result.leftoversCleaned > 0) {
          await addEntry({
            id: Date.now().toString(),
            type: 'cleaner',
            timestamp: new Date().toISOString(),
            duration: Date.now() - uninstallStartRef.current,
            totalItemsFound: result.leftoversFound,
            totalItemsCleaned: result.leftoversCleaned,
            totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
            totalSpaceSaved: result.leftoversSize,
            categories: [
              {
                name: `Uninstall: ${result.programName}`,
                itemsFound: result.leftoversFound,
                itemsCleaned: result.leftoversCleaned,
                spaceSaved: result.leftoversSize,
              },
            ],
            errorCount: 0,
          })
          recomputeStats()
        }
      }
    } catch (err) {
      logger.error('UninstallerPage', 'Uninstall failed', err)
      toast.error(t('uninstallFailedToast'))
      useUninstallerStore.getState().setError(t('uninstallFailedError'))
    } finally {
      useUninstallerStore.getState().setUninstalling(false)
    }
  }, [confirmProgram, addEntry, recomputeStats, t])

  const handleBatchUninstall = useCallback(async () => {
    setConfirmBatch(false)
    const store = useUninstallerStore.getState()
    const toUninstall = store.programs.filter((p) => store.selectedIds.has(p.id))
    if (toUninstall.length === 0) return
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()
    lastFailedProgramRef.current = null
    let successCount = 0
    let failCount = 0
    let totalLeftoversCleaned = 0
    let totalLeftoversSize = 0
    for (const program of toUninstall) {
      try {
        const result = await window.dinho.uninstallerUninstall(program.id)
        const s = useUninstallerStore.getState()
        if (result.success) {
          successCount++
          s.removeProgram(program.id)
          totalLeftoversCleaned += result.leftoversCleaned
          totalLeftoversSize += result.leftoversSize
          if (result.leftoversCleaned > 0) {
            await addEntry({
              id: Date.now().toString(),
              type: 'cleaner',
              timestamp: new Date().toISOString(),
              duration: Date.now() - uninstallStartRef.current,
              totalItemsFound: result.leftoversFound,
              totalItemsCleaned: result.leftoversCleaned,
              totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
              totalSpaceSaved: result.leftoversSize,
              categories: [
                {
                  name: `Uninstall: ${result.programName}`,
                  itemsFound: result.leftoversFound,
                  itemsCleaned: result.leftoversCleaned,
                  spaceSaved: result.leftoversSize,
                },
              ],
              errorCount: 0,
            })
          }
        } else {
          failCount++
        }
      } catch {
        failCount++
      }
    }
    const s = useUninstallerStore.getState()
    s.clearSelected()
    s.setProgress(null)
    s.setUninstalling(false)
    if (failCount === 0) {
      s.setUninstallResult({
        success: true,
        programName:
          successCount !== 1
            ? t('batchResultProgramsPlural', { count: successCount })
            : t('batchResultProgramsSingular', { count: successCount }),
        exitCode: null,
        leftoversFound: totalLeftoversCleaned,
        leftoversCleaned: totalLeftoversCleaned,
        leftoversSize: totalLeftoversSize,
      })
    } else {
      s.setUninstallResult({
        success: successCount > 0,
        programName:
          successCount + failCount !== 1
            ? t('batchResultProgramsPlural', { count: successCount + failCount })
            : t('batchResultProgramsSingular', { count: successCount + failCount }),
        exitCode: null,
        error: t('batchResultFailedSucceeded', { failed: failCount, succeeded: successCount }),
        leftoversFound: totalLeftoversCleaned,
        leftoversCleaned: totalLeftoversCleaned,
        leftoversSize: totalLeftoversSize,
      })
    }
    if (successCount > 0) recomputeStats()
  }, [addEntry, recomputeStats, t])

  const handleForceRemove = useCallback(async () => {
    if (!confirmForceRemove) return
    const program = confirmForceRemove
    setConfirmForceRemove(null)
    const store = useUninstallerStore.getState()
    store.setUninstalling(true)
    store.setUninstallResult(null)
    store.setError(null)
    store.setProgress(null)
    uninstallStartRef.current = Date.now()
    try {
      const result = await window.dinho.uninstallerForceRemove(program.id)
      const s = useUninstallerStore.getState()
      s.setUninstallResult(result)
      s.setProgress(null)
      if (result.success) {
        lastFailedProgramRef.current = null
        s.removeProgram(program.id)
        if (result.leftoversCleaned > 0) {
          await addEntry({
            id: Date.now().toString(),
            type: 'cleaner',
            timestamp: new Date().toISOString(),
            duration: Date.now() - uninstallStartRef.current,
            totalItemsFound: result.leftoversFound,
            totalItemsCleaned: result.leftoversCleaned,
            totalItemsSkipped: result.leftoversFound - result.leftoversCleaned,
            totalSpaceSaved: result.leftoversSize,
            categories: [
              {
                name: `Force Remove: ${result.programName}`,
                itemsFound: result.leftoversFound,
                itemsCleaned: result.leftoversCleaned,
                spaceSaved: result.leftoversSize,
              },
            ],
            errorCount: 0,
          })
          recomputeStats()
        }
      }
    } catch (err) {
      logger.error('UninstallerPage', 'Force remove failed', err)
      toast.error(t('uninstallFailedToast'))
      useUninstallerStore.getState().setError(t('uninstallFailedError'))
    } finally {
      useUninstallerStore.getState().setUninstalling(false)
    }
  }, [confirmForceRemove, addEntry, recomputeStats, t])

  const filteredPrograms = useMemo(() => {
    let list = programs
    if (filterMode === 'unused') list = list.filter(isUnused)
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter((p) => p.displayName.toLowerCase().includes(q) || p.publisher.toLowerCase().includes(q))
    }
    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'estimatedSize':
          return (a.estimatedSize - b.estimatedSize) * dir
        case 'installDate':
          return a.installDate.localeCompare(b.installDate) * dir
        case 'publisher':
          return a.publisher.localeCompare(b.publisher) * dir
        case 'safety': {
          const safetyRatings = useUninstallerStore.getState().safetyRatings
          const sa = safetyRatings[a.displayName]?.safetyScore ?? 99
          const sb = safetyRatings[b.displayName]?.safetyScore ?? 99
          return (sa - sb) * dir
        }
        default:
          return a.displayName.localeCompare(b.displayName) * dir
      }
    })
  }, [programs, searchQuery, sortField, sortDirection, filterMode])

  const hasPrefetchData = useMemo(() => programs.some((p) => p.lastUsed !== -1), [programs])
  const unusedPrograms = useMemo(() => programs.filter(isUnused), [programs])
  const unusedTotalSize = useMemo(() => unusedPrograms.reduce((sum, p) => sum + p.estimatedSize, 0), [unusedPrograms])

  const isBusy = loading || uninstalling

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      <UninstallerToolbar
        loading={loading}
        isBusy={isBusy}
        hasPrefetchData={hasPrefetchData}
        handleLoad={handleLoad}
        onBatchUninstallClick={() => setConfirmBatch(true)}
      />

      {hasLoaded && !loading && hasPrefetchData && unusedPrograms.length > 0 && filterMode === 'all' && (
        <div
          className="mb-5 flex items-center justify-between rounded-2xl px-5 py-4 cursor-pointer transition-colors hover:border-amber-500/20"
          style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid var(--accent-muted-bg)' }}
          onClick={() => useUninstallerStore.getState().setFilterMode('unused')}
          onKeyDown={() => useUninstallerStore.getState().setFilterMode('unused')}
          role="button"
          tabIndex={0}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
            <div>
              <p className="text-[13px] font-medium text-zinc-200">
                {unusedPrograms.length !== 1
                  ? t('unusedBannerTitlePlural', { count: unusedPrograms.length, days: UNUSED_THRESHOLD_DAYS })
                  : t('unusedBannerTitle', { count: unusedPrograms.length, days: UNUSED_THRESHOLD_DAYS })}
              </p>
              <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {unusedTotalSize > 0
                  ? t('unusedBannerDescriptionWithSize', { size: formatBytes(unusedTotalSize) })
                  : t('unusedBannerDescriptionNoSize')}
              </p>
            </div>
          </div>
          <span
            className="rounded-full px-3 py-1 text-[11px] font-medium"
            style={{ background: 'rgba(245,158,11,0.1)', color: 'var(--accent-hover)' }}
          >
            {t('unusedBannerViewButton')}
          </span>
        </div>
      )}

      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid rgba(245,158,11,0.08)' }}
      >
        <Shield className="h-5 w-5 shrink-0 text-amber-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          <span className="font-semibold text-amber-500">{t('safeUninstallLabel')}</span> —{' '}
          {t('safeUninstallDescription')}
        </p>
      </div>

      {error && (
        <ErrorAlert message={error} onDismiss={() => useUninstallerStore.getState().setError(null)} className="mb-5" />
      )}

      {uninstalling && progress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid var(--accent-muted-bg)' }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {progress.phase === 'uninstalling'
                  ? t('progressUninstalling', { programName: progress.currentProgram })
                  : progress.phase === 'force-removing'
                    ? t('progressForceRemoving', { programName: progress.currentProgram })
                    : progress.phase === 'scanning-leftovers'
                      ? t('progressScanningLeftovers')
                      : progress.phase === 'cleaning-leftovers'
                        ? t('progressCleaningLeftovers')
                        : t('progressLoading')}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
              {progress.progress}%
            </span>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.progress}%`, background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)' }}
            />
          </div>
          <p className="mt-2 text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
            {progress.detail}
          </p>
        </div>
      )}

      {uninstallResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{
            background: uninstallResult.success ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${uninstallResult.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
          }}
        >
          {uninstallResult.success ? (
            <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" strokeWidth={1.8} />
          ) : (
            <Shield className="h-5 w-5 text-red-500 shrink-0" strokeWidth={1.8} />
          )}
          <div className="text-[13px] text-zinc-200">
            {uninstallResult.success ? (
              <p>
                {t('successfullyUninstalled')} <span className="font-medium">{uninstallResult.programName}</span>
                {uninstallResult.leftoversCleaned > 0 && (
                  <span className="text-green-400">
                    {' '}
                    —{' '}
                    {uninstallResult.leftoversCleaned !== 1
                      ? t('leftoversCleanedPlural', {
                          count: uninstallResult.leftoversCleaned,
                          size: formatBytes(uninstallResult.leftoversSize),
                        })
                      : t('leftoversCleaned', {
                          count: uninstallResult.leftoversCleaned,
                          size: formatBytes(uninstallResult.leftoversSize),
                        })}
                  </span>
                )}
                {uninstallResult.leftoversFound === 0 && (
                  <span style={{ color: 'var(--text-muted)' }}> — {t('noLeftoverFilesFound')}</span>
                )}
              </p>
            ) : (
              <p>
                {t('failedToUninstall')} <span className="font-medium">{uninstallResult.programName}</span>
                {uninstallResult.error && (
                  <span style={{ color: 'var(--text-muted)' }}> — {uninstallResult.error}</span>
                )}
              </p>
            )}
          </div>
          {!uninstallResult.success && lastFailedProgramRef.current && lastFailedProgramRef.current.registryKey && (
            <button
              type="button"
              onClick={() => setConfirmForceRemove(lastFailedProgramRef.current)}
              disabled={uninstalling}
              className="ml-auto shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-amber-400 transition-all hover:bg-amber-500/10 disabled:opacity-30"
              style={{ border: '1px solid rgba(245,158,11,0.15)' }}
            >
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
              {t('forceRemoveButton')}
            </button>
          )}
        </div>
      )}

      {!hasLoaded && !loading && (
        <EmptyState
          icon={Package}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              type="button"
              onClick={handleLoad}
              disabled={isBusy}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} />
              {t('loadPrograms')}
            </button>
          }
        />
      )}

      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="h-10 w-10 animate-spin text-amber-400 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('loadingInstalledPrograms')}</p>
        </div>
      )}

      {hasLoaded && !loading && filteredPrograms.length === 0 && programs.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Search className="h-10 w-10 text-zinc-600 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">
            {filterMode === 'unused' ? t('noUnusedProgramsFound') : t('noProgramsMatchSearch')}
          </p>
        </div>
      )}

      {hasLoaded && !loading && programs.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <CheckCircle2 className="h-10 w-10 text-green-500 mb-4" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('noInstalledProgramsFound')}</p>
        </div>
      )}

      {hasLoaded && !loading && filteredPrograms.length > 0 && (
        <div className="mb-6">
          <div className="mb-3 flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                const store = useUninstallerStore.getState()
                const allFilteredIds = filteredPrograms.map((p) => p.id)
                const allSelected = allFilteredIds.every((id) => selectedIds.has(id))
                if (allSelected) store.clearSelected()
                else store.selectAll(allFilteredIds)
              }}
              disabled={uninstalling}
              className="text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-30"
              title={filteredPrograms.every((p) => selectedIds.has(p.id)) ? t('deselectAll') : t('selectAll')}
            >
              {filteredPrograms.length > 0 && filteredPrograms.every((p) => selectedIds.has(p.id)) ? (
                <CheckSquare className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              ) : filteredPrograms.some((p) => selectedIds.has(p.id)) ? (
                <MinusSquare className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
              ) : (
                <Square className="h-4.5 w-4.5" strokeWidth={1.8} />
              )}
            </button>
            {filterMode === 'unused' ? (
              <AlertTriangle className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
            ) : (
              <Package className="h-4.5 w-4.5 text-amber-400" strokeWidth={1.8} />
            )}
            <span className="text-[13px] font-semibold text-zinc-200">
              {filterMode === 'unused' ? t('unusedProgramsHeading') : t('installedProgramsHeading')}{' '}
              {searchQuery
                ? t('programCount', {
                    filtered: filteredPrograms.length,
                    total: filterMode === 'unused' ? unusedPrograms.length : programs.length,
                  })
                : `(${filteredPrograms.length})`}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {filteredPrograms.map((prog) => (
              <UninstallerProgramCard
                key={prog.id}
                prog={prog}
                uninstalling={uninstalling}
                filterMode={filterMode}
                onUninstall={setConfirmProgram}
              />
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!confirmProgram}
        onConfirm={handleUninstall}
        onCancel={() => setConfirmProgram(null)}
        title={t('confirmUninstallTitle', { programName: confirmProgram?.displayName ?? '' })}
        description={t('confirmUninstallDescription')}
        confirmLabel={t('confirmUninstallLabel')}
        variant="danger"
      />
      <ConfirmDialog
        open={confirmBatch}
        onConfirm={handleBatchUninstall}
        onCancel={() => setConfirmBatch(false)}
        title={
          selectedIds.size !== 1
            ? t('confirmBatchTitlePlural', { count: selectedIds.size })
            : t('confirmBatchTitle', { count: selectedIds.size })
        }
        description={t('confirmBatchDescription')}
        details={programs
          .filter((p) => selectedIds.has(p.id))
          .map((p) => p.displayName)
          .join(', ')}
        confirmLabel={t('confirmBatchLabel', { count: selectedIds.size })}
        variant="danger"
      />
      <ConfirmDialog
        open={!!confirmForceRemove}
        onConfirm={handleForceRemove}
        onCancel={() => setConfirmForceRemove(null)}
        title={t('confirmForceRemoveTitle', { programName: confirmForceRemove?.displayName ?? '' })}
        description={t('confirmForceRemoveDescription')}
        confirmLabel={t('confirmForceRemoveLabel')}
        variant="warning"
      />
    </div>
  )
}
