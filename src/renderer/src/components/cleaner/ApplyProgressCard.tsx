import type { ContextMenuApplyProgress } from '@shared/types'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface ApplyProgressCardProps {
  progress: ContextMenuApplyProgress | null
  applying: boolean
}

export function ApplyProgressCard({ progress, applying }: ApplyProgressCardProps) {
  const { t } = useTranslation('contextMenu')
  if (!applying || !progress) return null
  return (
    <div
      className="mb-5 rounded-2xl p-5"
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <div className="mb-3 flex items-center gap-2.5">
        <Loader2 className="h-4 w-4 animate-spin text-amber-400" />
        <span className="text-[13px] font-medium text-zinc-200">{t('applyingTitle')}</span>
        <span className="ml-auto font-mono text-[12px]" style={{ color: 'var(--text-secondary)' }}>
          {progress.current} / {progress.total}
        </span>
      </div>
      <div className="mb-2 h-[6px] overflow-hidden rounded-full" style={{ background: 'var(--bg-subtle-2)' }}>
        <div
          className="h-full rounded-full transition-all duration-200 ease-out"
          style={{
            width: `${progress.total > 0 ? (progress.current / progress.total) * 100 : 0}%`,
            background: 'linear-gradient(90deg, #f59e0b 0%, #d97706 100%)',
          }}
        />
      </div>
      <p className="truncate font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {progress.currentLabel}
      </p>
    </div>
  )
}
