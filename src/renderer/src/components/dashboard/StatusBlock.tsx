import type { AppStats } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { formatDate, formatNumber } from '@/lib/utils'

export function StatusBlock({ stats }: { stats: AppStats }) {
  const { t } = useTranslation('dashboard')

  return (
    <div className="glass-card depth-mid flex flex-col justify-center rounded-2xl px-5 py-4">
      <h3 className="mb-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        {t('statusHeading')}
      </h3>
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('statusLastScan')}
          </span>
          <span className="text-xs font-medium text-zinc-300">
            {stats.lastScanDate ? formatDate(stats.lastScanDate) : t('statusLastScanNever')}
          </span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            {t('statusTotalScans')}
          </span>
          <span className="text-xs font-medium text-zinc-300">{formatNumber(stats.totalScans)}</span>
        </div>
      </div>
    </div>
  )
}
