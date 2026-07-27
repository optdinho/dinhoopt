import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/shared/EmptyState'
import { ErrorAlert } from '@/components/shared/ErrorAlert'
import { HealthScore } from '@/components/shared/HealthScore'
import { formatBytes } from '@/lib/utils'
import { useMemoryStore } from '@/stores/memory-store'
import { CircleCheckBig, Cpu, Gauge, Loader2, MemoryStick, RefreshCw, Trash2, CircleX } from 'lucide-react'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'

export function MemoryOptimizerPage() {
  const { t } = useTranslation('memory')
  const info = useMemoryStore((s) => s.info)
  const processes = useMemoryStore((s) => s.processes)
  const loading = useMemoryStore((s) => s.loading)
  const optimizing = useMemoryStore((s) => s.optimizing)
  const error = useMemoryStore((s) => s.error)
  const success = useMemoryStore((s) => s.success)
  const progress = useMemoryStore((s) => s.progress)
  const result = useMemoryStore((s) => s.result)

  const loadData = useMemoryStore((s) => s.load)
  const handleOptimize = useMemoryStore((s) => s.optimize)
  const clearError = useMemoryStore((s) => s.clearError)
  useEffect(() => {
    loadData()
  }, [loadData])

  const getHealthScore = (percent: number) => {
    if (percent < 50) return 100 - percent
    if (percent < 70) return 100 - percent
    return Math.max(10, 100 - percent)
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <PageHeader title={t('pageTitle')} description={t('pageDescription')} />

      {error && <ErrorAlert message={error} onDismiss={clearError} />}

      {success && (
        <div
          className="flex items-center gap-3 rounded-xl px-5 py-3 text-sm"
          style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.2)' }}
        >
          <CircleCheckBig className="h-5 w-5 shrink-0" />
          {success}
        </div>
      )}

      {loading && !info && (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      )}

      {info && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-medium)' }}>
              <div className="mb-3 flex items-center gap-2">
                <MemoryStick className="h-5 w-5" style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-medium">{t('memoryUsage')}</span>
              </div>
              <div className="mb-3 flex items-end gap-2">
                <span className="text-3xl font-bold text-white">{info.usedPercent}%</span>
                <span className="mb-1 text-sm" style={{ color: 'var(--text-muted)' }}>
                  {formatBytes(info.usedBytes)} / {formatBytes(info.totalBytes)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle)' }}>
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${info.usedPercent}%`,
                    background: info.usedPercent > 80 ? '#ef4444' : info.usedPercent > 60 ? '#f59e0b' : '#22c55e',
                  }}
                />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                  {t('available')}:
                </span>
                <span className="text-xs font-medium text-white">{formatBytes(info.availableBytes)}</span>
              </div>
            </div>

            <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-medium)' }}>
              <div className="mb-3 flex items-center gap-2">
                <Gauge className="h-5 w-5" style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-medium">{t('healthScore')}</span>
              </div>
              <HealthScore score={getHealthScore(info.usedPercent)} size="lg" />
            </div>

            <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-medium)' }}>
              <div className="mb-3 flex items-center gap-2">
                <Cpu className="h-5 w-5" style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-medium">{t('topProcesses')}</span>
              </div>
              <div className="space-y-2">
                {processes.slice(0, 5).map((p) => (
                  <div key={p.pid} className="flex items-center justify-between">
                    <span className="text-sm truncate max-w-[180px]">{p.name}</span>
                    <span className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                      {formatBytes(p.workingSetBytes)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleOptimize}
              disabled={loading || optimizing}
              className="inline-flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition-all duration-200 hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {optimizing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {t('optimizeButton')}
            </button>
            <button
              type="button"
              onClick={loadData}
              disabled={loading || optimizing}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium transition-all hover:scale-[1.02] disabled:cursor-not-allowed disabled:opacity-50"
              style={{ background: 'var(--bg-subtle)', color: 'var(--text-primary)' }}
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              {t('refreshButton')}
            </button>
          </div>

          {progress && (
            <div className="rounded-2xl border p-5" style={{ borderColor: 'var(--border-medium)' }}>
              <div className="mb-3 flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--accent)' }} />
                <div>
                  <div className="text-sm font-medium text-white">{progress.label}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {progress.detail}
                  </div>
                </div>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${(progress.step / progress.totalSteps) * 100}%`, background: 'var(--accent)' }}
                />
              </div>
            </div>
          )}

          {result && result.steps.length > 0 && (
            <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-medium)' }}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    <th className="px-5 py-3 font-medium" style={{ color: 'var(--text-dim)' }}>
                      {t('step')}
                    </th>
                    <th className="px-5 py-3 font-medium" style={{ color: 'var(--text-dim)' }}>
                      {t('status')}
                    </th>
                    <th className="px-5 py-3 font-medium" style={{ color: 'var(--text-dim)' }}>
                      {t('freed')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.steps.map((s) => (
                    <tr key={`step-${s.name}`} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-5 py-3">{t(`step${result.steps.indexOf(s) + 1}`, s.name)}</td>
                      <td className="px-5 py-3">
                        {s.success ? (
                          <span className="flex items-center gap-1.5 text-green-500">
                            <CircleCheckBig className="h-4 w-4" />
                            {t('success')}
                          </span>
                        ) : (
                          <span className="flex items-center gap-1.5 text-red-400" title={s.error}>
                            <CircleX className="h-4 w-4" />
                            {t('failed')}
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3 font-mono" style={{ color: 'var(--text-muted)' }}>
                        {s.success ? formatBytes(s.freedBytes) : '-'}
                      </td>
                    </tr>
                  ))}
                  <tr className="border-t font-semibold" style={{ borderColor: 'var(--border-medium)' }}>
                    <td className="px-5 py-3 text-white">{t('total')}</td>
                    <td className="px-5 py-3" />
                    <td className="px-5 py-3 font-mono text-white">{formatBytes(result.freedBytes)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {!loading && processes.length > 0 && (
            <div className="overflow-hidden rounded-2xl border" style={{ borderColor: 'var(--border-medium)' }}>
              <div className="px-5 py-3 text-sm font-medium" style={{ background: 'var(--bg-subtle)' }}>
                {t('allProcesses')}
              </div>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    <th className="px-5 py-2 font-medium" style={{ color: 'var(--text-dim)' }}>
                      PID
                    </th>
                    <th className="px-5 py-2 font-medium" style={{ color: 'var(--text-dim)' }}>
                      {t('processName')}
                    </th>
                    <th className="px-5 py-2 font-medium text-right" style={{ color: 'var(--text-dim)' }}>
                      {t('memory')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {processes.map((p) => (
                    <tr key={p.pid} className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
                      <td className="px-5 py-2 font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {p.pid}
                      </td>
                      <td className="px-5 py-2">{p.name}</td>
                      <td className="px-5 py-2 text-right font-mono text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatBytes(p.workingSetBytes)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {!loading && !info && (
        <EmptyState icon={MemoryStick} title={t('emptyTitle')} description={t('emptyDescription')} />
      )}
    </div>
  )
}
