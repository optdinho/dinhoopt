import type {
  DriverCleanResult,
  DriverPackage,
  DriverScanProgress,
  DriverUpdate,
  DriverUpdateInstallResult,
  DriverUpdateProgress,
} from '@shared/types'
import { create } from 'zustand'

interface DriverState {
  // Stale packages
  packages: DriverPackage[]
  scanning: boolean
  scanProgress: DriverScanProgress | null
  cleaning: boolean
  cleanResult: DriverCleanResult | null
  error: string | null
  totalStaleSize: number

  // Updates
  updates: DriverUpdate[]
  updateScanning: boolean
  updateProgress: DriverUpdateProgress | null
  installing: boolean
  installResult: DriverUpdateInstallResult | null
  updateError: string | null

  // All installed drivers (with isUpToDate flag)
  allDrivers: DriverUpdate[]
  showUpToDateDrivers: boolean

  // Combined
  applying: boolean
  hasScanned: boolean

  // Actions
  setPackages: (packages: DriverPackage[]) => void
  setScanning: (scanning: boolean) => void
  setScanProgress: (progress: DriverScanProgress | null) => void
  setCleaning: (cleaning: boolean) => void
  setCleanResult: (result: DriverCleanResult | null) => void
  setError: (error: string | null) => void
  setTotalStaleSize: (size: number) => void
  togglePackage: (id: string) => void
  selectAllStale: () => void
  deselectAllStale: () => void

  setUpdates: (updates: DriverUpdate[]) => void
  setUpdateScanning: (scanning: boolean) => void
  setUpdateProgress: (progress: DriverUpdateProgress | null) => void
  setInstalling: (installing: boolean) => void
  setInstallResult: (result: DriverUpdateInstallResult | null) => void
  setUpdateError: (error: string | null) => void
  toggleUpdate: (id: string) => void
  selectAllUpdates: () => void
  deselectAllUpdates: () => void

  setAllDrivers: (drivers: DriverUpdate[]) => void
  setShowUpToDateDrivers: (show: boolean) => void

  setApplying: (applying: boolean) => void
  setHasScanned: (hasScanned: boolean) => void
  reset: () => void
  scan: () => Promise<void>
  clean: () => Promise<void>
  updateScan: () => Promise<void>
  updateInstall: () => Promise<void>
}

export const useDriverStore = create<DriverState>((set, get) => ({
  packages: [],
  scanning: false,
  scanProgress: null,
  cleaning: false,
  cleanResult: null,
  error: null,
  totalStaleSize: 0,
  updates: [],
  updateScanning: false,
  updateProgress: null,
  installing: false,
  installResult: null,
  updateError: null,
  allDrivers: [],
  showUpToDateDrivers: false,
  applying: false,
  hasScanned: false,

  setPackages: (packages) => set({ packages }),
  setScanning: (scanning) => set({ scanning }),
  setScanProgress: (scanProgress) => set({ scanProgress }),
  setCleaning: (cleaning) => set({ cleaning }),
  setCleanResult: (cleanResult) => set({ cleanResult }),
  setError: (error) => set({ error }),
  setTotalStaleSize: (totalStaleSize) => set({ totalStaleSize }),
  togglePackage: (id) =>
    set((s) => ({
      packages: s.packages.map((p) => (p.id === id && !p.isCurrent ? { ...p, selected: !p.selected } : p)),
    })),
  selectAllStale: () =>
    set((s) => ({
      packages: s.packages.map((p) => (!p.isCurrent ? { ...p, selected: true } : p)),
    })),
  deselectAllStale: () =>
    set((s) => ({
      packages: s.packages.map((p) => (!p.isCurrent ? { ...p, selected: false } : p)),
    })),

  setUpdates: (updates) => set({ updates }),
  setUpdateScanning: (updateScanning) => set({ updateScanning }),
  setUpdateProgress: (updateProgress) => set({ updateProgress }),
  setInstalling: (installing) => set({ installing }),
  setInstallResult: (installResult) => set({ installResult }),
  setUpdateError: (updateError) => set({ updateError }),
  toggleUpdate: (id) =>
    set((s) => ({
      updates: s.updates.map((u) => (u.id === id ? { ...u, selected: !u.selected } : u)),
    })),
  selectAllUpdates: () =>
    set((s) => ({
      updates: s.updates.map((u) => ({ ...u, selected: true })),
    })),
  deselectAllUpdates: () =>
    set((s) => ({
      updates: s.updates.map((u) => ({ ...u, selected: false })),
    })),

  setAllDrivers: (allDrivers) => set({ allDrivers }),
  setShowUpToDateDrivers: (showUpToDateDrivers) => set({ showUpToDateDrivers }),

  setApplying: (applying) => set({ applying }),
  setHasScanned: (hasScanned) => set({ hasScanned }),
  reset: () =>
    set({
      packages: [],
      scanning: false,
      scanProgress: null,
      cleaning: false,
      cleanResult: null,
      error: null,
      totalStaleSize: 0,
      updates: [],
      updateScanning: false,
      updateProgress: null,
      installing: false,
      installResult: null,
      updateError: null,
      allDrivers: [],
      showUpToDateDrivers: false,
      applying: false,
      hasScanned: false,
    }),

  scan: async () => {
    set({ scanning: true, scanProgress: null, error: null })

    const cleanup = window.dinho.onDriverProgress((data) => {
      set({ scanProgress: data })
    })

    try {
      const result = await window.dinho.driverScan()
      set({
        packages: result.packages.map((p) => ({ ...p, selected: p.isCurrent ? false : p.selected })),
        totalStaleSize: result.totalStaleSize,
        scanning: false,
        hasScanned: true,
      })
    } catch {
      set({ scanning: false })
    } finally {
      cleanup()
    }
  },

  clean: async () => {
    const s = get()
    const selectedNames = s.packages.filter((p) => p.selected && !p.isCurrent).map((p) => p.publishedName)
    if (selectedNames.length === 0) return

    set({ cleaning: true, cleanResult: null, error: null })

    try {
      const result = await window.dinho.driverClean(selectedNames)
      set({ cleanResult: result, cleaning: false })
      get().scan()
    } catch {
      set({ cleaning: false })
    }
  },

  updateScan: async () => {
    set({ updateScanning: true, updateProgress: null, updateError: null })

    const cleanup = window.dinho.onDriverUpdateProgress((data) => {
      set({ updateProgress: data })
    })

    try {
      const result = await window.dinho.driverUpdateScan()
      set({
        updates: result.updates.map((u) => ({ ...u, selected: false })),
        allDrivers: result.allDrivers || [],
        updateScanning: false,
        hasScanned: true,
      })
    } catch {
      set({ updateScanning: false })
    } finally {
      cleanup()
    }
  },

  updateInstall: async () => {
    const s = get()
    const selectedIds = s.updates.filter((u) => u.selected).map((u) => u.updateId)
    if (selectedIds.length === 0) return

    set({ installing: true, installResult: null, updateError: null })

    try {
      const result = await window.dinho.driverUpdateInstall(selectedIds)
      set({ installResult: result, installing: false })
      get().updateScan()
    } catch {
      set({ installing: false })
    }
  },
}))
