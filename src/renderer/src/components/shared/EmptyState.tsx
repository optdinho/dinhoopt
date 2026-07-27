import type { LucideIcon } from 'lucide-react'
import { Clock } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useHistoryStore } from '@/stores/history-store'
import { cn, formatDate } from '@/lib/utils'

export interface EmptyAction {
  label: string
  onClick: () => void
  icon?: LucideIcon
}

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  description: string
  action?: React.ReactNode
  actions?: EmptyAction[]
  className?: string
  showLastScan?: boolean
  lastScanType?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  actions,
  className,
  showLastScan,
  lastScanType,
}: EmptyStateProps) {
  const { t } = useTranslation('common')
  const entries = useHistoryStore((s) => s.entries)

  const lastScanInfo = useMemo(() => {
    if (!showLastScan) return null
    const matching = lastScanType
      ? entries.filter((e) => e.type === lastScanType)
      : entries
    if (matching.length === 0) return null
    const latest = matching[0]
    if (!latest) return null
    return formatDate(latest.timestamp)
  }, [showLastScan, lastScanType, entries])

  return (
    <div className={cn('flex flex-col items-center justify-center py-20', className)}>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl"
        style={{ background: 'var(--bg-subtle)' }}
        aria-hidden="true"
      >
        <Icon className="h-7 w-7" style={{ color: 'var(--text-faint)' }} strokeWidth={1.5} />
      </motion.div>
      <h3 className="text-[15px] font-medium" style={{ color: 'var(--text-muted)' }}>
        {title}
      </h3>
      <p className="mt-1.5 max-w-sm text-center text-[13px]" style={{ color: 'var(--text-muted)' }}>
        {description}
      </p>

      {lastScanInfo && (
        <div className="mt-3 flex items-center gap-1.5">
          <Clock className="h-3 w-3" style={{ color: 'var(--text-muted)' }} strokeWidth={1.8} />
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('lastScan')}: {lastScanInfo}
          </p>
        </div>
      )}

      {action && <div className="mt-5">{action}</div>}

      {actions && actions.length > 0 && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {actions.map((a, i) => (
            <button
              key={a.label}
              type="button"
              onClick={a.onClick}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-all hover:opacity-90"
              style={{
                background: i === 0 ? 'var(--accent)' : 'var(--bg-subtle)',
                color: i === 0 ? 'var(--text-on-accent)' : 'var(--text-muted)',
                border: i === 0 ? 'none' : '1px solid var(--border-medium)',
              }}
            >
              {a.icon && <a.icon className="h-4 w-4" strokeWidth={1.8} />}
              {a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
