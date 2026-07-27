import type { ScheduleEntry } from '@shared/types'
import { AnimatePresence } from 'framer-motion'
import { CalendarClock, Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { PageHeader } from '@/components/layout/PageHeader'
import { buildPresets, MAX_SCHEDULES, makeBlankEntry, usePlatformTasks } from '@/components/schedules/constants'
import { ScheduleCard } from '@/components/schedules/ScheduleCard'
import { PresetPicker, ScheduleDialog } from '@/components/schedules/ScheduleDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { EmptyState } from '@/components/shared/EmptyState'
import { StaggerContainer, StaggerItem } from '@/components/shared/StaggerContainer'
import { useSettingsStore } from '@/stores/settings-store'

export function SchedulesPage() {
  const { t } = useTranslation('schedules')
  const { settings, updateSettings } = useSettingsStore()
  const platformTasks = usePlatformTasks()
  const presets = useMemo(() => buildPresets(platformTasks, t), [platformTasks, t])
  const schedules = settings.schedules ?? []

  const save = (updated: ScheduleEntry[]) => {
    updateSettings({ schedules: updated })
    window.dinho?.settingsSet?.({ schedules: updated }).catch(() => {})
  }

  const ensureBackgroundMode = () => {
    if (!settings.runAtStartup) {
      updateSettings({ runAtStartup: true })
      window.dinho?.settingsSet?.({ runAtStartup: true }).catch(() => {})
      window.dinho?.applyStartup?.(true).catch(() => {
        updateSettings({ runAtStartup: false })
        window.dinho?.settingsSet?.({ runAtStartup: false }).catch(() => {})
        toast.error(t('failedEnableStartup'), {
          action: {
            label: t('failedEnableStartupAction'),
            onClick: () => window.open('https://usekudu.com/help/startup-failed', '_blank'),
          },
        })
      })
    }
    if (!settings.minimizeToTray) {
      updateSettings({ minimizeToTray: true })
      window.dinho?.settingsSet?.({ minimizeToTray: true }).catch(() => {})
      window.dinho?.applyTray?.(true)
    }
  }

  const [showDialog, setShowDialog] = useState(false)
  const [showPresets, setShowPresets] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  const handleNew = () => {
    if (schedules.length >= MAX_SCHEDULES) {
      toast.error(t('maxSchedulesReached', { max: MAX_SCHEDULES }))
      return
    }
    setEditingId(null)
    setShowPresets(true)
  }

  const handlePresetSelect = (preset: Partial<ScheduleEntry> | null) => {
    setShowPresets(false)
    setEditingId(null)
    setShowDialog(true)
    setDialogInitial(preset ?? makeBlankEntry())
  }

  const handleEdit = (id: string) => {
    const entry = schedules.find((s) => s.id === id)
    if (!entry) return
    setDialogInitial(entry)
    setEditingId(id)
    setShowDialog(true)
  }

  const handleDuplicate = (id: string) => {
    if (schedules.length >= MAX_SCHEDULES) {
      toast.error(t('maxSchedulesReached', { max: MAX_SCHEDULES }))
      return
    }
    const entry = schedules.find((s) => s.id === id)
    if (!entry) return
    const dup: ScheduleEntry = {
      ...entry,
      id: crypto.randomUUID(),
      name: `${entry.name} ${t('copyNameSuffix')}`,
      lastRunAt: null,
      lastRunStatus: 'never',
      createdAt: new Date().toISOString(),
    }
    save([...schedules, dup])
    toast.success(t('duplicatedToast', { name: entry.name }))
  }

  const handleDelete = () => {
    if (!deleteId) return
    const entry = schedules.find((s) => s.id === deleteId)
    save(schedules.filter((s) => s.id !== deleteId))
    setDeleteId(null)
    if (entry) toast.success(t('deletedToast', { name: entry.name }))
  }

  const handleToggle = (id: string, enabled: boolean) => {
    save(schedules.map((s) => (s.id === id ? { ...s, enabled } : s)))
    if (enabled) ensureBackgroundMode()
  }

  const handleSave = (entry: ScheduleEntry) => {
    if (editingId) {
      save(schedules.map((s) => (s.id === editingId ? entry : s)))
    } else {
      save([...schedules, entry])
    }
    if (entry.enabled) ensureBackgroundMode()
    setShowDialog(false)
    setEditingId(null)
    toast.success(editingId ? t('updatedToast', { name: entry.name }) : t('createdToast', { name: entry.name }))
  }

  const [dialogInitial, setDialogInitial] = useState<Partial<ScheduleEntry>>(makeBlankEntry())

  return (
    <div className="animate-fade-in">
      <PageHeader
        title={t('pageTitle')}
        description={t('pageDescription')}
        action={
          <button
            type="button"
            onClick={handleNew}
            className="flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-colors"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            <Plus className="h-4 w-4" strokeWidth={2.2} />
            {t('newScheduleButton')}
          </button>
        }
      />

      {schedules.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t('emptyStateTitle')}
          description={t('emptyStateDescription')}
          action={
            <button
              type="button"
              onClick={handleNew}
              className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-[13px] font-semibold transition-colors"
              style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
            >
              <Plus className="h-4 w-4" strokeWidth={2.2} />
              {t('createScheduleButton')}
            </button>
          }
        />
      ) : (
        <StaggerContainer className="space-y-3">
          {schedules.map((entry) => (
            <StaggerItem key={entry.id}>
              <ScheduleCard
                entry={entry}
                onToggle={(enabled) => handleToggle(entry.id, enabled)}
                onEdit={() => handleEdit(entry.id)}
                onDuplicate={() => handleDuplicate(entry.id)}
                onDelete={() => setDeleteId(entry.id)}
              />
            </StaggerItem>
          ))}
        </StaggerContainer>
      )}

      <AnimatePresence>
        {showPresets && (
          <PresetPicker
            key="preset-picker"
            presets={presets}
            onSelect={handlePresetSelect}
            onClose={() => setShowPresets(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showDialog && (
          <ScheduleDialog
            key="schedule-dialog"
            initial={dialogInitial}
            isEditing={!!editingId}
            availableTasks={platformTasks}
            onSave={handleSave}
            onClose={() => {
              setShowDialog(false)
              setEditingId(null)
            }}
          />
        )}
      </AnimatePresence>

      <ConfirmDialog
        open={!!deleteId}
        onConfirm={handleDelete}
        onCancel={() => setDeleteId(null)}
        title={t('deleteConfirmTitle')}
        description={t('deleteConfirmDescription')}
        confirmLabel={t('deleteConfirmLabel')}
        variant="danger"
      />
    </div>
  )
}
