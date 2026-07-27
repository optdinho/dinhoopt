import { cn } from '@/lib/utils'
import type { ScheduleEntry, ScheduleTaskType } from '@shared/types'
import { motion } from 'framer-motion'
import { TriangleAlert, X } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Toggle } from './Toggle'
import { CLEANER_TASKS, DAY_NAME_KEYS, type Preset, type TaskDef, ordinal } from './constants'

export function PresetPicker({
  presets,
  onSelect,
  onClose,
}: {
  presets: Preset[]
  onSelect: (preset: Partial<ScheduleEntry> | null) => void
  onClose: () => void
}) {
  const { t } = useTranslation('schedules')
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
        onKeyDown={() => {}}
        aria-hidden="true"
      />
      <div
        className="relative w-full max-w-md animate-scale-in rounded-2xl p-6"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--border-medium)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
      >
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-white">{t('presets.dialogTitle')}</h3>
          <button type="button" onClick={onClose} className="text-zinc-600 transition-colors hover:text-zinc-400">
            <X className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>
        <div className="space-y-2.5">
          {presets.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => onSelect(preset.entry)}
              className="w-full rounded-xl p-4 text-left transition-colors"
              style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border-default)'
              }}
            >
              <p className="text-[14px] font-medium text-zinc-200">{preset.label}</p>
              <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                {preset.description}
              </p>
            </button>
          ))}
          <button
            type="button"
            onClick={() => onSelect(null)}
            className="w-full rounded-xl p-4 text-left transition-colors"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'rgba(245,158,11,0.3)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border-default)'
            }}
          >
            <p className="text-[14px] font-medium text-zinc-200">{t('presets.customLabel')}</p>
            <p className="mt-1 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              {t('presets.customDescription')}
            </p>
          </button>
        </div>
      </div>
    </motion.div>
  )
}

