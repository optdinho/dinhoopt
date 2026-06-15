import type { UpdateProgress as UpdateProgressType } from '@shared/types'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function UpdateProgress({ progress }: { progress: UpdateProgressType }) {
  const { t } = useTranslation('updates')
  return (
    <div
      className="mb-5 rounded-2xl p-4"
      style={{
        background: 'rgba(245,158,11,0.04)',
        border: '1px solid var(--accent-muted-bg)',
      }}
    >
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
          <span className="text-[13px] font-medium text-zinc-200">
            {t('softwareUpdater.updatingProgress', {
              app: progress.currentApp,
              current: progress.current,
              total: progress.total,
            })}
          </span>
        </div>
        <span className="text-[12px] font-mono" style={{ color: 'var(--text-muted)' }}>
          {progress.percent}%
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{
            width: `${progress.percent}%`,
            background: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
          }}
        />
      </div>
      {progress.status === 'failed' && (
        <p className="mt-2 text-[11px] text-red-400">
          {t('softwareUpdater.failedToUpdate', { app: progress.currentApp })}
        </p>
      )}
    </div>
  )
}
