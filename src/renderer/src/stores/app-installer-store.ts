import type { AppInstallerApp, AppInstallProgress, AppInstallResult } from '@shared/types'
import { create } from 'zustand'

export type AppInstallerFilter = 'all' | 'not-installed' | 'installed' | AppInstallerApp['category']

interface AppInstallerState {
  apps: AppInstallerApp[]
  loading: boolean
  installing: boolean
  cancelled: boolean
  progress: AppInstallProgress | null
  installResult: AppInstallResult | null
  error: string | null
  hasLoaded: boolean
  wingetAvailable: boolean
  searchQuery: string
  categoryFilter: AppInstallerFilter
  showOnlySelected: boolean
  selectedIds: Set<string>

  setApps: (apps: AppInstallerApp[]) => void
  setLoading: (loading: boolean) => void
  setInstalling: (installing: boolean) => void
  setProgress: (progress: AppInstallProgress | null) => void
  setInstallResult: (result: AppInstallResult | null) => void
  setError: (error: string | null) => void
  setHasLoaded: (loaded: boolean) => void
  setWingetAvailable: (available: boolean) => void
  setSearchQuery: (query: string) => void
  setCategoryFilter: (filter: AppInstallerFilter) => void
  setShowOnlySelected: (show: boolean) => void
  toggleSelected: (id: string) => void
  selectCategory: (filter: AppInstallerFilter) => void
  deselectAll: () => void
  reset: () => void
}

export const useAppInstallerStore = create<AppInstallerState>((set) => ({
  apps: [],
  loading: false,
  installing: false,
  cancelled: false,
  progress: null,
  installResult: null,
  error: null,
  hasLoaded: false,
  wingetAvailable: true,
  searchQuery: '',
  categoryFilter: 'all',
  showOnlySelected: false,
  selectedIds: new Set<string>(),

  setApps: (apps) => set({ apps }),
  setLoading: (loading) => set({ loading }),
  setInstalling: (installing) => set({ installing }),
  setProgress: (progress) => set({ progress }),
  setInstallResult: (installResult) => set({ installResult }),
  setError: (error) => set({ error }),
  setHasLoaded: (hasLoaded) => set({ hasLoaded }),
  setWingetAvailable: (wingetAvailable) => set({ wingetAvailable }),
  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setShowOnlySelected: (showOnlySelected) => set({ showOnlySelected }),
  toggleSelected: (id) =>
    set((state) => {
      const selectedIds = new Set(state.selectedIds)
      if (selectedIds.has(id)) {
        selectedIds.delete(id)
      } else {
        selectedIds.add(id)
      }
      return { selectedIds }
    }),
  selectCategory: (filter) =>
    set((state) => {
      const target = state.apps.filter((a) => {
        if (filter === 'all') return true
        if (filter === 'not-installed') return !a.isInstalled
        if (filter === 'installed') return a.isInstalled
        return a.category === filter
      })
      const selectedIds = new Set(state.selectedIds)
      for (const app of target) selectedIds.add(app.id)
      return { selectedIds }
    }),
  deselectAll: () => set({ selectedIds: new Set<string>() }),
  reset: () =>
    set({
      apps: [],
      loading: false,
      installing: false,
      cancelled: false,
      progress: null,
      installResult: null,
      error: null,
      hasLoaded: false,
      wingetAvailable: true,
      searchQuery: '',
      categoryFilter: 'all',
      showOnlySelected: false,
      selectedIds: new Set<string>(),
    }),
}))
