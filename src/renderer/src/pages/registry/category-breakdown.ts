import type { RegistryEntry } from '@shared/types'

export interface RegistryCategoryTotals {
  found: number
  fixed: number
}

export function buildRegistryCategories(
  entries: RegistryEntry[],
  fixedByType: Record<string, number>,
): Record<string, RegistryCategoryTotals> {
  const byType: Record<string, RegistryCategoryTotals> = {}
  for (const entry of entries) {
    const totals = byType[entry.type] ?? { found: 0, fixed: 0 }
    totals.found++
    byType[entry.type] = totals
  }
  for (const type in byType) {
    const totals = byType[type]
    if (totals) totals.fixed = fixedByType[type] ?? 0
  }
  return byType
}
