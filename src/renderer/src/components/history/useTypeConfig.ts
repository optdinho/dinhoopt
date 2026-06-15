import type { HistoryEntryType } from '@shared/types'
import type { LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { typeConfigBase } from './constants'

export function useTypeConfig(): Record<
  HistoryEntryType,
  { label: string; icon: LucideIcon; color: string; bg: string }
> {
  const { t } = useTranslation('history')
  return useMemo(() => {
    const result = {} as Record<HistoryEntryType, { label: string; icon: LucideIcon; color: string; bg: string }>
    for (const [key, val] of Object.entries(typeConfigBase)) {
      result[key as HistoryEntryType] = { ...val, label: t(val.labelKey) }
    }
    return result
  }, [t])
}
