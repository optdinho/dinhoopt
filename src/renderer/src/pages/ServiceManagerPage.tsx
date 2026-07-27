import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { useIpcAction } from '@/hooks/useIpcAction'
import { useIpcScan } from '@/hooks/useIpcScan'
import { useProgressListener } from '@/hooks/useProgressListener'
import { useHistoryStore } from '@/stores/history-store'
import { useServiceStore } from '@/stores/service-store'
import type { ServiceCategory, ServiceSafety, ServiceScanProgress } from '@shared/types'
import { TriangleAlert, CircleCheckBig, Loader2, RefreshCw, Search, Server, Shield, Sparkles } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CATEGORY_LABEL_KEYS,
  FilterDropdown,
  SafetyGroup,
  StatCard,
} from './service-manager/ServiceManagerComponents'

export function ServiceManagerPage({ embedded }: { embedded?: boolean }) {
  const { t } = useTranslation('hardening')
  const services = useServiceStore((s) => s.services)
  const scanning = useServiceStore((s) => s.scanning)
  const applying = useServiceStore((s) => s.applying)
  const scanProgress = useServiceStore((s) => s.scanProgress)
  const applyResult = useServiceStore((s) => s.applyResult)
  const error = useServiceStore((s) => s.error)
  const hasScanned = useServiceStore((s) => s.hasScanned)
  const searchQuery = useServiceStore((s) => s.searchQuery)
  const safetyFilter = useServiceStore((s) => s.safetyFilter)
  const categoryFilter = useServiceStore((s) => s.categoryFilter)
  const statusFilter = useServiceStore((s) => s.statusFilter)

  const [showConfirm, setShowConfirm] = useState(false)
  const [confirmMode, setConfirmMode] = useState<'disable' | 'enable'>('disable')
  const confirmModeRef = useRef<'disable' | 'enable'>('disable')
  const isBusy = scanning || applying

  useProgressListener(window.dinho.onServiceProgress, (data: ServiceScanProgress) =>
    useServiceStore.getState().setScanProgress(data),
  )

  // ─── Scan ──────────────────────────────────────────────────
  const { scan: handleScan } = useIpcScan({
    scanFn: () => window.dinho.serviceScan(),
    setLoading: (v) => useServiceStore.getState().setScanning(v),
    resetState: () => {
      const s = useServiceStore.getState()
      s.setServices([])
      s.setApplyResult(null)
      s.setError(null)
      s.setScanProgress(null)
    },
    onResult: (result) => {
      const s = useServiceStore.getState()
      s.setServices(result.services)
      s.setHasScanned(true)
    },
    onError: (err) => {
      useServiceStore.getState().setError(err instanceof Error ? err.message : t('serviceManager.scanFailedError'))
    },
    errorKey: 'serviceManager',
    t,
  })

  // Auto-scan on first visit
  const autoScannedRef = useRef(false)
  if (!autoScannedRef.current && !hasScanned && !scanning) {
    autoScannedRef.current = true
    queueMicrotask(() => {
      handleScan()
    })
  }

  // ─── Apply ─────────────────────────────────────────────────
  const applyStartRef = useRef(0)
  const { execute: handleApply } = useIpcAction({
    actionFn: async () => {
      applyStartRef.current = Date.now()
      const store = useServiceStore.getState()
      const selected = store.services.filter((s) => s.selected)

      const mode = confirmModeRef.current
      const changes = selected.map((s) => ({
        name: s.name,
        targetStartType:
          mode === 'enable'
            ? s.originalStartType !== 'Disabled' && s.originalStartType !== 'Unknown'
              ? s.originalStartType
              : 'Manual'
            : ('Disabled' as const),
      }))
      const result = await window.dinho.serviceApply(changes)
      const scanResult = await window.dinho.serviceScan()
      return { result, changes, selected, scanResult }
    },
    setLoading: (v) => useServiceStore.getState().setApplying(v),
    onStart: () => {
      setShowConfirm(false)
      const s = useServiceStore.getState()
      s.setApplyResult(null)
      s.setError(null)
      confirmModeRef.current = confirmMode
    },
    onResult: ({ result, selected }) => {
      const s = useServiceStore.getState()
      s.setApplyResult(result)
      s.setServices(useServiceStore.getState().services)

      const byCat: Record<string, { found: number; disabled: number }> = {}
      for (const svc of selected) {
        const cat = svc.category
        if (!byCat[cat]) byCat[cat] = { found: 0, disabled: 0 }
        byCat[cat].found++
        if (!result.errors.some((e: { name: string }) => e.name === svc.name)) byCat[cat].disabled++
      }
      useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'services',
        timestamp: new Date().toISOString(),
        duration: Date.now() - applyStartRef.current,
        totalItemsFound: selected.length,
        totalItemsCleaned: result.succeeded,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: Object.entries(byCat).map(([name, d]) => ({
          name,
          itemsFound: d.found,
          itemsCleaned: d.disabled,
          spaceSaved: 0,
        })),
        errorCount: result.failed,
      })
    },
    onError: (err) => {
      useServiceStore.getState().setError(err instanceof Error ? err.message : t('serviceManager.applyFailedError'))
    },
    errorKey: 'serviceManager',
    t,
  })

  const handleSelectRecommended = useCallback(() => {
    useServiceStore.getState().selectRecommended()
  }, [])

  // ─── Filtering ─────────────────────────────────────────────
  const filteredServices = useMemo(() => {
    let result = services

    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.displayName.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q),
      )
    }

    if (safetyFilter !== 'all') {
      result = result.filter((s) => s.safety === safetyFilter)
    }

    if (categoryFilter !== 'all') {
      result = result.filter((s) => s.category === categoryFilter)
    }

    if (statusFilter !== 'all') {
      if (statusFilter === 'running') result = result.filter((s) => s.status === 'Running')
      else if (statusFilter === 'stopped') result = result.filter((s) => s.status === 'Stopped')
      else if (statusFilter === 'disabled') result = result.filter((s) => s.startType === 'Disabled')
    }

    return result
  }, [services, searchQuery, safetyFilter, categoryFilter, statusFilter])

  const selectedActiveCount = services.filter((s) => s.selected && s.startType !== 'Disabled').length
  const selectedDisabledCount = services.filter((s) => s.selected && s.startType === 'Disabled').length
  const totalSafeToDisable = services.filter((s) => s.safety === 'safe' && s.startType !== 'Disabled').length
  const runningCount = services.filter((s) => s.status === 'Running').length
  const disabledCount = services.filter((s) => s.startType === 'Disabled').length

  // ─── Categories present in scan results ────────────────────
  const presentCategories = useMemo(() => {
    const cats = new Set<ServiceCategory>()
    for (const s of services) cats.add(s.category)
    return cats
  }, [services])

  // ─── Group by safety level ────────────────────────────────
  const safetyGroups = useMemo(() => {
    const groups: { key: 'safe' | 'caution' | 'unsafe'; label: string; services: typeof filteredServices }[] = [
      {
        key: 'safe',
        label: t('serviceManager.safeToDisableGroup'),
        services: filteredServices.filter((s) => s.safety === 'safe'),
      },
      {
        key: 'caution',
        label: t('serviceManager.useCautionGroup'),
        services: filteredServices.filter((s) => s.safety === 'caution'),
      },
      {
        key: 'unsafe',
        label: t('serviceManager.systemCriticalGroup'),
        services: filteredServices.filter((s) => s.safety === 'unsafe'),
      },
    ]
    return groups.filter((g) => g.services.length > 0)
  }, [filteredServices, t])

  return (
    <div className={embedded ? '' : 'mx-auto max-w-5xl px-8 py-8'}>
      {!embedded && (
        <PageHeader title={t('serviceManager.pageTitle')} description={t('serviceManager.pageDescription')} />
      )}

      {/* ── Action bar ───────────────────────────────────────── */}
      <div className="mb-5 flex items-center gap-3">
        <button
          type="button"
          onClick={handleScan}
          disabled={isBusy}
          className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
          style={{
            background: isBusy ? '#27272a' : 'var(--accent)',
            opacity: isBusy ? 0.5 : 1,
          }}
        >
          {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" strokeWidth={2} />}
          {scanning ? t('serviceManager.scanningButton') : t('serviceManager.scanServicesButton')}
        </button>

        {hasScanned && (
          <>
            <button
              type="button"
              onClick={handleSelectRecommended}
              disabled={isBusy || totalSafeToDisable === 0}
              className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-all"
              style={{
                background: 'rgba(34,197,94,0.10)',
                color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.20)',
                opacity: isBusy || totalSafeToDisable === 0 ? 0.5 : 1,
              }}
            >
              <Sparkles className="h-4 w-4" strokeWidth={2} />
              {t('serviceManager.applyRecommendedButton', { count: totalSafeToDisable })}
            </button>

            {selectedActiveCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setConfirmMode('disable')
                  setShowConfirm(true)
                }}
                disabled={isBusy}
                className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
                style={{
                  background: !isBusy ? '#dc2626' : '#27272a',
                  opacity: isBusy ? 0.5 : 1,
                }}
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Shield className="h-4 w-4" strokeWidth={2} />
                )}
                {applying
                  ? t('serviceManager.applyingButton')
                  : t('serviceManager.disableSelectedButton', { count: selectedActiveCount })}
              </button>
            )}
            {selectedDisabledCount > 0 && (
              <button
                type="button"
                onClick={() => {
                  setConfirmMode('enable')
                  setShowConfirm(true)
                }}
                disabled={isBusy}
                className="flex items-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-semibold text-white transition-all"
                style={{
                  background: !isBusy ? '#22c55e' : '#27272a',
                  opacity: isBusy ? 0.5 : 1,
                }}
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" strokeWidth={2} />
                )}
                {applying
                  ? t('serviceManager.applyingButton')
                  : t('serviceManager.enableSelectedButton', { count: selectedDisabledCount })}
              </button>
            )}
          </>
        )}
      </div>

      {/* ── Info banner ──────────────────────────────────────── */}
      {hasScanned && !applyResult && (
        <div
          className="mb-5 flex items-start gap-3 rounded-xl px-4 py-3"
          style={{ background: 'var(--accent-muted-bg)', border: '1px solid rgba(245,158,11,0.12)' }}
        >
          <Shield className="mt-0.5 h-4 w-4 shrink-0" style={{ color: '#f59e0b' }} strokeWidth={2} />
          <div className="text-[12.5px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            <span className="font-medium" style={{ color: '#22c55e' }}>
              {t('serviceManager.infoBannerGreen')}
            </span>{' '}
            {t('serviceManager.infoBannerSafeToDisable')}{' '}
            <span className="font-medium" style={{ color: '#f59e0b' }}>
              {t('serviceManager.infoBannerAmber')}
            </span>{' '}
            {t('serviceManager.infoBannerMayAffect')}{' '}
            <span className="font-medium" style={{ color: '#ef4444' }}>
              {t('serviceManager.infoBannerRed')}
            </span>{' '}
            {t('serviceManager.infoBannerSystemCritical')} {t('serviceManager.infoBannerUseRecommended')}
          </div>
        </div>
      )}

      {/* ── Error ────────────────────────────────────────────── */}
      {error && (
        <ErrorAlert message={error} onDismiss={() => useServiceStore.getState().setError(null)} className="mb-5" />
      )}

      {/* ── Scan progress ────────────────────────────────────── */}
      {scanning && scanProgress && (
        <div
          className="mb-5 rounded-xl p-4"
          style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-medium" style={{ color: 'var(--text-secondary)' }}>
              {scanProgress.phase === 'enumerating'
                ? t('serviceManager.scanProgressEnumerating')
                : t('serviceManager.scanProgressClassifying')}
            </span>
            {scanProgress.total > 0 && (
              <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {scanProgress.current} / {scanProgress.total}
              </span>
            )}
          </div>
          {scanProgress.total > 0 && (
            <div className="h-1.5 overflow-hidden rounded-full" style={{ background: '#27272a' }}>
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  background: 'var(--accent)',
                  width: `${Math.round((scanProgress.current / scanProgress.total) * 100)}%`,
                }}
              />
            </div>
          )}
          <div className="mt-1.5 truncate text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {scanProgress.currentService}
          </div>
        </div>
      )}

      {/* ── Apply result ─────────────────────────────────────── */}
      {applyResult && (
        <div
          className="mb-5 rounded-xl p-4"
          style={{
            background: applyResult.failed > 0 ? 'rgba(245,158,11,0.06)' : 'rgba(34,197,94,0.06)',
            border: `1px solid ${applyResult.failed > 0 ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)'}`,
          }}
        >
          <div className="flex items-center gap-2">
            {applyResult.failed > 0 ? (
              <TriangleAlert className="h-4 w-4" style={{ color: '#f59e0b' }} />
            ) : (
              <CircleCheckBig className="h-4 w-4" style={{ color: '#22c55e' }} />
            )}
            <span className="text-[13px] font-medium text-white">
              {t(
                applyResult.succeeded !== 1
                  ? 'serviceManager.servicesDisabledPlural'
                  : 'serviceManager.servicesDisabled',
                { count: applyResult.succeeded },
              )}
              {applyResult.failed > 0 && `, ${t('serviceManager.servicesFailed', { count: applyResult.failed })}`}
            </span>
          </div>
          {applyResult.errors.length > 0 && (
            <div className="mt-2 space-y-1">
              {applyResult.errors.map((e, i) => (
                <div
                  key={`${e.name || e.displayName}-${i}`}
                  className="text-[11.5px]"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {e.displayName || e.name}: {e.reason}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Empty state ──────────────────────────────────────── */}
      {!hasScanned && !scanning && (
        <EmptyState
          icon={Server}
          title={t('serviceManager.emptyStateTitle')}
          description={t('serviceManager.emptyStateDescription')}
          action={
            <button
              type="button"
              onClick={handleScan}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={1.8} />
              {t('serviceManager.scanServicesButton')}
            </button>
          }
        />
      )}

      {/* ── Stats row ────────────────────────────────────────── */}
      {hasScanned && !scanning && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={t('serviceManager.statTotal')} value={services.length} color="#a1a1aa" />
            <StatCard label={t('serviceManager.statRunning')} value={runningCount} color="#22c55e" />
            <StatCard label={t('serviceManager.statDisabled')} value={disabledCount} color="var(--text-muted)" />
            <StatCard label={t('serviceManager.statSafeToDisable')} value={totalSafeToDisable} color="#f59e0b" />
          </div>

          {/* ── Filter bar ─────────────────────────────────────── */}
          <div className="mb-4 flex items-center gap-3">
            <div
              className="flex flex-1 items-center gap-2 rounded-lg px-3 py-2"
              style={{ background: 'var(--card-bg)', border: '1px solid var(--border-medium)' }}
            >
              <Search className="h-4 w-4 shrink-0" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
              <input
                type="text"
                placeholder={t('serviceManager.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => useServiceStore.getState().setSearchQuery(e.target.value)}
                className="w-full bg-transparent text-[13px] text-white placeholder-zinc-600 outline-none"
              />
            </div>

            <FilterDropdown
              value={safetyFilter}
              options={[
                { value: 'all', label: t('serviceManager.filterAllSafety') },
                { value: 'safe', label: t('serviceManager.filterSafe') },
                { value: 'caution', label: t('serviceManager.filterCaution') },
                { value: 'unsafe', label: t('serviceManager.filterUnsafe') },
              ]}
              onChange={(v) => useServiceStore.getState().setSafetyFilter(v as 'all' | ServiceSafety)}
            />

            <FilterDropdown
              value={categoryFilter}
              options={[
                { value: 'all', label: t('serviceManager.filterAllCategories') },
                ...Array.from(presentCategories)
                  .sort()
                  .map((c) => ({ value: c, label: t(CATEGORY_LABEL_KEYS[c]) || c })),
              ]}
              onChange={(v) => useServiceStore.getState().setCategoryFilter(v as 'all' | ServiceCategory)}
            />

            <FilterDropdown
              value={statusFilter}
              options={[
                { value: 'all', label: t('serviceManager.filterAllStatus') },
                { value: 'running', label: t('serviceManager.filterRunning') },
                { value: 'stopped', label: t('serviceManager.filterStopped') },
                { value: 'disabled', label: t('serviceManager.filterDisabled') },
              ]}
              onChange={(v) =>
                useServiceStore.getState().setStatusFilter(v as 'all' | 'running' | 'stopped' | 'disabled')
              }
            />
          </div>

          {/* ── Service list (grouped by safety) ────────────────── */}
          {filteredServices.length === 0 ? (
            <div
              className="rounded-xl py-12 text-center text-[13px]"
              style={{
                background: 'var(--card-bg)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-muted)',
              }}
            >
              {t('serviceManager.noServicesMatch')}
            </div>
          ) : (
            <div className="space-y-3">
              {safetyGroups.map((group) => (
                <SafetyGroup key={group.key} safetyKey={group.key} label={group.label} services={group.services} />
              ))}
            </div>
          )}

          <div className="mt-2 text-right text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
            {t('serviceManager.showingCount', { filtered: filteredServices.length, total: services.length })}
          </div>
        </>
      )}

      {/* ── Confirm dialog ───────────────────────────────────── */}
      <ConfirmDialog
        open={showConfirm}
        title={confirmMode === 'disable' ? t('serviceManager.confirmTitle') : t('serviceManager.confirmEnableTitle')}
        description={
          confirmMode === 'disable'
            ? t('serviceManager.confirmDescription', { count: selectedActiveCount })
            : t('serviceManager.confirmEnableDescription', { count: selectedDisabledCount })
        }
        confirmLabel={
          confirmMode === 'disable' ? t('serviceManager.confirmLabel') : t('serviceManager.confirmEnableLabel')
        }
        variant={confirmMode === 'disable' ? 'danger' : 'default'}
        onConfirm={handleApply}
        onCancel={() => setShowConfirm(false)}
      />
    </div>
  )
}
