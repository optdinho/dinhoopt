import type { DriverUpdateProgress } from '@shared/types'
import { Loader2 } from 'lucide-react'
import { ScanProgress } from '@/components/shared/ScanProgress'

export interface UpdateProgressCardProps {
  updateProgress: DriverUpdateProgress | null
  showFallbackScan: boolean
  t: (key: string, options?: Record<string, unknown>) => string
}

export function UpdateProgressCard({ updateProgress, showFallbackScan, t }: UpdateProgressCardProps) {
  if (updateProgress) {
    return (
      <div
        className="mb-5 rounded-2xl p-4"
        style={{ background: 'rgba(59,130,246,0.04)', border: '1px solid rgba(59,130,246,0.08)' }}
      >
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2.5">
            <Loader2 className="h-4 w-4 animate-spin text-blue-400" strokeWidth={2} />
            <span className="text-[13px] font-medium text-zinc-200">
              {updateProgress.phase === 'checking'
                ? t('driverManager.updateProgressChecking')
                : updateProgress.phase === 'downloading'
                  ? t('driverManager.updateProgressDownloading')
                  : t('driverManager.updateProgressInstalling')}
              {updateProgress.total > 0 && ` (${updateProgress.current}/${updateProgress.total})`}
            </span>
          </div>
          <span className="text-[12px] font-mono" style={{ color: 'var(--text-secondary)' }}>
            {updateProgress.percent}%
          </span>
        </div>
        <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: 'var(--bg-hover-2)' }}>
          <div
            className="h-full rounded-full transition-all duration-300"
            style={{
              width: `${updateProgress.percent}%`,
              background: 'linear-gradient(90deg, #3b82f6 0%, #60a5fa 100%)',
            }}
          />
        </div>
        <p className="mt-2 text-[11px] truncate" style={{ color: 'var(--text-secondary)' }}>
          {updateProgress.currentDevice}
        </p>
      </div>
    )
  }

  if (showFallbackScan) {
    return (
      <ScanProgress
        status="scanning"
        progress={0}
        currentPath={t('driverManager.queryingWindowsUpdate')}
        className="mb-5"
      />
    )
  }

  return null
}
