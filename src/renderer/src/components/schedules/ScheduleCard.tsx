import { cn } from '@/lib/utils'
import { getNextRunTime } from '@/pages/schedules-utils'
import type { ScheduleEntry } from '@shared/types'
import { TriangleAlert, CircleCheckBig, Clock, Copy, Minus, Pencil, Trash2, CircleX } from 'lucide-react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle } from './Toggle'
import { formatFrequency, formatLastRun, formatNextRun, useAllTasks } from './constants'

const ScheduleCard = memo(function ScheduleCard({
  entry,
  onToggle,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  entry: ScheduleEntry
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const { t } = useTranslation('schedules')
  const allTasks = useAllTasks()
  const nextRun = useMemo(() => getNextRunTime(entry), [entry])
  const frequencyText = useMemo(() => formatFrequency(entry, t), [entry, t])
  const taskCount = entry.tasks.length

  return (
    <div
      className={cn('group rounded-2xl p-5 transition-all', !entry.enabled && 'opacity-50')}
      style={{ background: 'var(--card-bg)', border: '1px solid var(--border-default)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h3 className="truncate text-[15px] font-semibold text-white">{entry.name}</h3>
            {entry.autoApply && (
              <span
                className="shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
                style={{ background: 'var(--accent-muted-bg)', color: 'var(--accent)' }}
              >
                {t('card.autoApplyBadge')}
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {frequencyText}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
            <IconBtn icon={Pencil} title={t('card.editAction')} onClick={onEdit} />
            <IconBtn icon={Copy} title={t('card.duplicateAction')} onClick={onDuplicate} />
            <IconBtn icon={Trash2} title={t('card.deleteAction')} onClick={onDelete} color="#ef4444" />
          </div>
          <Toggle checked={entry.enabled} onChange={onToggle} />
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {entry.tasks.map((taskType) => {
          const def = allTasks.find((d) => d.type === taskType)
          if (!def) return null
          return (
            <span
              key={taskType}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-medium"
              style={{ background: 'var(--bg-subtle-2)', color: 'var(--text-muted)' }}
            >
              <def.icon className="h-3 w-3" strokeWidth={1.8} />
              {def.label}
            </span>
          )
        })}
        {taskCount === 0 && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {t('card.noTasksSelected')}
          </span>
        )}
      </div>

      <div
        className="mt-4 flex items-center gap-5"
        style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '12px' }}
      >
        {entry.enabled && nextRun && (
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
            <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('card.nextRun', { time: formatNextRun(nextRun, t) })}
            </span>
          </div>
        )}
        <div className="flex items-center gap-2">
          {entry.lastRunStatus === 'success' && (
            <CircleCheckBig className="h-3.5 w-3.5 shrink-0" style={{ color: '#22c55e' }} strokeWidth={1.8} />
          )}
          {entry.lastRunStatus === 'partial' && (
            <TriangleAlert className="h-3.5 w-3.5 shrink-0" style={{ color: '#eab308' }} strokeWidth={1.8} />
          )}
          {entry.lastRunStatus === 'failed' && (
            <CircleX className="h-3.5 w-3.5 shrink-0" style={{ color: '#ef4444' }} strokeWidth={1.8} />
          )}
          {entry.lastRunStatus === 'never' && (
            <Minus className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--text-faint)' }} strokeWidth={1.8} />
          )}
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            {entry.lastRunAt ? t('card.lastRun', { time: formatLastRun(entry.lastRunAt, t) }) : t('card.neverRun')}
          </span>
        </div>
      </div>
    </div>
  )
})

export { ScheduleCard }

function IconBtn({
  icon: Icon,
  title,
  onClick,
  color,
}: { icon: typeof Pencil; title: string; onClick: () => void; color?: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
      style={{ color: color ?? 'var(--text-muted)' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--bg-hover-2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <Icon className="h-4 w-4" strokeWidth={1.8} />
    </button>
  )
}
