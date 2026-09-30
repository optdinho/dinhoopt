import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

const STORAGE_KEY = 'dinho:repair-reminder-last-shown'

export const REPAIR_REMINDER_INTERVAL_MS = 15 * 24 * 60 * 60 * 1000

function readLastShown(): number | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = Date.parse(raw)
    return Number.isNaN(parsed) ? null : parsed
  } catch {
    return null
  }
}

function writeLastShown(at: number): void {
  try {
    localStorage.setItem(STORAGE_KEY, new Date(at).toISOString())
  } catch {
    /* persistence unavailable — the reminder simply repeats next launch */
  }
}

/**
 * DISM and SFC only find corruption once it has spread. A 15 day cadence is the
 * usual maintenance interval and keeps the nudge rare enough to stay useful.
 */
export function useRepairReminder(): void {
  const { t } = useTranslation('disk')

  useEffect(() => {
    const last = readLastShown()
    if (last !== null && Date.now() - last < REPAIR_REMINDER_INTERVAL_MS) return

    writeLastShown(Date.now())
    toast.warning(t('repairReminderTitle'), {
      description: t('repairReminderDescription'),
      duration: 12000,
    })
  }, [t])
}
