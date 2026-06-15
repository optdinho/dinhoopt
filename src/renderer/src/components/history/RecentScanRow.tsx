import { formatBytes } from '@/lib/utils'
import type { ScanHistoryEntry } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { useTypeConfig } from './useTypeConfig'

export function RecentScanRow({ entry }: { entry: ScanHistoryEntry }) {
  const { t } = useTranslation('history')
  const typeConfig = useTypeConfig()
  const config = typeConfig[entry.type]
  const Icon = config.icon

  return (
    <div
      className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors"
      style={{ background: 'var(--bg-subtle)' }}
    >
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: config.bg }}>
        <Icon className="h-4 w-4" style={{ color: config.color }} strokeWidth={1.8} />
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-[12px] font-medium text-zinc-300">{config.label}</span>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {entry.totalItemsCleaned.toLocaleString()} {t('detail.itemsSuffix')}
          {entry.totalSpaceSaved > 0 && ` · ${formatBytes(entry.totalSpaceSaved)}`}
        </p>
      </div>
      <span className="shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {new Date(entry.timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
      </span>
    </div>
  )
}
