import type { StartupItem } from '@shared/types'
import { CalendarClock, RefreshCw, Shield, Trash2, Zap } from 'lucide-react'
import { Fragment, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import logger from '@/lib/renderer-logger'
import { cn } from '@/lib/utils'
import { useHistoryStore } from '@/stores/history-store'
import { useStartupStore } from '@/stores/startup-store'
import {
  BootTracePanel,
  impactStyles,
  SafetyTooltip,
  safetyIcon,
  safetyScoreColor,
  sourceKeys,
} from './startup/StartupComponents'

export function StartupPage() {
  const { t } = useTranslation('startup')
  const navigate = useNavigate()
  const items = useStartupStore((s) => s.items)
  const loading = useStartupStore((s) => s.loading)
  const sortBy = useStartupStore((s) => s.sortBy)
  const filterBy = useStartupStore((s) => s.filterBy)
  const error = useStartupStore((s) => s.error)
  const bootTrace = useStartupStore((s) => s.bootTrace)
  const traceLoading = useStartupStore((s) => s.traceLoading)
  const deleteTarget = useStartupStore((s) => s.deleteTarget)
  const safetyRatings = useStartupStore((s) => s.safetyRatings)
  const safetyLoading = useStartupStore((s) => s.safetyLoading)
  const safetyFetched = useStartupStore((s) => s.safetyFetched)
  const expandedItemId = useStartupStore((s) => s.expandedItemId)

  const isCloudLinked = false

  const store = useStartupStore

  const loadItems = useCallback(async () => {
    store.getState().setLoading(true)
    store.getState().setError(null)
    try {
      const list = await window.dinho.startupList()
      store.getState().setItems(list)
    } catch (err) {
      logger.error('StartupPage', 'Failed to load startup items', err)
      store.getState().setError(t('errorFailedToLoad'))
    }
    store.getState().setLoading(false)
  }, [t])

  const loadBootTrace = useCallback(async () => {
    store.getState().setTraceLoading(true)
    try {
      const trace = await window.dinho.startupBootTrace()
      store.getState().setBootTrace(trace)
    } catch (err) {
      logger.error('StartupPage', 'Failed to load boot trace', err)
    }
    store.getState().setTraceLoading(false)
  }, [])

  useEffect(() => {
    const tasks: Promise<void>[] = []
    if (items.length === 0) {
      tasks.push(loadItems())
    }
    if (!bootTrace) {
      tasks.push(loadBootTrace())
    }
    if (tasks.length > 0) Promise.all(tasks)
  }, [loadItems, loadBootTrace, items, bootTrace])

  useEffect(() => {
    if (!safetyFetched) {
      store.getState().fetchSafetyRatings()
    }
  }, [safetyFetched])

  const handleToggle = async (item: StartupItem, enabled: boolean) => {
    const startTime = Date.now()
    store.getState().updateItem(item.id, { enabled })
    try {
      const success = await window.dinho.startupToggle(item.name, item.location, item.command, item.source, enabled)
      if (!success) {
        store.getState().updateItem(item.id, { enabled: !enabled })
        toast.error(
          enabled
            ? t('toastFailedToEnable', { name: item.displayName })
            : t('toastFailedToDisable', { name: item.displayName }),
          { description: t('toastAdminRequired') },
        )
        store
          .getState()
          .setError(t('errorFailedToToggle', { action: enabled ? 'enable' : 'disable', name: item.displayName }))
        return
      }
      await useHistoryStore.getState().addEntry({
        id: Date.now().toString(),
        type: 'startup',
        timestamp: new Date().toISOString(),
        duration: Date.now() - startTime,
        totalItemsFound: 1,
        totalItemsCleaned: 1,
        totalItemsSkipped: 0,
        totalSpaceSaved: 0,
        categories: [
          {
            name: enabled ? t('historyCategoryEnabled') : t('historyCategoryDisabled'),
            itemsFound: 1,
            itemsCleaned: 1,
            spaceSaved: 0,
          },
        ],
        errorCount: 0,
      })
      store.getState().fetchSafetyRatings()
    } catch {
      store.getState().updateItem(item.id, { enabled: !enabled })
      toast.error(
        enabled
          ? t('toastFailedToEnable', { name: item.displayName })
          : t('toastFailedToDisable', { name: item.displayName }),
        { description: t('toastAdminRequired') },
      )
      store
        .getState()
        .setError(t('errorFailedToToggle', { action: enabled ? 'enable' : 'disable', name: item.displayName }))
    }
  }

  const handleDelete = async (item: StartupItem) => {
    const startTime = Date.now()
    try {
      const success = await window.dinho.startupDelete(
        item.name,
        item.source === 'startup-folder' ? item.command : item.location,
        item.source,
      )
      if (success) {
        store.getState().removeItem(item.id)
        await useHistoryStore.getState().addEntry({
          id: Date.now().toString(),
          type: 'startup',
          timestamp: new Date().toISOString(),
          duration: Date.now() - startTime,
          totalItemsFound: 1,
          totalItemsCleaned: 1,
          totalItemsSkipped: 0,
          totalSpaceSaved: 0,
          categories: [{ name: t('historyCategoryRemoved'), itemsFound: 1, itemsCleaned: 1, spaceSaved: 0 }],
          errorCount: 0,
        })
      } else {
        toast.error(t('toastFailedToRemove', { name: item.displayName }), { description: t('toastAdminRequired') })
        store.getState().setError(t('errorFailedToRemove', { name: item.displayName }))
      }
    } catch {
      toast.error(t('toastFailedToRemove', { name: item.displayName }), { description: t('toastAdminRequired') })
      store.getState().setError(t('errorFailedToRemove', { name: item.displayName }))
    }
    store.getState().setDeleteTarget(null)
  }

  const handleRefresh = () => {
    loadItems()
    loadBootTrace()
    store.getState().setExpandedItemId(null)
    if (isCloudLinked) store.getState().fetchSafetyRatings()
  }

  const impactOrder: Record<string, number> = { high: 0, medium: 1, low: 2, none: 3 }
  const filtered = items.filter((i) => (filterBy === 'all' ? true : filterBy === 'active' ? i.enabled : !i.enabled))
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === 'impact') return (impactOrder[a.impact] ?? 0) - (impactOrder[b.impact] ?? 0)
    if (sortBy === 'safety') {
      const sa = safetyRatings[a.name]?.safetyScore ?? 11
      const sb = safetyRatings[b.name]?.safetyScore ?? 11
      return sa - sb
    }
    return a.displayName.localeCompare(b.displayName)
  })

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <div className="flex items-center gap-2.5">
            <select
              value={filterBy}
              onChange={(e) => store.getState().setFilterBy(e.target.value as 'all' | 'active' | 'disabled')}
              className="rounded-xl px-4 py-2.5 text-[13px] text-zinc-400 outline-none"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            >
              <option value="all">{t('filterAll')}</option>
              <option value="active">{t('filterActive')}</option>
              <option value="disabled">{t('filterDisabled')}</option>
            </select>
            <select
              value={sortBy}
              onChange={(e) => store.getState().setSortBy(e.target.value as 'name' | 'impact' | 'safety')}
              className="rounded-xl px-4 py-2.5 text-[13px] text-zinc-400 outline-none"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            >
              <option value="impact">{t('sortByImpact')}</option>
              <option value="name">{t('sortByName')}</option>
              <option value="safety">{t('sortBySafety')}</option>
            </select>
            <button
              type="button"
              onClick={handleRefresh}
              disabled={loading}
              className="flex items-center justify-center rounded-xl p-2.5 text-zinc-500 transition-colors"
              style={{ background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }}
            >
              <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} strokeWidth={1.8} />
            </button>
            <button
              type="button"
              onClick={() => navigate('/schedules')}
              className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-medium text-zinc-300 transition-all"
              style={{ background: 'var(--bg-hover)', border: '1px solid var(--border-medium)' }}
            >
              <CalendarClock className="h-4 w-4" strokeWidth={1.8} />
              {t('schedulesLink')}
            </button>
          </div>
        }
      />

      <BootTracePanel trace={bootTrace} loading={traceLoading} />

      {error && <ErrorAlert message={error} onDismiss={() => store.getState().setError(null)} className="mb-5" />}

      {items.length === 0 && !loading && !error && (
        <EmptyState icon={Zap} title={t('emptyStateTitle')} description={t('emptyStateDescription')} />
      )}

      <div className="space-y-2.5">
        {sorted.map((item) => {
          const rating = safetyRatings[item.name]
          const isExpanded = expandedItemId === item.id

          return (
            <Fragment key={item.id}>
              <div
                className={cn(
                  'flex items-center gap-5 rounded-2xl p-5 transition-all',
                  !item.enabled && 'opacity-50',
                  isExpanded && 'rounded-b-none',
                )}
                style={{
                  background: 'var(--card-bg)',
                  border: '1px solid var(--border-default)',
                  ...(isExpanded ? { borderBottom: 'none' } : {}),
                }}
              >
                {/* Icon */}
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                  style={{ background: 'var(--bg-subtle-2)' }}
                >
                  <span className="text-[14px] font-bold" style={{ color: 'var(--text-muted)' }}>
                    {item.displayName.charAt(0)}
                  </span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-medium text-zinc-200">{item.displayName}</span>
                    {item.impact === 'none' && (
                      <Shield className="h-3.5 w-3.5" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
                    )}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                    <span>{item.publisher}</span>
                    <span style={{ color: 'var(--text-faint)' }}>·</span>
                    <span>{t(sourceKeys[item.source])}</span>
                  </div>
                  <div
                    className="mt-1 truncate font-mono text-[11px]"
                    style={{ color: 'var(--text-faint)' }}
                    title={item.command}
                  >
                    {item.command}
                  </div>
                </div>

                {/* Safety Score */}
                {rating ? (
                  (() => {
                    const colors = safetyScoreColor(rating.safetyScore)
                    const Icon = safetyIcon(rating.safetyScore)
                    const tooltipKey =
                      rating.safetyScore >= 8
                        ? 'safetyTooltipSafe'
                        : rating.safetyScore >= 5
                          ? 'safetyTooltipCaution'
                          : rating.safetyScore >= 3
                            ? 'safetyTooltipWarning'
                            : 'safetyTooltipDanger'
                    return (
                      <SafetyTooltip text={t(tooltipKey)}>
                        <button
                          type="button"
                          onClick={() => store.getState().setExpandedItemId(isExpanded ? null : item.id)}
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl cursor-pointer transition-all hover:scale-110"
                          style={{ background: colors.bg }}
                        >
                          <Icon className="h-[18px] w-[18px]" style={{ color: colors.text }} strokeWidth={1.8} />
                        </button>
                      </SafetyTooltip>
                    )
                  })()
                ) : (
                  <SafetyTooltip text={t(safetyLoading ? 'safetyTooltipPending' : 'safetyPending')}>
                    <div
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                      style={{ background: 'var(--bg-subtle-2)' }}
                    >
                      {safetyLoading ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
                      ) : (
                        <Shield
                          className="h-[18px] w-[18px]"
                          style={{ color: 'var(--text-faint)' }}
                          strokeWidth={1.8}
                        />
                      )}
                    </div>
                  </SafetyTooltip>
                )}

                {/* Impact */}
                <span
                  className="rounded-lg px-3 py-1.5 text-[11px] font-semibold capitalize shrink-0"
                  style={{ background: impactStyles[item.impact].bg, color: impactStyles[item.impact].text }}
                >
                  {t('impactLabel', { level: item.impact })}
                </span>

                {/* Toggle + Delete */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleToggle(item, !item.enabled)}
                    aria-label={item.enabled ? `Disable ${item.name}` : `Enable ${item.name}`}
                    className="relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors"
                    style={{ background: item.enabled ? 'var(--accent)' : 'var(--bg-active)' }}
                  >
                    <div
                      className={cn(
                        'absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-sm transition-transform',
                        item.enabled ? 'translate-x-[22px]' : 'translate-x-[3px]',
                      )}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => store.getState().setDeleteTarget(item)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-zinc-600 transition-colors hover:text-red-400"
                    style={{ background: 'var(--bg-subtle)' }}
                    title={t('removeButtonTitle', { name: item.displayName })}
                  >
                    <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                  </button>
                </div>
              </div>

              {/* Expanded safety detail */}
              {isExpanded &&
                rating &&
                (() => {
                  const colors = safetyScoreColor(rating.safetyScore)
                  const DetailIcon = safetyIcon(rating.safetyScore)
                  return (
                    <div
                      className="rounded-b-2xl px-5 py-4 -mt-px"
                      style={{
                        background: 'var(--bg-subtle)',
                        border: '1px solid var(--border-default)',
                        borderTop: '1px solid var(--border-subtle)',
                      }}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg mt-0.5"
                          style={{ background: colors.bg }}
                        >
                          <DetailIcon className="h-4 w-4" style={{ color: colors.text }} strokeWidth={1.8} />
                        </div>
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold tabular-nums" style={{ color: colors.text }}>
                              {rating.safetyScore}/10
                            </span>
                            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
                              {t('safetyScore', { score: rating.safetyScore })}
                            </span>
                          </div>
                          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                            {rating.description || t('safetyPending')}
                          </p>
                          {rating.analyzedAt && (
                            <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                              {t('safetyAnalyzed', { date: new Date(rating.analyzedAt).toLocaleDateString() })}
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })()}
            </Fragment>
          )
        })}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          open
          onCancel={() => store.getState().setDeleteTarget(null)}
          onConfirm={() => handleDelete(deleteTarget)}
          title={t('confirmRemoveTitle', { name: deleteTarget.displayName })}
          description={t('confirmRemoveDescription')}
          {...(deleteTarget.command && deleteTarget.command !== 'undefined' ? { details: deleteTarget.command } : {})}
          confirmLabel={t('confirmRemoveLabel')}
          variant="danger"
        />
      )}
    </div>
  )
}
