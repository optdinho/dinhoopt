import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { usePlatform } from '@/hooks/usePlatform'
import logger from '@/lib/renderer-logger'
import { useContextMenuStore } from '@/stores/context-menu-store'
import type { ContextMenuAction, ContextMenuApplyRequest, ContextMenuScope, ContextMenuSource } from '@shared/types'
import { Filter, MousePointerClick, RotateCcw, Search } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { ApplyProgressCard } from '@/components/cleaner/ApplyProgressCard'
import { ApplyResultCard } from '@/components/cleaner/ApplyResultCard'
import { BulkActionBar } from '@/components/cleaner/BulkActionBar'
import { ElevationBanner } from '@/components/cleaner/ElevationBanner'
import { EntryGroupCard } from '@/components/cleaner/EntryGroupCard'
import { FilterBar } from '@/components/cleaner/FilterBar'
import { ScanProgressSection } from '@/components/cleaner/ScanProgressSection'
import { Win11NoticeBanner } from '@/components/cleaner/Win11NoticeBanner'
import { HIDDEN_SOURCES, WIN11_NOTICE_KEY, filterEntries, groupByBinary } from '@/components/cleaner/constants'

export function ContextMenuCleanerPage() {
  const { features } = usePlatform()
  const { t } = useTranslation('contextMenu')

  if (!features.contextMenu) {
    return (
      <div className="animate-fade-in">
        <PageHeader title={t('pageHeaderUnavailableTitle')} description={t('pageHeaderUnavailableDescription')} />
        <EmptyState
          icon={MousePointerClick}
          title={t('notAvailableTitle')}
          description={t('notAvailableDescription')}
        />
      </div>
    )
  }
  return <ContextMenuCleanerPageContent />
}

