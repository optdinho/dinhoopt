import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface RepairProgressData {
  tool: string
  phase: string
  percent: number
  message: string
}

interface RepairProgressCardProps {
  progress: RepairProgressData
}

export function RepairProgressCard({ progress }: RepairProgressCardProps) {
  const { t } = useTranslation('disk')

  return (
    <div
      className="mb-5 rounded-2xl px-5 py-4"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <div className="mb-3 flex items-center gap-3">
        <RefreshCw className="h-4 w-4 animate-spin text-amber-400" strokeWidth={2} />
        <span className="text-[13px] font-medium text-zinc-200">
          {progress.tool === 'sfc'
            ? t('repairProgressSfc')
            : progress.tool === 'dism'
              ? t('repairProgressDism')
              : t('repairProgressChkdsk')}
        </span>
        <span className="ml-auto font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          {progress.percent}%
        </span>
      </div>
      <div className="h-2 rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{
            width: `${progress.percent}%`,
            background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
          }}
        />
      </div>
      <p className="mt-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
        {progress.message}
      </p>
    </div>
  )
}
