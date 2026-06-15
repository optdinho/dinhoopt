import { usePlatform } from '@/hooks/usePlatform'
import type { ScheduleEntry, ScheduleTaskType } from '@shared/types'
import type { TFunction } from 'i18next'
import { AppWindow, Database, Download, Gamepad2, Globe, Monitor, Sparkles, Trash, Zap } from 'lucide-react'
import type { ComponentType } from 'react'
import { useTranslation } from 'react-i18next'

export const DAY_NAME_KEYS = [
  'dayNames.sunday',
  'dayNames.monday',
  'dayNames.tuesday',
  'dayNames.wednesday',
  'dayNames.thursday',
  'dayNames.friday',
  'dayNames.saturday',
]

export const MAX_SCHEDULES = 10

export interface TaskDef {
  type: ScheduleTaskType
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  group: 'cleaner' | 'maintenance'
  requiresFeature?: 'registry' | 'drivers'
}

const ALL_TASKS_BASE: Array<Omit<TaskDef, 'label'> & { labelKey: string }> = [
  { type: 'cleaner:system', labelKey: 'tasks.system', icon: Monitor, group: 'cleaner' },
  { type: 'cleaner:browsers', labelKey: 'tasks.browsers', icon: Globe, group: 'cleaner' },
  { type: 'cleaner:apps', labelKey: 'tasks.applications', icon: AppWindow, group: 'cleaner' },
  { type: 'cleaner:gaming', labelKey: 'tasks.gaming', icon: Gamepad2, group: 'cleaner' },
  { type: 'cleaner:recycleBin', labelKey: 'tasks.recycleBin', icon: Trash, group: 'cleaner' },
  { type: 'cleaner:databases', labelKey: 'tasks.databases', icon: Database, group: 'cleaner' },
  { type: 'registry', labelKey: 'tasks.registryFixes', icon: Zap, group: 'maintenance', requiresFeature: 'registry' },
  {
    type: 'drivers',
    labelKey: 'tasks.driverUpdates',
    icon: Download,
    group: 'maintenance',
    requiresFeature: 'drivers',
  },
  { type: 'software-update', labelKey: 'tasks.softwareUpdates', icon: Sparkles, group: 'maintenance' },
]

export const CLEANER_TASKS = ALL_TASKS_BASE.filter((t) => t.group === 'cleaner').map((t) => t.type)

export function useAllTasks(): TaskDef[] {
  const { t } = useTranslation('schedules')
  return ALL_TASKS_BASE.map((task) => ({ ...task, label: t(task.labelKey) }))
}

export function usePlatformTasks(): TaskDef[] {
  const { features } = usePlatform()
  const allTasks = useAllTasks()
  return allTasks.filter((task) => !task.requiresFeature || features[task.requiresFeature])
}

export interface Preset {
  label: string
  description: string
  entry: Partial<ScheduleEntry>
}

export function buildPresets(availableTasks: TaskDef[], t: TFunction<'schedules'>): Preset[] {
  const allTypes = availableTasks.map((task) => task.type)
  return [
    {
      label: t('presets.weeklyFullCleanLabel'),
      description: t('presets.weeklyFullCleanDescription'),
      entry: {
        name: t('presets.weeklyFullCleanLabel'),
        frequency: 'weekly',
        day: 1,
        hour: 9,
        minute: 0,
        tasks: [...CLEANER_TASKS],
        autoApply: true,
      },
    },
    {
      label: t('presets.dailyLightSweepLabel'),
      description: t('presets.dailyLightSweepDescription'),
      entry: {
        name: t('presets.dailyLightSweepLabel'),
        frequency: 'daily',
        day: 0,
        hour: 8,
        minute: 0,
        tasks: ['cleaner:system', 'cleaner:browsers', 'cleaner:recycleBin'],
        autoApply: true,
      },
    },
    {
      label: t('presets.monthlyDeepMaintenanceLabel'),
      description: t('presets.monthlyDeepMaintenanceDescription'),
      entry: {
        name: t('presets.monthlyDeepMaintenanceLabel'),
        frequency: 'monthly',
        day: 1,
        hour: 10,
        minute: 0,
        tasks: [...allTypes],
        autoApply: true,
      },
    },
  ]
}

export function makeBlankEntry(): Partial<ScheduleEntry> {
  return { name: '', frequency: 'weekly', day: 1, hour: 9, minute: 0, tasks: [...CLEANER_TASKS], autoApply: false }
}

export function formatFrequency(entry: ScheduleEntry, t: TFunction<'schedules'>): string {
  const time = `${String(entry.hour).padStart(2, '0')}:${String(entry.minute ?? 0).padStart(2, '0')}`
  switch (entry.frequency) {
    case 'daily':
      return t('frequency.everyDayAt', { time })
    case 'weekly':
      return t('frequency.everyWeekdayAt', { day: t(DAY_NAME_KEYS[entry.day] ?? 'dayNames.monday'), time })
    case 'monthly':
      return t('frequency.monthlyAt', { ordinalDay: ordinal(entry.day), time })
  }
}

export function formatNextRun(date: Date, t: TFunction<'schedules'>): string {
  const now = new Date()
  const diffMs = date.getTime() - now.getTime()
  const diffD = Math.floor(diffMs / 86_400_000)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`

  if (diffD === 0 && date.getDate() === now.getDate()) return t('nextRun.todayAt', { time })
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  if (
    date.getFullYear() === tomorrow.getFullYear() &&
    date.getMonth() === tomorrow.getMonth() &&
    date.getDate() === tomorrow.getDate()
  )
    return t('nextRun.tomorrowAt', { time })
  if (diffD < 7) return t('nextRun.inDaysAt', { count: diffD, time })
  return t('nextRun.dateAt', { date: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), time })
}

export function formatLastRun(iso: string, t: TFunction<'schedules'>): string {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffM = Math.floor(diffMs / 60_000)
  const diffH = Math.floor(diffMs / 3_600_000)
  const diffD = Math.floor(diffMs / 86_400_000)

  if (diffM < 1) return t('lastRun.justNow')
  if (diffM < 60) return t('lastRun.minutesAgo', { count: diffM })
  if (diffH < 24) return t('lastRun.hoursAgo', { count: diffH })
  if (diffD < 7) return t('lastRun.daysAgo', { count: diffD })
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0] ?? 'th')
}