function ContextMenuCleanerPageContent() {
  const { t } = useTranslation('contextMenu')

  const entries = useContextMenuStore((s) => s.entries)
  const scanning = useContextMenuStore((s) => s.scanning)
  const scanned = useContextMenuStore((s) => s.scanned)
  const applying = useContextMenuStore((s) => s.applying)
  const applyProg = useContextMenuStore((s) => s.applyProgress)
  const applyResult = useContextMenuStore((s) => s.applyResult)
  const showErrors = useContextMenuStore((s) => s.showErrors)
  const error = useContextMenuStore((s) => s.error)
  const filters = useContextMenuStore((s) => s.filters)

  const [showWin11, setShowWin11] = useState(() => {
    try {
      return !localStorage.getItem(WIN11_NOTICE_KEY)
    } catch {
      return true
    }
  })
  const [pendingDelete, setPendingDelete] = useState<ContextMenuApplyRequest[] | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    const cleanup = window.dinho.onContextMenuApplyProgress((data) => {
      useContextMenuStore.getState().setApplyProgress(data)
    })
    cleanupRef.current = cleanup
    return () => cleanup()
  }, [])

  const handleScan = useCallback(async () => {
    const store = useContextMenuStore.getState()
    store.setScanning(true)
    store.setScanned(false)
    store.setEntries([])
    store.setApplyResult(null)
    store.setError(null)
    try {
      const result = await window.dinho.contextMenuScan()
      const sorted = [...(result.entries ?? [])].sort((a, b) => {
        if (a.source === b.source) return a.displayName.localeCompare(b.displayName)
        if (a.source === 'Unknown') return 1
        if (b.source === 'Unknown') return -1
        return a.source.localeCompare(b.source)
      })
      useContextMenuStore.getState().setEntries(sorted)
      useContextMenuStore.getState().setScanned(true)
    } catch (err) {
      logger.error('ContextMenuCleanerPage', 'Context-menu scan failed', err)
      toast.error(t('toastScanFailed'), { description: t('toastScanFailedDescription') })
      useContextMenuStore.getState().setError(t('toastScanFailedDescription'))
    }
    useContextMenuStore.getState().setScanning(false)
  }, [t])

  const handleScanCancel = useCallback(async () => {
    try {
      await window.dinho.contextMenuScanCancel()
    } catch {
      /* ignore */
    }
    useContextMenuStore.getState().setScanning(false)
  }, [])

  const dismissWin11 = useCallback(() => {
    try {
      localStorage.setItem(WIN11_NOTICE_KEY, '1')
    } catch {
      /* skip */
    }
    setShowWin11(false)
  }, [])

  const baseEntries = useMemo(
    () =>
      entries.filter((e) => {
        if (e.protected) return false
        if (HIDDEN_SOURCES.has(e.source)) return false
        if (e.hive === 'HKCR' && !e.command && !e.dllPath) return false
        if (/[&|<>^]/.test(e.name)) return false
        return true
      }),
    [entries],
  )

  const visible = useMemo(() => filterEntries(baseEntries, filters), [baseEntries, filters])
  const groups = useMemo(() => groupByBinary(visible), [visible])

  const availableSources = useMemo(() => {
    const set = new Set<ContextMenuSource>()
    for (const e of baseEntries) set.add(e.source)
    return Array.from(set).sort()
  }, [baseEntries])
  const availableScopes = useMemo(() => {
    const set = new Set<ContextMenuScope>()
    for (const e of baseEntries) set.add(e.scope)
    return Array.from(set).sort()
  }, [baseEntries])

  const selectedRequests = useMemo(() => entries.filter((e) => e.selected && !e.protected), [entries])
  const selectedCount = selectedRequests.length

  const buildRequests = (action: ContextMenuAction): ContextMenuApplyRequest[] =>
    selectedRequests.map((e) => ({ entryId: e.id, action }))

  const handleApply = useCallback(
    async (action: ContextMenuAction, requests?: ContextMenuApplyRequest[]) => {
      const reqs =
        requests ??
        useContextMenuStore
          .getState()
          .entries.filter((e) => e.selected && !e.protected)
          .map((e) => ({ entryId: e.id, action }))
      if (reqs.length === 0) return
      const store = useContextMenuStore.getState()
      store.setApplying(true)
      store.setApplyResult(null)
      store.setApplyProgress({ current: 0, total: reqs.length, currentLabel: t('applyingTitle') })
      try {
        const result = await window.dinho.contextMenuApply(reqs)
        const s = useContextMenuStore.getState()
        s.setApplyResult(result)
        if (result.updates.length > 0) s.applyUpdates(result.updates)
        if (action === 'delete') {
          const ok = new Set(result.updates.map((u) => u.entryId))
          const succeededIds = reqs.filter((r) => ok.has(r.entryId)).map((r) => r.entryId)
          if (succeededIds.length > 0) s.removeEntries(succeededIds)
        }
      } catch (err) {
        logger.error('ContextMenuCleanerPage', 'Context-menu apply failed', err)
        toast.error(t('toastApplyFailed'), { description: t('toastApplyFailedDescription') })
        useContextMenuStore.getState().setError(t('toastApplyFailedDescription'))
      }
      useContextMenuStore.getState().setApplying(false)
      useContextMenuStore.getState().setApplyProgress(null)
    },
    [t],
  )

  const onConfirmDelete = useCallback(() => {
    const reqs = pendingDelete
    setPendingDelete(null)
    if (reqs) handleApply('delete', reqs)
  }, [pendingDelete, handleApply])

  const handleEntryAction = useCallback(
    (entryId: string, action: ContextMenuAction) => {
      if (action === 'delete') {
        setPendingDelete([{ entryId, action }])
      } else {
        handleApply(action, [{ entryId, action }])
      }
    },
    [handleApply],
  )

  const requiresAdminInSelection = selectedRequests.some((e) => e.requiresAdmin)

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handleScan}
              disabled={scanning || applying}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              {scanned ? (
                <RotateCcw className="h-4 w-4" strokeWidth={1.8} />
              ) : (
                <Search className="h-4 w-4" strokeWidth={1.8} />
              )}
              {scanned ? t('rescanButton') : t('scanButton')}
            </button>
          </div>
        }
      />

      <Win11NoticeBanner show={showWin11} onDismiss={dismissWin11} />

      {error && (
        <ErrorAlert message={error} onDismiss={() => useContextMenuStore.getState().setError(null)} className="mb-5" />
      )}

      <ScanProgressSection scanning={scanning} onCancel={handleScanCancel} />

      <ApplyProgressCard progress={applyProg} applying={applying} />
      <ApplyResultCard result={applyResult} showErrors={showErrors} />

      {!scanned && !scanning && (
        <EmptyState
          icon={MousePointerClick}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              type="button"
              onClick={handleScan}
              disabled={applying}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <Search className="h-4 w-4" strokeWidth={1.8} /> {t('scanButton')}
            </button>
          }
        />
      )}

      {scanned && entries.length > 0 && (
        <FilterBar
          filters={filters}
          availableScopes={availableScopes}
          availableSources={availableSources}
          onChange={(key, value) => useContextMenuStore.getState().setFilter(key, value)}
        />
      )}

      {scanned && visible.length === 0 && (
        <EmptyState icon={Filter} title={t('noResultsTitle')} description={t('noResultsDescription')} />
      )}

      {scanned && groups.length > 0 && (
        <div className="grid grid-cols-1 gap-3" style={{ paddingBottom: selectedCount > 0 ? 90 : 0 }}>
          {groups.map((group) => (
            <EntryGroupCard
              key={`bin:${group.binary}`}
              group={group}
              applying={applying}
              onEntryAction={handleEntryAction}
            />
          ))}
        </div>
      )}

      {selectedCount > 0 && !applying && (
        <BulkActionBar
          selectedCount={selectedCount}
          onDisable={() => handleApply('disable')}
          onEnable={() => handleApply('enable')}
          onDelete={() => setPendingDelete(buildRequests('delete'))}
        />
      )}

      <ElevationBanner show={requiresAdminInSelection && selectedCount > 0 && !applying} />

      <ConfirmDialog
        open={!!pendingDelete}
        onConfirm={onConfirmDelete}
        onCancel={() => setPendingDelete(null)}
        title={t('confirmDeleteTitle')}
        description={
          (pendingDelete?.length ?? 0) === 1
            ? t('confirmDeleteDescription', { count: pendingDelete?.length ?? 0 })
            : t('confirmDeleteDescriptionPlural', { count: pendingDelete?.length ?? 0 })
        }
        confirmLabel={t('confirmDeleteLabel')}
        variant="danger"
      />
    </div>
  )
}
