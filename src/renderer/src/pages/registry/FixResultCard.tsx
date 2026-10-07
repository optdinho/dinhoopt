import { CircleCheckBig, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useRegistryStore } from '@/stores/registry-store'

export function FixResultCard() {
  const { t } = useTranslation('registry')
  const result = useRegistryStore((s) => s.fixResult)
  const showFailures = useRegistryStore((s) => s.showFailures)

  if (!result) return null

  return (
    <div
      className="mb-5 overflow-hidden rounded-2xl"
      data-testid="fix-result-card"
      style={{ border: `1px solid ${result.failed > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)'}` }}
    >
      <div
        className="flex items-center gap-3 p-4"
        style={{ background: result.failed > 0 ? 'rgba(239,68,68,0.04)' : 'rgba(34,197,94,0.06)' }}
      >
        <CircleCheckBig className="h-5 w-5 text-green-500" strokeWidth={1.8} />
        <p className="flex-1 text-[13px] text-zinc-200">
          {t('fixedEntries', { count: result.fixed })}
          {result.failed > 0 && (
            <button
              type="button"
              onClick={() => useRegistryStore.getState().setShowFailures(!showFailures)}
              className="ml-2 text-red-400 underline decoration-red-400/30 hover:decoration-red-400 transition-colors"
            >
              {t('failedCount', { count: result.failed })} —{' '}
              {showFailures ? t('failedHideDetails') : t('failedShowDetails')}
            </button>
          )}
        </p>
      </div>
      {result.backupFailed && (
        <div
          className="flex items-start gap-3 border-t px-4 py-3"
          data-testid="backup-failed-warning"
          style={{ borderColor: 'rgba(245,158,11,0.15)', background: 'rgba(245,158,11,0.06)' }}
        >
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" strokeWidth={1.8} />
          <p className="text-[12px] leading-relaxed text-amber-300/90">{t('backupFailedWarning')}</p>
        </div>
      )}
      {showFailures && result.failures.length > 0 && (
        <div style={{ borderTop: '1px solid var(--border-subtle)' }}>
          {result.failures.map((f, i) => (
            <div
              key={`${f.issue}-${f.reason}`}
              className="flex items-start gap-3 px-5 py-3"
              style={{ borderBottom: i < result.failures.length - 1 ? '1px solid var(--bg-subtle)' : 'none' }}
            >
              <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-400" />
              <div className="min-w-0">
                <p className="text-[12px] text-zinc-300">{f.issue}</p>
                <p className="mt-0.5 text-[11px] text-red-400/80">{f.reason}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
