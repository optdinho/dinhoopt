import {
  Check,
  CircleCheckBig,
  CircleX,
  Download,
  Loader2,
  Package,
  RefreshCw,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { StatCard } from '@/components/shared/StatCard'
import logger from '@/lib/renderer-logger'
import { useAppInstallerStore } from '@/stores/app-installer-store'
import { useHistoryStore } from '@/stores/history-store'

const CATEGORY_KEYS = [
  'development',
  'browser',
  'media',
  'productivity',
  'communication',
  'system',
  'gaming',
  'utilities',
] as const

export function AppInstallerPage() {
  const { t } = useTranslation('installer')
  const {
    apps,
    loading,
    installing,
    progress,
    installResult,
    error,
    hasLoaded,
    wingetAvailable,
    searchQuery,
    categoryFilter,
    showOnlySelected,
    selectedIds,
  } = useAppInstallerStore(
    useShallow((s) => ({
      apps: s.apps,
      loading: s.loading,
      installing: s.installing,
      progress: s.progress,
      installResult: s.installResult,
      error: s.error,
      hasLoaded: s.hasLoaded,
      wingetAvailable: s.wingetAvailable,
      searchQuery: s.searchQuery,
      categoryFilter: s.categoryFilter,
      showOnlySelected: s.showOnlySelected,
      selectedIds: s.selectedIds,
    })),
  )

  const handleLoad = useCallback(() => {
    const store = useAppInstallerStore.getState()
    store.setLoading(true)
    store.setError(null)
    store.setInstallResult(null)

    window.dinho
      .appInstallerListAvailable()
      .then((result) => {
        const s = useAppInstallerStore.getState()
        s.setApps(result.apps)
        s.setWingetAvailable(result.wingetAvailable)
        s.setHasLoaded(true)
      })
      .catch((err) => {
        logger.error('AppInstallerPage', 'List apps failed', err)
        useAppInstallerStore.getState().setError(t('listFailed'))
      })
      .finally(() => {
        useAppInstallerStore.getState().setLoading(false)
      })
  }, [t])

  useEffect(() => {
    if (!hasLoaded && !loading) handleLoad()
  }, [handleLoad, hasLoaded, loading])

  useEffect(() => {
    const unsubscribe = window.dinho.onAppInstallerProgress((p) => {
      useAppInstallerStore.getState().setProgress(p)
      if (p.status === 'failed') {
        toast.error(p.error ? `${p.currentApp}: ${p.error}` : t('toastInstallFailed'))
      }
    })
    return unsubscribe
  }, [t])

  const handleInstall = useCallback(
    async (ids: string[]) => {
      if (ids.length === 0) return
      const store = useAppInstallerStore.getState()
      store.setInstalling(true)
      store.setInstallResult(null)
      store.setError(null)
      store.setProgress(null)

      const startTime = Date.now()
      try {
        const result = await window.dinho.appInstallerInstall(ids)
        const s = useAppInstallerStore.getState()
        s.setInstallResult(result)
        s.setProgress(null)

        if (result.succeeded > 0) {
          toast.success(
            result.succeeded !== 1
              ? t('toastInstallSuccessPlural', { count: result.succeeded })
              : t('toastInstallSuccess', { count: result.succeeded }),
          )
        }
        if (result.failed > 0) {
          toast.error(
            result.failed !== 1
              ? t('toastInstallFailedPlural', { count: result.failed })
              : t('toastInstallFailed', { count: result.failed }),
          )
        }

        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'software-update',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: ids.length,
          totalItemsCleaned: result.succeeded,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: [],
          errorCount: result.failed,
        })

        const refreshed = await window.dinho.appInstallerListAvailable()
        s.setApps(refreshed.apps)
      } catch (err) {
        logger.error('AppInstallerPage', 'Install failed', err)
        useAppInstallerStore.getState().setError(t('installError'))
      } finally {
        useAppInstallerStore.getState().setInstalling(false)
      }
    },
    [t],
  )

  const handleCancel = useCallback(() => {
    window.dinho.appInstallerCancel().catch(() => {})
    useAppInstallerStore.getState().setInstalling(false)
    useAppInstallerStore.getState().setProgress(null)
  }, [])

  const filteredApps = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    return apps.filter((app) => {
      if (showOnlySelected && !selectedIds.has(app.id)) return false
      if (categoryFilter === 'all') {
        /* no-op */
      } else if (categoryFilter === 'not-installed' && app.isInstalled) {
        return false
      } else if (categoryFilter === 'installed' && !app.isInstalled) {
        return false
      } else if (
        categoryFilter !== 'not-installed' &&
        categoryFilter !== 'installed' &&
        app.category !== categoryFilter
      ) {
        return false
      }
      if (query && !app.name.toLowerCase().includes(query) && !app.id.toLowerCase().includes(query)) return false
      return true
    })
  }, [apps, searchQuery, categoryFilter, showOnlySelected, selectedIds])

  const installedCount = apps.filter((a) => a.isInstalled).length
  const availableCount = apps.filter((a) => !a.isInstalled).length

  const categoryFilterOptions = useMemo(() => {
    const options: Array<{ key: string; label: string }> = [
      { key: 'all', label: t('filterAll') },
      { key: 'not-installed', label: t('filterNotInstalled') },
      { key: 'installed', label: t('filterInstalled') },
    ]
    for (const cat of CATEGORY_KEYS) {
      options.push({ key: cat, label: t(`category.${cat}`) })
    }
    return options
  }, [t])

  return (
    <div className="animate-fade-in">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {/* Actions */}
      <div className="mb-5 flex flex-wrap items-center gap-2.5">
        <button
          type="button"
          onClick={handleLoad}
          disabled={loading || installing}
          className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-40"
          style={{
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
            color: 'var(--text-on-accent)',
          }}
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" strokeWidth={2} />
          ) : (
            <RefreshCw className="h-4 w-4" strokeWidth={2} />
          )}
          {loading ? t('loadingButton') : t('refreshButton')}
        </button>

        <div
          className="flex items-center gap-2 rounded-xl px-4 py-2.5"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
        >
          <Search className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => useAppInstallerStore.getState().setSearchQuery(e.target.value)}
            placeholder={t('searchPlaceholder')}
            className="bg-transparent text-[13px] text-zinc-300 placeholder-zinc-600 outline-none w-44"
          />
        </div>

        <select
          value={categoryFilter}
          onChange={(e) => useAppInstallerStore.getState().setCategoryFilter(e.target.value as typeof categoryFilter)}
          aria-label={t('filterLabel')}
          className="rounded-xl px-3 py-2.5 text-[12px] font-medium text-zinc-400 outline-none"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
        >
          {categoryFilterOptions.map((opt) => (
            <option key={opt.key} value={opt.key}>
              {opt.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => useAppInstallerStore.getState().setShowOnlySelected(!showOnlySelected)}
          className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[12px] font-medium transition-all"
          style={{
            background: showOnlySelected ? 'rgba(34,197,94,0.1)' : 'var(--bg-subtle)',
            border: showOnlySelected ? '1px solid rgba(34,197,94,0.3)' : '1px solid var(--border-medium)',
            color: showOnlySelected ? '#4ade80' : 'var(--text-muted)',
          }}
        >
          <CircleCheckBig className="h-3.5 w-3.5" strokeWidth={1.8} />
          {t('showOnlySelected')}
        </button>

        <div className="flex-1" />

        {selectedIds.size > 0 && !installing && (
          <button
            type="button"
            onClick={() => handleInstall([...selectedIds])}
            disabled={selectedIds.size === 0}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all disabled:opacity-30"
            style={{
              background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
              color: '#052e16',
            }}
          >
            <Download className="h-4 w-4" strokeWidth={2} />
            {t('installSelected', { count: selectedIds.size })}
          </button>
        )}

        {installing && (
          <button
            type="button"
            onClick={handleCancel}
            className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}
          >
            <X className="h-4 w-4" strokeWidth={2} />
            {t('cancelButton')}
          </button>
        )}
      </div>

      {/* winget not available */}
      {hasLoaded && !wingetAvailable && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl px-5 py-4"
          style={{ background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.1)' }}
        >
          <TriangleAlert className="h-5 w-5 shrink-0 text-red-400" strokeWidth={1.8} />
          <p className="text-[12px] text-zinc-400">
            <span className="font-semibold text-red-400">{t('wingetNotFound')}</span> — {t('wingetRequired')}{' '}
            <span className="text-zinc-300">{t('wingetStore')}</span>
          </p>
        </div>
      )}

      {/* Errors */}
      {error && (
        <ErrorAlert message={error} onDismiss={() => useAppInstallerStore.getState().setError(null)} className="mb-5" />
      )}

      {/* Stat cards */}
      {hasLoaded && (
        <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard icon={Package} label={t('statAvailable')} value={availableCount} variant="accent" />
          <StatCard icon={CircleCheckBig} label={t('statInstalled')} value={installedCount} variant="success" />
          <StatCard icon={Download} label={t('statSelected')} value={selectedIds.size} variant="default" />
          <StatCard icon={CircleX} label={t('statCategories')} value={CATEGORY_KEYS.length} variant="default" />
        </div>
      )}

      {/* Install progress */}
      {installing && progress && (
        <div
          className="mb-5 rounded-2xl p-4"
          style={{ background: 'rgba(245,158,11,0.04)', border: '1px solid var(--accent-muted-bg)' }}
        >
          <div className="mb-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
              <span className="text-[13px] font-medium text-zinc-200">
                {t('installingProgress', {
                  app: progress.currentApp,
                  current: progress.current,
                  total: progress.total,
                })}
              </span>
            </div>
            <span className="font-mono text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {progress.percent}%
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'var(--bg-hover-2)' }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progress.percent}%`, background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)' }}
            />
          </div>
        </div>
      )}

      {/* Result banner */}
      {installResult && (
        <div
          className="mb-5 flex items-center gap-3 rounded-2xl p-4"
          style={{
            background: installResult.failed === 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
            border: `1px solid ${installResult.failed === 0 ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)'}`,
          }}
        >
          {installResult.failed === 0 ? (
            <CircleCheckBig className="h-5 w-5 shrink-0 text-green-500" strokeWidth={1.8} />
          ) : (
            <CircleX className="h-5 w-5 shrink-0 text-red-500" strokeWidth={1.8} />
          )}
          <div className="text-[13px] text-zinc-200">
            {installResult.succeeded > 0 && (
              <span className="text-green-400">
                {installResult.succeeded !== 1
                  ? t('resultInstalledPlural', { count: installResult.succeeded })
                  : t('resultInstalled', { count: installResult.succeeded })}
              </span>
            )}
            {installResult.succeeded > 0 && installResult.failed > 0 && <span> — </span>}
            {installResult.failed > 0 && (
              <span className="text-red-400">{t('resultFailed', { count: installResult.failed })}</span>
            )}
            {installResult.errors.length > 0 && (
              <div className="mt-2">
                {installResult.errors.map((e) => (
                  <div key={e.appId} className="mt-1.5 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    {e.name}: {e.reason}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Empty state — not loaded */}
      {!hasLoaded && !loading && (
        <EmptyState
          icon={Package}
          title={t('emptyTitle')}
          description={t('emptyDescription')}
          action={
            <button
              type="button"
              onClick={handleLoad}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all"
              style={{
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                color: 'var(--text-on-accent)',
              }}
            >
              <RefreshCw className="h-4 w-4" strokeWidth={2} />
              {t('loadButton')}
            </button>
          }
        />
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 className="mb-4 h-10 w-10 animate-spin text-amber-400" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('loadingList')}</p>
        </div>
      )}

      {/* No results */}
      {hasLoaded && !loading && filteredApps.length === 0 && apps.length > 0 && (
        <div className="flex flex-col items-center justify-center py-16">
          <Search className="mb-4 h-10 w-10 text-zinc-600" strokeWidth={1.5} />
          <p className="text-[13px] text-zinc-400">{t('noAppsMatch')}</p>
        </div>
      )}

      {/* App list */}
      {hasLoaded && !loading && filteredApps.length > 0 && (
        <div className="mb-6">
          <div className="grid grid-cols-2 gap-2">
            {filteredApps.map((app) => {
              const selected = selectedIds.has(app.id)
              return (
                <div
                  key={app.id}
                  className="flex items-center gap-3 rounded-2xl p-3.5 transition-colors"
                  style={{
                    background: selected ? 'rgba(34,197,94,0.05)' : 'var(--bg-card)',
                    border: selected ? '1px solid rgba(34,197,94,0.25)' : '1px solid var(--border-medium)',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => useAppInstallerStore.getState().toggleSelected(app.id)}
                    disabled={installing}
                    aria-label={t('toggleSelect')}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md transition-all disabled:opacity-40"
                    style={{
                      background: selected ? 'var(--accent)' : 'var(--bg-hover-2)',
                      border: selected ? 'none' : '1px solid var(--border-stronger)',
                    }}
                  >
                    {selected && (
                      <Check className="h-3.5 w-3.5" style={{ color: 'var(--text-on-accent)' }} strokeWidth={3} />
                    )}
                  </button>

                  {app.icon ? (
                    <img
                      src={app.icon}
                      alt=""
                      className="h-9 w-9 shrink-0 rounded-lg object-contain"
                      style={{
                        background: 'var(--bg-hover-2)',
                        border: '1px solid var(--border-medium)',
                        padding: '2px',
                      }}
                    />
                  ) : (
                    <div
                      aria-hidden="true"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sm font-bold"
                      style={{
                        background: 'var(--bg-hover-2)',
                        color: 'var(--text-muted)',
                        border: '1px solid var(--border-medium)',
                      }}
                    >
                      {(app.name.charAt(0) || '?').toUpperCase()}
                    </div>
                  )}

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-zinc-200">{app.name}</span>
                      {app.popular && (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: 'rgba(250,204,21,0.12)', color: '#facc15' }}
                        >
                          {t('popularBadge')}
                        </span>
                      )}
                      {app.isInstalled && (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold"
                          style={{ background: 'rgba(34,197,94,0.12)', color: '#4ade80' }}
                        >
                          {t('installedBadge')}
                        </span>
                      )}
                      <span
                        className="hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium sm:inline"
                        style={{ background: 'var(--bg-hover-2)', color: 'var(--text-muted)' }}
                      >
                        {t(`category.${app.category}`)}
                      </span>
                    </div>
                    {app.description && (
                      <p className="mt-0.5 truncate text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {app.description}
                      </p>
                    )}
                    <p className="mt-0.5 font-mono text-[10px] text-zinc-600">{app.id}</p>
                  </div>

                  {!app.isInstalled && (
                    <button
                      type="button"
                      onClick={() => handleInstall([app.id])}
                      disabled={installing}
                      className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-semibold transition-all disabled:opacity-40"
                      style={{
                        background: 'rgba(34,197,94,0.12)',
                        color: '#4ade80',
                        border: '1px solid rgba(34,197,94,0.2)',
                      }}
                    >
                      <Download className="h-3 w-3" strokeWidth={2.2} />
                      {t('installButton')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