export function ScheduleDialog({
  initial,
  isEditing,
  availableTasks,
  onSave,
  onClose,
}: {
  initial: Partial<ScheduleEntry>
  isEditing: boolean
  availableTasks: TaskDef[]
  onSave: (entry: ScheduleEntry) => void
  onClose: () => void
}) {
  const { t } = useTranslation('schedules')
  const [name, setName] = useState(initial.name ?? '')
  const [frequency, setFrequency] = useState<'daily' | 'weekly' | 'monthly'>(initial.frequency ?? 'weekly')
  const [day, setDay] = useState(initial.day ?? 1)
  const [hour, setHour] = useState(initial.hour ?? 9)
  const [minute, setMinute] = useState(initial.minute ?? 0)
  const [tasks, setTasks] = useState<ScheduleTaskType[]>(initial.tasks ?? [...CLEANER_TASKS])
  const [autoApply, setAutoApply] = useState(initial.autoApply ?? false)

  const toggleTask = (type: ScheduleTaskType) => {
    setTasks((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]))
  }

  const allAvailableTypes = availableTasks.map((t) => t.type)
  const selectAll = () => setTasks([...allAvailableTypes])
  const deselectAll = () => setTasks([])

  const canSave = name.trim().length > 0 && tasks.length > 0

  const handleSubmit = () => {
    if (!canSave) return
    const entry: ScheduleEntry = {
      id: (initial as ScheduleEntry).id ?? crypto.randomUUID(),
      name: name.trim(),
      enabled: (initial as ScheduleEntry).enabled ?? true,
      frequency,
      day,
      hour,
      minute,
      tasks,
      autoApply,
      lastRunAt: (initial as ScheduleEntry).lastRunAt ?? null,
      lastRunStatus: (initial as ScheduleEntry).lastRunStatus ?? 'never',
      createdAt: (initial as ScheduleEntry).createdAt ?? new Date().toISOString(),
    }
    onSave(entry)
  }

  const selectStyle = 'rounded-lg px-3 py-1.5 text-[13px] text-zinc-400 outline-none'
  const selectBorder = { background: 'var(--bg-subtle-2)', border: '1px solid var(--border-medium)' }

  const cleanerTasks = availableTasks.filter((t) => t.group === 'cleaner')
  const maintTasks = availableTasks.filter((t) => t.group === 'maintenance')

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="fixed inset-0 z-[100] flex items-center justify-center"
    >
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}
        onClick={onClose}
        onKeyDown={() => {}}
        aria-hidden="true"
      />
      <div
        className="relative max-h-[85vh] w-full max-w-lg animate-scale-in overflow-y-auto rounded-2xl p-6"
        style={{
          background: 'var(--card-bg)',
          border: '1px solid var(--border-medium)',
          boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        }}
      >
        <div className="mb-6 flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-white">
            {isEditing ? t('dialog.editTitle') : t('dialog.newTitle')}
          </h3>
          <button type="button" onClick={onClose} className="text-zinc-600 transition-colors hover:text-zinc-400">
            <X className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>

        {/* Name */}
        <div className="mb-5">
          <label
            htmlFor="sched-name"
            className="mb-1.5 block text-[12px] font-medium"
            style={{ color: 'var(--text-muted)' }}
          >
            {t('dialog.nameLabel')}
          </label>
          <input
            id="sched-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('dialog.namePlaceholder')}
            maxLength={60}
            className="w-full rounded-xl px-4 py-2.5 text-[13px] text-zinc-300 outline-none placeholder:text-zinc-700"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-medium)' }}
          />
        </div>

        {/* Schedule timing */}
        <div className="mb-5 grid grid-cols-3 gap-3">
          <div>
            <label
              htmlFor="sched-frequency"
              className="mb-1.5 block text-[12px] font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('dialog.frequencyLabel')}
            </label>
            <select
              id="sched-frequency"
              value={frequency}
              onChange={(e) => {
                const f = e.target.value as 'daily' | 'weekly' | 'monthly'
                setFrequency(f)
                if (f === 'weekly') setDay(1)
                if (f === 'monthly') setDay(1)
              }}
              className={cn(selectStyle, 'w-full')}
              style={selectBorder}
            >
              <option value="daily">{t('dialog.frequencyDaily')}</option>
              <option value="weekly">{t('dialog.frequencyWeekly')}</option>
              <option value="monthly">{t('dialog.frequencyMonthly')}</option>
            </select>
          </div>

          {frequency === 'weekly' && (
            <div>
              <label
                htmlFor="sched-weekly-day"
                className="mb-1.5 block text-[12px] font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('dialog.dayLabel')}
              </label>
              <select
                id="sched-weekly-day"
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className={cn(selectStyle, 'w-full')}
                style={selectBorder}
              >
                {DAY_NAME_KEYS.map((key, idx) => (
                  <option key={key} value={idx}>
                    {t(key)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {frequency === 'monthly' && (
            <div>
              <label
                htmlFor="sched-monthly-day"
                className="mb-1.5 block text-[12px] font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('dialog.dayLabel')}
              </label>
              <select
                id="sched-monthly-day"
                value={day}
                onChange={(e) => setDay(Number(e.target.value))}
                className={cn(selectStyle, 'w-full')}
                style={selectBorder}
              >
                {Array.from({ length: 31 }, (_, i) => i + 1).map((dayNum) => (
                  <option key={dayNum} value={dayNum}>
                    {ordinal(dayNum)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label
              htmlFor="sched-hour"
              className="mb-1.5 block text-[12px] font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('dialog.timeLabel')}
            </label>
            <div className="flex gap-1.5">
              <select
                value={hour}
                onChange={(e) => setHour(Number(e.target.value))}
                className={cn(selectStyle, 'w-full')}
                style={selectBorder}
              >
                {Array.from({ length: 24 }, (_, i) => i).map((hourVal) => (
                  <option key={hourVal} value={hourVal}>
                    {String(hourVal).padStart(2, '0')}
                  </option>
                ))}
              </select>
              <span className="flex items-center text-[13px] text-zinc-400">:</span>
              <select
                value={minute}
                onChange={(e) => setMinute(Number(e.target.value))}
                className={cn(selectStyle, 'w-full')}
                style={selectBorder}
              >
                {Array.from({ length: 60 }, (_, i) => i).map((minVal) => (
                  <option key={minVal} value={minVal}>
                    {String(minVal).padStart(2, '0')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Tasks */}
        <div className="mb-5">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12px] font-medium" style={{ color: 'var(--text-muted)' }}>
              {t('dialog.tasksLabel')}
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={selectAll}
                className="text-[11px] font-medium"
                style={{ color: 'var(--accent)' }}
              >
                {t('dialog.selectAll')}
              </button>
              <button
                type="button"
                onClick={deselectAll}
                className="text-[11px] font-medium"
                style={{ color: 'var(--text-muted)' }}
              >
                {t('dialog.deselectAll')}
              </button>
            </div>
          </div>
          <div
            className="rounded-xl p-4"
            style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
          >
            <p
              className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('dialog.cleanerGroup')}
            </p>
            <div className="mb-4 grid grid-cols-2 gap-1.5">
              {cleanerTasks.map((task) => (
                <TaskCheckbox
                  key={task.type}
                  task={task}
                  checked={tasks.includes(task.type)}
                  onChange={() => toggleTask(task.type)}
                />
              ))}
            </div>
            <p
              className="mb-2 text-[10px] font-semibold uppercase tracking-widest"
              style={{ color: 'var(--text-muted)' }}
            >
              {t('dialog.maintenanceGroup')}
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {maintTasks.map((task) => (
                <TaskCheckbox
                  key={task.type}
                  task={task}
                  checked={tasks.includes(task.type)}
                  onChange={() => toggleTask(task.type)}
                />
              ))}
            </div>
          </div>
        </div>

        {/* Auto-apply */}
        <div
          className="mb-6 flex items-start gap-4 rounded-xl p-4"
          style={{ background: 'var(--bg-subtle)', border: '1px solid var(--border-default)' }}
        >
          <div className="flex-1">
            <p className="text-[13px] font-medium text-zinc-300">{t('dialog.autoApplyLabel')}</p>
            <p className="mt-1 text-[12px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {t('dialog.autoApplyDescription')}
            </p>
          </div>
          <Toggle checked={autoApply} onChange={setAutoApply} />
        </div>

        {autoApply && (
          <div
            className="mb-6 flex items-start gap-3 rounded-xl p-3"
            style={{ background: 'var(--accent-muted-bg)', border: '1px solid rgba(245,158,11,0.12)' }}
          >
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" style={{ color: 'var(--accent)' }} strokeWidth={1.8} />
            <p className="text-[12px] leading-relaxed" style={{ color: '#d97706' }}>
              {t('dialog.autoApplyWarning')}
            </p>
          </div>
        )}

        {/* Footer */}
        <div className="flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-5 py-2.5 text-[13px] font-medium transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--bg-subtle-2)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
            }}
          >
            {t('dialog.cancelButton')}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSave}
            className={cn(
              'rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-colors',
              !canSave && 'cursor-not-allowed opacity-40',
            )}
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            {isEditing ? t('dialog.saveChangesButton') : t('dialog.createScheduleButton')}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function TaskCheckbox({ task, checked, onChange }: { task: TaskDef; checked: boolean; onChange: () => void }) {
  const { t } = useTranslation('schedules')
  return (
    <button
      type="button"
      onClick={onChange}
      className={cn(
        'flex items-center gap-2.5 rounded-lg px-3 py-2 text-[12px] font-medium transition-all',
        checked ? 'text-zinc-200' : 'text-zinc-600',
      )}
      style={{
        background: checked ? 'var(--accent-muted-bg)' : 'transparent',
        border: checked ? '1px solid var(--accent-muted-border)' : '1px solid transparent',
      }}
    >
      <div
        className="flex h-4 w-4 shrink-0 items-center justify-center rounded"
        style={{
          background: checked ? 'var(--accent)' : 'var(--bg-hover-2)',
          border: checked ? 'none' : '1px solid var(--border-stronger)',
        }}
      >
        {checked && (
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" role="img" aria-label={t('checkedAria')}>
            <title>{t('checkedAria')}</title>
            <path
              d="M2 5L4.2 7.5L8 2.5"
              stroke="var(--text-on-accent)"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
      <task.icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
      {task.label}
    </button>
  )
}
