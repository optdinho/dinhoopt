import { create } from 'zustand'
import type {
  WindowsService,
  ServiceScanProgress,
  ServiceApplyResult,
  ServiceSafety,
  ServiceCategory
} from '@shared/types'
import { isGameCompatible } from '@shared/service-safety-kb'

interface ServiceState {
  services: WindowsService[]
  scanning: boolean
  applying: boolean
  scanProgress: ServiceScanProgress | null
  applyResult: ServiceApplyResult | null
  error: string | null
  hasScanned: boolean

  // Filters
  searchQuery: string
  safetyFilter: 'all' | ServiceSafety
  categoryFilter: 'all' | ServiceCategory
  statusFilter: 'all' | 'running' | 'stopped' | 'disabled'

  // Actions
  setServices: (services: WindowsService[]) => void
  setScanning: (scanning: boolean) => void
  setApplying: (applying: boolean) => void
  setScanProgress: (progress: ServiceScanProgress | null) => void
  setApplyResult: (result: ServiceApplyResult | null) => void
  setError: (error: string | null) => void
  setHasScanned: (hasScanned: boolean) => void

  setSearchQuery: (query: string) => void
  setSafetyFilter: (filter: 'all' | ServiceSafety) => void
  setCategoryFilter: (filter: 'all' | ServiceCategory) => void
  setStatusFilter: (filter: 'all' | 'running' | 'stopped' | 'disabled') => void

  toggleService: (name: string) => void
  selectRecommended: (gameName?: string) => void
  deselectAll: () => void
  reset: () => void
  scan: () => Promise<void>
  apply: () => Promise<void>
}

export const useServiceStore = create<ServiceState>((set, get) => ({
  services: [],
  scanning: false,
  applying: false,
  scanProgress: null,
  applyResult: null,
  error: null,
  hasScanned: false,

  searchQuery: '',
  safetyFilter: 'all',
  categoryFilter: 'all',
  statusFilter: 'all',

  setServices: (services) => set({ services }),
  setScanning: (scanning) => set({ scanning }),
  setApplying: (applying) => set({ applying }),
  setScanProgress: (scanProgress) => set({ scanProgress }),
  setApplyResult: (applyResult) => set({ applyResult }),
  setError: (error) => set({ error }),
  setHasScanned: (hasScanned) => set({ hasScanned }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),
  setSafetyFilter: (safetyFilter) => set({ safetyFilter }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),

  toggleService: (name) =>
    set((s) => ({
      services: s.services.map((svc) =>
        svc.name === name && svc.safety !== 'unsafe'
          ? { ...svc, selected: !svc.selected }
          : svc
      )
    })),

  selectRecommended: (gameName?: string) =>
    set((s) => ({
      services: s.services.map((svc) => {
        if (svc.safety !== 'safe') return { ...svc, selected: false }
        if (svc.startType === 'Disabled') return { ...svc, selected: false }
        if (gameName && !isGameCompatible(svc.name, gameName)) return { ...svc, selected: false }
        return { ...svc, selected: true }
      })
    })),

  deselectAll: () =>
    set((s) => ({
      services: s.services.map((svc) => ({ ...svc, selected: false }))
    })),

  reset: () =>
    set({
      services: [],
      scanning: false,
      applying: false,
      scanProgress: null,
      applyResult: null,
      error: null,
      hasScanned: false,
      searchQuery: '',
      safetyFilter: 'all',
      categoryFilter: 'all',
      statusFilter: 'all'
    }),

  scan: async () => {
    set({ scanning: true, scanProgress: null, error: null })

    const cleanup = window.dinho.onServiceProgress((data) => {
      set({ scanProgress: data })
    })

    try {
      const result = await window.dinho.serviceScan()
      set({ services: result.services, scanning: false, hasScanned: true })
    } catch {
      set({ scanning: false })
    } finally {
      cleanup()
    }
  },

  apply: async () => {
    const s = get()
    const changes = s.services
      .filter((svc) => svc.selected && svc.startType !== svc.originalStartType)
      .map((svc) => ({ name: svc.name, targetStartType: svc.startType }))
    if (changes.length === 0) return

    set({ applying: true, applyResult: null, error: null })

    try {
      const result = await window.dinho.serviceApply(changes)
      const scanResult = await window.dinho.serviceScan()
      set({ services: scanResult.services, applyResult: result, applying: false })
    } catch {
      set({ applying: false })
    }
  }
}))
