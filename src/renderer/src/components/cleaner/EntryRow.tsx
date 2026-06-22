import { Checkbox } from '@/components/shared/Checkbox'
import type { ContextMenuAction, ContextMenuEntry } from '@shared/types'
import { CheckCircle2, Lock, Power, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SCOPE_LABEL_KEY, SOURCE_PILL_COLOR } from './constants'

interface EntryRowProps {
  entry: ContextMenuEntry
  isLast: boolean
  onToggle: () => void
  onAction: (action: ContextMenuAction) => void
}

export function EntryRow({ entry, isLast, onToggle, onAction }: EntryRowProps) {
  const { t } = useTranslation('contextMenu')
  const subline = entry.command || entry.dllPath || entry.clsid || entry.keyPath
  return (
    <div
      className="flex items-center gap-3 px-5 py-3 transition-colors"
      style={{
        background: entry.selected ? 'rgba(245,158,11,0.04)' : 'transparent',
        borderBottom: !isLast ? '1px solid var(--bg-subtle)' : 'none',
        opacity: entry.protected ? 0.7 : 1,
      }}
    >
      <Checkbox
        checked={entry.selected}
        disabled={entry.protected}
        onChange={onToggle}
        aria-label={`select ${entry.displayName}`}
      />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] text-zinc-200">{entry.displayName}</p>
          <span
            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
            style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
          >
            {t(SCOPE_LABEL_KEY[entry.scope])}
          </span>
          {entry.kind === 'handler' && (
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
            >
              {t('kindHandler')}
            </span>
          )}
          {entry.protected && (
            <span
              title={t('protectedTooltip')}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'var(--bg-hover)', color: 'var(--text-muted)' }}
            >
              <Lock className="h-2.5 w-2.5" strokeWidth={2} /> {t('protectedBadge')}
            </span>
          )}
          {entry.requiresAdmin && (
            <span
              title={t('adminTooltip')}
              className="rounded px-1.5 py-0.5 text-[10px] font-medium"
              style={{ background: 'rgba(245,158,11,0.10)', color: '#f59e0b' }}
            >
              {t('adminBadge')}
            </span>
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[10px]" style={{ color: 'var(--text-muted)' }} title={subline}>
          {subline}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-medium"
          style={{
            background: entry.status === 'enabled' ? 'rgba(34,197,94,0.10)' : 'var(--bg-hover)',
            color: entry.status === 'enabled' ? '#22c55e' : 'var(--text-muted)',
          }}
        >
          {entry.status === 'enabled' ? t('statusEnabled') : t('statusDisabled')}
        </span>
        <span
          className="rounded-md px-2 py-0.5 text-[11px] font-medium"
          style={{ background: SOURCE_PILL_COLOR[entry.source].bg, color: SOURCE_PILL_COLOR[entry.source].text }}
        >
          {entry.source}
        </span>
        {!entry.protected && (
          <div className="flex items-center gap-1">
            {entry.status === 'enabled' ? (
              <button
                type="button"
                onClick={() => onAction('disable')}
                title={t('actionDisable')}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                style={{ background: 'var(--bg-hover)' }}
              >
                <Power className="h-3.5 w-3.5" style={{ color: 'var(--text-secondary)' }} strokeWidth={2} />
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onAction('enable')}
                title={t('actionEnable')}
                className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
                style={{ background: 'rgba(34,197,94,0.10)' }}
              >
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" strokeWidth={2} />
              </button>
            )}
            <button
              type="button"
              onClick={() => onAction('delete')}
              title={t('actionDelete')}
              className="flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{ background: 'rgba(239,68,68,0.08)' }}
            >
              <Trash2 className="h-3.5 w-3.5 text-red-400" strokeWidth={2} />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
