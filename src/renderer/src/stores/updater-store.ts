import type { UpdatableApp, UpdateProgress, UpdateResult } from '@shared/types'
import { create } from 'zustand'

export type SortField = 'name' | 'severity' | 'source'
export type SeverityFilter = 'all' | 'major' | 'minor' | 'patch' | 'uptodate'

interface SoftwareUpdaterState {
  apps: UpdatableApp[]
  ignoredApps: UpdatableApp[]
  ignoredIds: Set<string>
  loading: boolean
  updating: boolean
  progress: UpdateProgress | null
  updateResult: UpdateResult | null
  error: string | null
  hasChecked: boolean
  packageManagerAvailable: boolean
  packageManagerName: string | null
  searchQuery: string
  sortField: SortField
  sortDirection: 'asc' | 'desc'
  severityFilter: SeverityFilter

  setApps: (apps: UpdatableApp[]) => void
  setLoading: (loading: boolean) => void
  setUpdating: (updating: boolean) => void
  setProgress: (progress: UpdateProgress | null) => void
  setUpdateResult: (result: UpdateResult | null) => void
  setError: (error: string | null) => void
  setHasChecked: (checked: boolean) => void
  setPackageManagerAvailable: (available: boolean) => void
  setPackageManagerName: (name: string | null) => void
  setSearchQuery: (query: string) => void
  setSortField: (field: SortField) => void
  setSortDirection: (dir: 'asc' | 'desc') => void
  setSeverityFilter: (filter: SeverityFilter) => void
  toggleAppSelected: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  removeApps: (ids: string[]) => void
  /** Load the persisted ignore list from settings (call once at init) */
  loadIgnoredIds: (ids: string[]) => void
  /** Move an app from the updates list to the ignored list and persist. Resolves false if persistence failed (state is reverted). */
  ignoreApp: (id: string) => Promise<boolean>
  /** Move an app from the ignored list back to the updates list and persist. Resolves false if persistence failed (state is reverted). */
  unignoreApp: (id: string) => Promise<boolean>
  reset: () => void
}

const severityOrder = { major: 0, minor: 1, patch: 2, unknown: 3 }

/** Persist the ignore list; resolves false if the main process rejected it or the call threw. */
async function persistIgnoredIds(ids: Set<string>): Promise<boolean> {
  const pending = window.dinho?.settingsSet?.({ ignoredSoftwareUpdates: [...ids] })
  if (!pending) return true
  try {
    const result = await pending
    return result?.success !== false
  } catch {
    return false
  }
}

export const useUpdaterStore = create<SoftwareUpdaterState>((set, get) => ({
  apps: [],
  ignoredApps: [],
  ignoredIds: new Set<string>(),
  loading: false,
  updating: false,
  progress: null,
  updateResult: null,
  error: null,
  hasChecked: false,
  packageManagerAvailable: true,
  packageManagerName: null,
  searchQuery: '',
  sortField: 'severity',
  sortDirection: 'asc',
  severityFilter: 'all',

  setApps: (allApps) => {
    const { ignoredIds } = get()
    set({
      apps: allApps.filter((a) => !ignoredIds.has(a.id)),
      ignoredApps: allApps.filter((a) => ignoredIds.has(a.id)),
    })
  },
  setLoading: (loading) => set({ loading }),
  setUpdating: (updating) => set({ updating }),
  setProgress: (progress) => set({ progress }),
  setUpdateResult: (updateResult) => set({ updateResult }),
  setError: (error) => set({ error }),
  setHasChecked: (hasChecked) => set({ hasChecked }),
  setPackageManagerAvailable: (packageManagerAvailable) => set({ packageManagerAvailable }),
  setPackageManagerName: (packageManagerName) => set({ packageManagerName }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSortField: (sortField) =>
    set((state) => ({
      sortField,
      sortDirection: sortField === 'severity' ? 'asc' : state.sortDirection,
    })),
  setSortDirection: (sortDirection) => set({ sortDirection }),
  setSeverityFilter: (severityFilter) => set({ severityFilter }),
  toggleAppSelected: (id) =>
    set((state) => ({
      apps: state.apps.map((a) => (a.id === id ? { ...a, selected: !a.selected } : a)),
    })),
  selectAll: () =>
    set((state) => ({
      apps: state.apps.map((a) => ({ ...a, selected: true })),
    })),
  deselectAll: () =>
    set((state) => ({
      apps: state.apps.map((a) => ({ ...a, selected: false })),
    })),
  removeApps: (ids) =>
    set((state) => ({
      apps: state.apps.filter((a) => !ids.includes(a.id)),
    })),
  loadIgnoredIds: (ids) => {
    const newIds = new Set(ids)
    set((state) => {
      // Recompute from the full set of known apps (both lists combined)
      const allApps = [...state.apps, ...state.ignoredApps]
      return {
        ignoredIds: newIds,
        apps: allApps.filter((a) => !newIds.has(a.id)),
        ignoredApps: allApps.filter((a) => newIds.has(a.id)),
      }
    })
  },
  ignoreApp: (id) => {
    const previous = { apps: get().apps, ignoredApps: get().ignoredApps, ignoredIds: get().ignoredIds }
    set((state) => {
      const app = state.apps.find((a) => a.id === id)
      const ignoredIds = new Set(state.ignoredIds)
      ignoredIds.add(id)
      return {
        ignoredIds,
        apps: state.apps.filter((a) => a.id !== id),
        ignoredApps: app ? [...state.ignoredApps, app] : state.ignoredApps,
      }
    })
    const updatedIds = get().ignoredIds
    return persistIgnoredIds(updatedIds).then((ok) => {
      // Only revert if no newer action replaced the ignore list in the meantime.
      if (!ok && get().ignoredIds === updatedIds) set(previous)
      return ok
    })
  },
  unignoreApp: (id) => {
    const previous = { apps: get().apps, ignoredApps: get().ignoredApps, ignoredIds: get().ignoredIds }
    set((state) => {
      const app = state.ignoredApps.find((a) => a.id === id)
      const ignoredIds = new Set(state.ignoredIds)
      ignoredIds.delete(id)
      return {
        ignoredIds,
        ignoredApps: state.ignoredApps.filter((a) => a.id !== id),
        apps: app ? [...state.apps, app] : state.apps,
      }
    })
    const updatedIds = get().ignoredIds
    return persistIgnoredIds(updatedIds).then((ok) => {
      if (!ok && get().ignoredIds === updatedIds) set(previous)
      return ok
    })
  },
  reset: () =>
    set({
      apps: [],
      ignoredApps: [],
      loading: false,
      updating: false,
      progress: null,
      updateResult: null,
      error: null,
      hasChecked: false,
      packageManagerAvailable: true,
      packageManagerName: null,
      searchQuery: '',
      sortField: 'severity',
      sortDirection: 'asc',
      severityFilter: 'all',
    }),
}))

export { severityOrder }
