import type { UpdatableApp } from '@shared/types'
import { CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function UpToDateRow({ app }: { app: UpdatableApp }) {
  const { t } = useTranslation('updates')
  return (
    <div
      className="flex items-center gap-4 rounded-xl px-5 py-3"
      style={{
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'rgba(34,197,94,0.08)' }}
      >
        <CheckCircle2 className="h-4 w-4 text-green-500" strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-medium text-zinc-400 truncate block">{app.name}</span>
        <span className="text-[10px] truncate block" style={{ color: 'var(--text-muted)' }}>
          {app.id}
        </span>
      </div>
      <span className="text-[11px] font-mono text-zinc-600 shrink-0">{app.currentVersion}</span>
      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
        style={{ background: 'rgba(34,197,94,0.06)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.1)' }}
      >
        {t('softwareUpdater.latestBadge')}
      </span>
    </div>
  )
}
