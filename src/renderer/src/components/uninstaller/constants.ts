import { UNUSED_THRESHOLD_DAYS } from '@/stores/uninstaller-store'
import type { InstalledProgram } from '@shared/types'
import type { TFunction } from 'i18next'
import { Shield, ShieldAlert, ShieldCheck } from 'lucide-react'

const UNUSED_THRESHOLD_MS = UNUSED_THRESHOLD_DAYS * 24 * 60 * 60 * 1000

export { UNUSED_THRESHOLD_DAYS }

export function formatDate(raw: string): string {
  if (!raw || raw.length !== 8) return ''
  const year = raw.substring(0, 4)
  const month = raw.substring(4, 6)
  const day = raw.substring(6, 8)
  return `${year}-${month}-${day}`
}

export function isUnused(prog: InstalledProgram): boolean {
  if (prog.lastUsed === -1) return false
  if (prog.lastUsed === 0) return true
  return Date.now() - prog.lastUsed > UNUSED_THRESHOLD_MS
}

export function formatLastUsed(ts: number, t: TFunction<'uninstaller'>): string {
  if (ts <= 0) return t('lastUsedNeverDetected')
  const days = Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000))
  if (days === 0) return t('lastUsedToday')
  if (days === 1) return t('lastUsedYesterday')
  if (days < 30) return t('lastUsedDaysAgo', { days })
  const months = Math.floor(days / 30)
  if (months < 12) return t('lastUsedMonthsAgo', { months })
  const years = Math.floor(months / 12)
  return t('lastUsedYearsAgo', { years })
}

export function safetyScoreColor(score: number): { bg: string; text: string } {
  if (score >= 8) return { bg: 'rgba(34,197,94,0.10)', text: '#22c55e' }
  if (score >= 5) return { bg: 'rgba(245,158,11,0.10)', text: '#f59e0b' }
  if (score >= 3) return { bg: 'rgba(249,115,22,0.10)', text: '#f97316' }
  return { bg: 'rgba(239,68,68,0.10)', text: '#ef4444' }
}

export function safetyIcon(score: number) {
  if (score >= 8) return ShieldCheck
  if (score >= 5) return Shield
  return ShieldAlert
}

export const SORT_LABEL_KEYS: Record<string, string> = {
  displayName: 'sortByName',
  estimatedSize: 'sortBySize',
  installDate: 'sortByDate',
  publisher: 'sortByPublisher',
  safety: 'sortBySafety',
}
