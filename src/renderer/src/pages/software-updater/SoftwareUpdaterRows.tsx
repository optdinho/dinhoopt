import type { UpdatableApp } from '@shared/types'
import { ArrowRight, CheckCircle2, Download, Eye, EyeOff, Package } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SEVERITY_STYLES_BASE } from './updater-constants'

export function AppRow({
  app,
  updating,
  onToggle,
  onUpdate,
  onIgnore,
}: {
  app: UpdatableApp
  updating: boolean
  onToggle: () => void
  onUpdate: () => void
  onIgnore: () => void
}) {
  const { t } = useTranslation('updates')
  const base = SEVERITY_STYLES_BASE[app.severity]
  const severity = { ...base, label: t(base.labelKey) }

  return (
    <div
      className="flex items-center gap-4 rounded-2xl px-5 py-4 transition-colors"
      style={{
        background: app.selected ? 'rgba(245,158,11,0.03)' : 'var(--bg-subtle)',
        border: `1px solid ${app.selected ? 'rgba(245,158,11,0.1)' : 'var(--border-subtle)'}`,
      }}
    >
      <button onClick={onToggle} disabled={updating} className="shrink-0 disabled:opacity-40" type="button">
        <div
          className="flex h-4.5 w-4.5 items-center justify-center rounded"
          style={{
            background: app.selected ? 'var(--accent)' : 'var(--bg-hover-2)',
            border: app.selected ? 'none' : '1px solid var(--border-stronger)',
            width: 18,
            height: 18,
          }}
        >
          {app.selected && (
            <CheckCircle2 className="h-3 w-3" style={{ color: 'var(--text-on-accent)' }} strokeWidth={3} />
          )}
        </div>
      </button>

      <div
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
        style={{ background: severity.bg }}
      >
        <Package className="h-5 w-5" style={{ color: severity.text }} strokeWidth={1.8} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2.5">
          <span className="text-[13px] font-medium text-zinc-200 truncate">{app.name}</span>
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-medium shrink-0"
            style={{
              background: severity.bg,
              border: `1px solid ${severity.border}`,
              color: severity.text,
            }}
          >
            {severity.label}
          </span>
        </div>
        <p className="mt-0.5 text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
          {app.id}
        </p>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        <span className="text-[12px] font-mono text-zinc-500">{app.currentVersion}</span>
        <ArrowRight className="h-3 w-3 text-zinc-600" strokeWidth={2} />
        <span className="text-[12px] font-mono font-medium" style={{ color: severity.text }}>
          {app.availableVersion}
        </span>
      </div>

      <span
        className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-medium"
        style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
      >
        {app.source}
      </span>

      <button
        onClick={onIgnore}
        disabled={updating}
        title={t('softwareUpdater.ignoreButton')}
        className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] font-medium text-zinc-500 transition-all hover:bg-white/5 hover:text-zinc-300 disabled:opacity-30 shrink-0"
        style={{ border: '1px solid var(--border-medium)' }}
        type="button"
      >
        <EyeOff className="h-3.5 w-3.5" strokeWidth={1.8} />
      </button>

      <button
        onClick={onUpdate}
        disabled={updating}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-green-400 transition-all hover:bg-green-500/10 disabled:opacity-30 shrink-0"
        style={{ border: '1px solid rgba(34,197,94,0.15)' }}
        type="button"
      >
        <Download className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('softwareUpdater.updateButton')}
      </button>
    </div>
  )
}

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
        onClick={onUnignore}
        className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-medium text-zinc-400 transition-all hover:bg-white/5 hover:text-zinc-200 shrink-0"
        style={{ border: '1px solid var(--border-medium)' }}
        type="button"
      >
        <Eye className="h-3.5 w-3.5" strokeWidth={1.8} />
        {t('softwareUpdater.unignoreButton')}
      </button>
    </div>
  )
}

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
