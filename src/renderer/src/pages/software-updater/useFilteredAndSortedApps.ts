import { severityOrder, useUpdaterStore } from '@/stores/updater-store'
import type { UpdatableApp } from '@shared/types'
import { useMemo } from 'react'

export interface FilteredAppsResult {
  filteredApps: UpdatableApp[]
  upToDate: UpdatableApp[]
  selectedCount: number
  allSelected: boolean
  isBusy: boolean
  majorCount: number
  minorCount: number
  patchCount: number
}

export function useFilteredAndSortedApps(): FilteredAppsResult {
  const apps = useUpdaterStore((s) => s.apps)
  const searchQuery = useUpdaterStore((s) => s.searchQuery)
  const sortField = useUpdaterStore((s) => s.sortField)
  const sortDirection = useUpdaterStore((s) => s.sortDirection)
  const severityFilter = useUpdaterStore((s) => s.severityFilter)
  const loading = useUpdaterStore((s) => s.loading)
  const updating = useUpdaterStore((s) => s.updating)

  const filteredApps = useMemo(() => {
    let list = apps
    if (severityFilter !== 'all') {
      list = list.filter((a) => a.severity === severityFilter)
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
    }
    const dir = sortDirection === 'asc' ? 1 : -1
    return [...list].sort((a, b) => {
      switch (sortField) {
        case 'severity':
          return (severityOrder[a.severity] - severityOrder[b.severity]) * dir
        case 'source':
          return a.source.localeCompare(b.source) * dir
        default:
          return a.name.localeCompare(b.name) * dir
      }
    })
  }, [apps, searchQuery, sortField, sortDirection, severityFilter])

  const upToDate = useMemo(() => apps.filter((a) => a.isUpToDate), [apps])

  const selectedCount = apps.filter((a) => a.selected).length
  const allSelected = apps.length > 0 && selectedCount === apps.length
  const isBusy = loading || updating
  const majorCount = apps.filter((a) => a.severity === 'major').length
  const minorCount = apps.filter((a) => a.severity === 'minor').length
  const patchCount = apps.filter((a) => a.severity === 'patch').length

  return { filteredApps, upToDate, selectedCount, allSelected, isBusy, majorCount, minorCount, patchCount }
}
