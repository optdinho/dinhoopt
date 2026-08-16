import type { BloatwareApp } from '@shared/types'
import { CircleCheckBig, Loader2, Package, PackageMinus, Search, Shield, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/layout/PageHeader'
import { Checkbox } from '@/components/shared/Checkbox'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { ScanProgress } from '@/components/shared/ScanProgress'
import { StickyActionBar } from '@/components/shared/StickyActionBar'
import { useIpcAction } from '@/hooks/useIpcAction'
import { useIpcScan } from '@/hooks/useIpcScan'
import { useProgressListener } from '@/hooks/useProgressListener'
import { useDebloaterStore } from '@/stores/debloater-store'
import { useHistoryStore } from '@/stores/history-store'
import { useStatsStore } from '@/stores/stats-store'

type FilterType = 'all' | BloatwareApp['category']

const categoryColors: Record<BloatwareApp['category'], { bg: string; text: string; labelKey: string }> = {
  microsoft: { bg: 'rgba(59,130,246,0.1)', text: '#3b82f6', labelKey: 'debloater.categoryMicrosoft' },
  oem: { bg: 'rgba(239,68,68,0.1)', text: '#ef4444', labelKey: 'debloater.categoryOem' },
  gaming: { bg: 'rgba(168,85,247,0.1)', text: '#a855f7', labelKey: 'debloater.categoryGaming' },
  media: { bg: 'rgba(236,72,153,0.1)', text: '#ec4899', labelKey: 'debloater.categoryMedia' },
  communication: { bg: 'rgba(20,184,166,0.1)', text: '#14b8a6', labelKey: 'debloater.categoryCommunication' },
  utility: { bg: 'rgba(245,158,11,0.1)', text: '#f59e0b', labelKey: 'debloater.categoryUtility' },
}

export function DebloaterPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('hardening')
  const apps = useDebloaterStore((s) => s.apps)
  const scanning = useDebloaterStore((s) => s.scanning)
  const filter = useDebloaterStore((s) => s.filter)
  const removing = useDebloaterStore((s) => s.removing)
  const removeProgress = useDebloaterStore((s) => s.removeProgress)
  const removeResult = useDebloaterStore((s) => s.removeResult)
  const error = useDebloaterStore((s) => s.error)
  const store = useDebloaterStore

  const [showConfirm, setShowConfirm] = useState(false)
  const removeStartRef = useRef<number>(0)
  const addEntry = useHistoryStore((s) => s.addEntry)
  const recomputeStats = useStatsStore((s) => s.recompute)

  useProgressListener(window.dinho.onDebloaterRemoveProgress, (data) => store.getState().setRemoveProgress(data))

  const { scan: handleScan } = useIpcScan({
    scanFn: () => window.dinho.debloaterScan(),
    setLoading: (v) => store.getState().setScanning(v),
    resetState: () => {
      store.getState().setApps([])
      store.getState().setRemoveResult(null)
      store.getState().setError(null)
    },
    onResult: (results) => {
      store.getState().setApps(results)
      store.getState().setHasScanned(true)
    },
    errorKey: 'debloater',
    t,
  })

  // Auto-scan on first visit
  const autoScannedRef = useRef(false)
  if (!autoScannedRef.current && !store.getState().hasScanned && !store.getState().scanning) {
    autoScannedRef.current = true
    queueMicrotask(() => {
      handleScan()
    })
  }

  const { execute: handleRemove } = useIpcAction({
    actionFn: async () => {
      removeStartRef.current = Date.now()
      const currentApps = store.getState().apps
      const selectedApps = currentApps.filter((a) => a.selected)
      const selectedPkgs = selectedApps.map((a) => a.packageName)
      return { result: await window.dinho.debloaterRemove(selectedPkgs), currentApps, selectedApps }
    },
    setLoading: (v) => store.getState().setRemoving(v),
    onStart: () => {
      setShowConfirm(false)
      store.getState().setRemoveResult(null)
      store.getState().setRemoveProgress(null)
    },
    onResult: ({ result, currentApps, selectedApps }) => {
      store.getState().setRemoveResult(result)

      const byCategory: Record<string, { found: number; removed: number }> = {}
      for (const a of selectedApps) {
        const label = t(categoryColors[a.category]?.labelKey) || a.category
        if (!byCategory[label]) byCategory[label] = { found: 0, removed: 0 }
        byCategory[label].found++
      }
      const totalSelected = selectedApps.length
      for (const c in byCategory) {
        const cat = byCategory[c]
        if (cat) cat.removed = Math.round((cat.found / totalSelected) * result.removed)
      }

      addEntry({
        id: Date.now().toString(),
        type: 'debloater',
        timestamp: new Date().toISOString(),
        duration: Date.now() - removeStartRef.current,
        totalItemsFound: currentApps.length,
        totalItemsCleaned: result.removed,
        totalItemsSkipped: result.failed,
        totalSpaceSaved: 0,
        categories: Object.entries(byCategory).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.removed,
          spaceSaved: 0,
        })),
        errorCount: result.failed,
      })
      recomputeStats()

      if (result.removed > 0) {
        window.dinho
          .debloaterScan()
          .then((results) => {
            store.getState().setApps(results)
          })
          .catch(() => {
            store.getState().setError(t('debloater.scanFailedError'))
          })
      }
    },
    onError: () => {
      store.getState().setError(t('debloater.removeFailedError'))
    },
    errorKey: 'debloater',
    t,
  })

  const filtered = filter === 'all' ? apps : apps.filter((a) => a.category === filter)
  const selectedCount = apps.filter((a) => a.selected).length

  const filters: { labelKey: string; value: FilterType }[] = [
    { labelKey: 'debloater.filterAll', value: 'all' },
    { labelKey: 'debloater.filterMicrosoft', value: 'microsoft' },
    { labelKey: 'debloater.filterOem', value: 'oem' },
    { labelKey: 'debloater.filterGaming', value: 'gaming' },
    { labelKey: 'debloater.filterMedia', value: 'media' },
    { labelKey: 'debloater.filterCommunication', value: 'communication' },
    { labelKey: 'debloater.filterUtility', value: 'utility' },
  ]

  const headerAction = (
    <div className="flex items-center gap-2.5">
      <button
        type="button"
        onClick={handleScan}
        disabled={scanning || removing}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-medium text-zinc-300 transition-all disabled:opacity-40"
        style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
      >
        <Search className="h-4 w-4" strokeWidth={1.8} /> {t('debloater.scanButton')}
      </button>
      <button
        type="button"
        onClick={() => setShowConfirm(true)}
        disabled={selectedCount === 0 || scanning || removing}
        className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
        style={{ background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)', color: '#fff' }}
      >
        {removing ? (
          <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
        ) : (
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        )}
        {removing ? t('debloater.removingButton') : t('debloater.removeButton', { count: selectedCount })}
      </button>
    </div>
  )

  return (
    <div className={embedded ? '' : 'animate-fade-in'}>
      {!embedded && (
        <PageHeader
          title={t('debloater.pageTitle')}
          description={t('debloater.pageDescription')}
          action={headerAction}
        />
      )}
      {embedded && <div className="mb-5 flex justify-end">{headerAction}</div>}

      {/* Warning */}
      <div
        className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
        style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.08)' }}
      >
        <Shield className="h-5 w-5 shrink-0 text-red-500" strokeWidth={1.8} />
        <p className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
          {t('debloater.irreversibleWarning')}
        </p>
      </div>

      {error && <ErrorAlert message={error} onDismiss={() => store.getState().setError(null)} className="mb-5" />}

      {scanning && (
        <ScanProgress status="scanning" progress={0} currentPath={t('debloater.scanningPackages')} className="mb-5" />
      )}

      {removing && removeProgress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.08)' }}
        >
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-red-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {t('debloater.removingProgress', { current: removeProgress.current, total: removeProgress.total })}
              </span>
            </div>
            <span className="text-[12px] font-mono" style={{ color: 'var(--text-secondary)' }}>
              {Math.round((removeProgress.current / removeProgress.total) * 100)}%
            </span>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${(removeProgress.current / removeProgress.total) * 100}%`,
                background: 'linear-gradient(90deg, #ef4444 0%, #f87171 100%)',
              }}
            />
          </div>
          <p className="mt-2 text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
            {apps.find((a) => a.packageName === removeProgress.currentApp)?.name || removeProgress.currentApp}
          </p>
        </div>
      )}

      {removeResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.1)' }}
        >
          <CircleCheckBig className="h-5 w-5 text-green-500" strokeWidth={1.8} />
          <p className="text-[13px] text-zinc-200">
            {t(removeResult.removed !== 1 ? 'debloater.removedAppsPlural' : 'debloater.removedApps', {
              count: removeResult.removed,
            })}
            {removeResult.failed > 0 && (
              <span className="text-red-400"> {t('debloater.failedCount', { count: removeResult.failed })}</span>
            )}
          </p>
        </div>
      )}

      {/* Filter pills */}
      {apps.length > 0 && (
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          {filters.map((f) => {
            const count = f.value === 'all' ? apps.length : apps.filter((a) => a.category === f.value).length
            if (count === 0 && f.value !== 'all') return null
            return (
              <button
                type="button"
                key={f.value}
                onClick={() => store.getState().setFilter(f.value)}
                className="rounded-full px-3.5 py-1.5 text-[12px] font-medium transition-colors"
                style={{
                  background: filter === f.value ? 'rgba(245,158,11,0.1)' : 'var(--bg-subtle-2)',
                  color: filter === f.value ? 'var(--accent)' : 'var(--text-muted)',
                }}
              >
                {t(f.labelKey)} ({count})
              </button>
            )
          })}

          {/* Quick select buttons */}
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => store.getState().selectAll()}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
            >
              {t('debloater.selectAll')}
            </button>
            <button
              type="button"
              onClick={() => store.getState().deselectAll()}
              className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
            >
              {t('debloater.deselectAll')}
            </button>
          </div>
        </div>
      )}

      {apps.length === 0 && !scanning && (
        <EmptyState
          icon={PackageMinus}
          title={t('debloater.emptyStateTitle')}
          description={t('debloater.emptyStateDescription')}
        />
      )}

      {/* App grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-2.5">
          {/* Header with master checkbox */}
          <div
            className="flex items-center gap-4 px-5 py-2.5 text-[11px] font-medium uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            <Checkbox
              checked={filtered.every((a) => a.selected)}
              onChange={() => {
                const allSelected = filtered.every((a) => a.selected)
                store.getState().selectFiltered(filter, !allSelected)
              }}
            />
            <span>
              {t(filtered.length !== 1 ? 'debloater.appsFoundPlural' : 'debloater.appsFound', {
                count: filtered.length,
              })}
            </span>
          </div>

          {filtered.map((app) => (
            <div
              key={app.id}
              className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
              style={{
                background: app.selected ? 'rgba(239,68,68,0.04)' : 'var(--bg-subtle)',
                border: `1px solid ${app.selected ? 'rgba(239,68,68,0.1)' : 'var(--border-subtle)'}`,
              }}
            >
              {/* Checkbox */}
              <Checkbox checked={app.selected} onChange={() => store.getState().toggleApp(app.id)} />

              {/* Icon */}
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                style={{ background: categoryColors[app.category].bg }}
              >
                <Package className="h-5 w-5" style={{ color: categoryColors[app.category].text }} strokeWidth={1.8} />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5">
                  <span className="text-[13px] font-medium text-zinc-200">{app.name}</span>
                  <span
                    className="rounded-md px-2 py-0.5 text-[10px] font-medium"
                    style={{ background: categoryColors[app.category].bg, color: categoryColors[app.category].text }}
                  >
                    {t(categoryColors[app.category].labelKey)}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px]" style={{ color: 'var(--text-secondary)' }}>
                  {app.description}
                </p>
              </div>

              {/* Publisher */}
              <div className="shrink-0 text-right">
                <span className="text-[11px] text-zinc-500">{app.publisher}</span>
                <div className="mt-0.5 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  {app.size}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <StickyActionBar
        selectedCount={selectedCount}
        totalLabel={t('itemsSelected')}
        onAction={() => setShowConfirm(true)}
        actionLabel={removing ? t('debloater.removingButton') : t('debloater.removeButton', { count: selectedCount })}
        actionIcon={Trash2}
      />

      <ConfirmDialog
        open={showConfirm}
        onConfirm={handleRemove}
        onCancel={() => setShowConfirm(false)}
        title={t('debloater.confirmTitle')}
        description={t('debloater.confirmDescription', { count: selectedCount })}
        confirmLabel={t('debloater.confirmLabel')}
        variant="danger"
      />
    </div>
  )
}
