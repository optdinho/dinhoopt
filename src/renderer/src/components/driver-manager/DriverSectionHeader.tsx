import type { LucideIcon } from 'lucide-react'

export interface DriverSectionHeaderProps {
  icon: LucideIcon
  iconColorClass: string
  title: string
  badge?: string
  allSelected: boolean
  onToggleAll: () => void
  t: (key: string, options?: Record<string, unknown>) => string
}

export function DriverSectionHeader({
  icon: Icon,
  iconColorClass,
  title,
  badge,
  allSelected,
  onToggleAll,
  t,
}: DriverSectionHeaderProps) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <div className="flex items-center gap-2.5">
        <Icon className={`h-4.5 w-4.5 ${iconColorClass}`} strokeWidth={1.8} />
        <span className="text-[13px] font-semibold text-zinc-200">{title}</span>
        {badge && (
          <span
            className="rounded-md px-2 py-0.5 text-[10px] font-medium"
            style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}
          >
            {badge}
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={onToggleAll}
        className="rounded-full px-3 py-1.5 text-[11px] font-medium transition-colors"
        style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-secondary)' }}
      >
        {allSelected ? t('driverManager.deselectAll') : t('driverManager.selectAll')}
      </button>
    </div>
  )
}
