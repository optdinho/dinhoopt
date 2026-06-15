import type { UpdatableApp } from '@shared/types'
import { ArrowRight, Eye, EyeOff } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SEVERITY_STYLES_BASE } from './constants'

export function IgnoredRow({ app, onUnignore }: { app: UpdatableApp; onUnignore: () => void }) {
  const { t } = useTranslation('updates')
  const base = SEVERITY_STYLES_BASE[app.severity]
  return (
    <div
      className="flex items-center gap-4 rounded-xl px-5 py-3"
      style={{
        background: 'var(--bg-subtle)',
        border: '1px solid var(--border-subtle)',
        opacity: 0.7,
      }}
    >
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
        style={{ background: 'rgba(113,113,122,0.08)' }}
      >
        <EyeOff className="h-4 w-4 text-zinc-500" strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-medium text-zinc-400 truncate block">{app.name}</span>
        <span className="text-[10px] truncate block" style={{ color: 'var(--text-muted)' }}>
          {app.id}
        </span>
      </div>
      <div className="shrink-0 flex items-center gap-2">
        <span className="text-[11px] font-mono text-zinc-600">{app.currentVersion}</span>
        <ArrowRight className="h-3 w-3 text-zinc-700" strokeWidth={2} />
        <span className="text-[11px] font-mono" style={{ color: base.text }}>
          {app.availableVersion}
        </span>
      </div>
      <button
        type="button"
        onClick={onUnignore}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition-all hover:bg-white/5 hover:text-zinc-200 shrink-0"
        style={{ border: '1px solid var(--border-medium)' }}
      >
        <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('softwareUpdater.unignoreButton')}
      </button>
    </div>
  )
}
