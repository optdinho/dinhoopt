import { STOPED_SERVICES } from '@shared/stoped-services'
import { Loader2, Play, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useShallow } from 'zustand/react/shallow'
import { PageHeader } from '@/components/layout/PageHeader'
import { ServiceToggleCard } from '@/components/stoped/ServiceToggleCard'
import { useStopedStore } from '@/stores/stoped-store'

export function StopedPage() {
  const { t } = useTranslation('stoped')
  const { services, loading, changing, error, lastResult, runningCount, stoppedCount, load, setService, setAll } =
    useStopedStore(
      useShallow((s) => ({
        services: s.services,
        loading: s.loading,
        changing: s.changing,
        error: s.error,
        lastResult: s.lastResult,
        runningCount: s.runningCount,
        stoppedCount: s.stoppedCount,
        load: s.load,
        setService: s.setService,
        setAll: s.setAll,
      })),
    )

  useEffect(() => {
    void load()
  }, [load])

  const serviceMap = useMemo(() => new Map(services.map((s) => [s.id, s])), [services])

  const handleToggle = (id: string, enabled: boolean) => {
    void setService(id, enabled).then((result) => {
      if (result.success) {
        toast.success(t('toggleSuccess'))
      } else {
        toast.error(result.error ?? t('toggleError'))
      }
    })
  }

  const handleSetAll = (enabled: boolean) => {
    void setAll(enabled).then((result) => {
      if (result.success) {
        toast.success(enabled ? t('startAllSuccess') : t('stopAllSuccess'))
      } else {
        toast.error(result.error ?? t('toggleError'))
      }
    })
  }

  return (
    <div className="p-6">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading || changing}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-medium text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white disabled:opacity-40"
          >
            <RefreshCw className={`mr-1.5 inline h-3 w-3 ${loading ? 'animate-spin' : ''}`} strokeWidth={2} />
            <span data-testid="stoped-refresh">{t('refresh')}</span>
          </button>
        }
      />

      {error && (
        <div
          className="mb-4 rounded-lg border border-red-800 px-4 py-3 text-sm text-red-400"
          style={{ background: 'rgba(239,68,68,0.08)' }}
        >
          {t('errorPrefix')} {error}
        </div>
      )}

      {lastResult && (
        <div
          className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-700 px-4 py-3 text-sm"
          style={{ background: 'rgba(245,158,11,0.08)' }}
        >
          <RotateCcw className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" strokeWidth={2} />
          <div>
            <p className="font-medium text-amber-300">{t('restartRequiredTitle')}</p>
            <p className="mt-0.5 text-[13px] text-amber-200/80">{t('restartRequiredBody')}</p>
            {lastResult.changed.length > 0 && (
              <p className="mt-1 text-[12px] text-amber-200/60">
                {t('changedCount', { count: lastResult.changed.length })}: {lastResult.changed.join(', ')}
              </p>
            )}
            {lastResult.failed.length > 0 && (
              <ul className="mt-1 list-inside list-disc text-[12px] text-red-300/80">
                {lastResult.failed.map((f) => (
                  <li key={f.id}>
                    {f.id}: {f.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <div
        className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border px-4 py-3"
        style={{ background: 'var(--card-bg)', borderColor: 'var(--border-medium)' }}
      >
        <div className="flex items-center gap-4 text-sm">
          <span className="text-emerald-400">{t('runningCount', { count: runningCount })}</span>
          <span className="text-red-400">{t('stoppedCount', { count: stoppedCount })}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => handleSetAll(false)}
            disabled={loading || changing}
            className="rounded-lg border border-red-800 px-3 py-1.5 text-xs font-semibold text-red-400 transition-colors hover:bg-red-900/20 disabled:opacity-40"
          >
            {t('stopAll')}
          </button>
          <button
            type="button"
            onClick={() => handleSetAll(true)}
            disabled={loading || changing}
            className="rounded-lg border border-emerald-800 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition-colors hover:bg-emerald-900/20 disabled:opacity-40"
          >
            {t('startAll')}
          </button>
        </div>
      </div>

      {changing && (
        <div className="mb-4 flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={2} />
          {t('applying')}
        </div>
      )}

      <div className="space-y-2.5">
        {STOPED_SERVICES.map((def) => {
          const state = serviceMap.get(def.id)
          if (!state) return null
          return (
            <ServiceToggleCard
              key={def.id}
              service={state}
              label={t(def.labelKey)}
              description={t(def.descriptionKey)}
              onToggle={(enabled) => handleToggle(def.id, enabled)}
              disabled={loading}
              busy={changing}
            />
          )
        })}
      </div>

      {loading && services.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-500" strokeWidth={2} />
          <span className="ml-3 text-sm text-zinc-400">{t('loading')}</span>
        </div>
      )}

      {services.length === 0 && !loading && !error && (
        <p className="mt-6 text-center text-sm text-zinc-500">{t('noServices')}</p>
      )}

      <p className="mt-6 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        {t('footerNote')}
        <Play className="ml-1 inline h-3 w-3 align-[-1px]" strokeWidth={1.5} />
      </p>
    </div>
  )
}
