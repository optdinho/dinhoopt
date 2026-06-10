import { create } from 'zustand'
import type {
  WindowsTweakState,
  WindowsTweakCategory,
  WindowsTweakApplyProgress,
  WindowsTweakResult,
  DnsPreset,
} from '@shared/types'

interface WindowsTweaksStoreState {
  tweaks: WindowsTweakState[]
  dnsPresets: DnsPreset[]
  selectedIds: Set<string>
  scanning: boolean
  applying: boolean
  progress: WindowsTweakApplyProgress | null
  lastResult: WindowsTweakResult | null
  revertResult: WindowsTweakResult | null
  expandedCategories: Set<string>

  load: () => Promise<void>
  loadDnsPresets: () => Promise<void>
  apply: () => Promise<void>
  revert: () => Promise<void>
  toggle: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  toggleCategory: (cat: string) => void
  setDns: (primary: string, secondary?: string) => Promise<boolean>
}

const defaultProgress: WindowsTweakApplyProgress = { current: 0, total: 0, currentTweak: '' }

export const useWindowsTweaksStore = create<WindowsTweaksStoreState>((set, get) => ({
  tweaks: [],
  dnsPresets: [],
  selectedIds: new Set(),
  scanning: false,
  applying: false,
  progress: null,
  lastResult: null,
  revertResult: null,
  expandedCategories: new Set(['mouse', 'network', 'system', 'gaming']),

  load: async () => {
    set({ scanning: true })
    try {
      const tweaks = await window.dinho.windowsTweaksStatus()
      set({ tweaks, scanning: false })
    } catch {
      set({ scanning: false })
    }
  },

  loadDnsPresets: async () => {
    try {
      const dnsPresets = await window.dinho.windowsTweaksGetDnsPresets()
      set({ dnsPresets })
    } catch { /* ignore */ }
  },

  apply: async () => {
    const { selectedIds } = get()
    if (selectedIds.size === 0) return

    set({ applying: true, progress: defaultProgress, lastResult: null })

    const cleanup = window.dinho.onWindowsTweaksApplyProgress((data) => {
      set({ progress: data })
    })

    try {
      const result = await window.dinho.windowsTweaksApply([...selectedIds])
      set({ lastResult: result, applying: false, selectedIds: new Set() })
      get().load()
    } catch {
      set({ applying: false })
    } finally {
      cleanup()
    }
  },

  revert: async () => {
    const { selectedIds } = get()
    if (selectedIds.size === 0) return

    set({ applying: true, progress: defaultProgress })

    const cleanup = window.dinho.onWindowsTweaksRevertProgress((data) => {
      set({ progress: data })
    })

    try {
      const result = await window.dinho.windowsTweaksRevert([...selectedIds])
      set({ revertResult: result, applying: false, selectedIds: new Set() })
      get().load()
    } catch {
      set({ applying: false })
    } finally {
      cleanup()
    }
  },

  toggle: (id) => set((s) => {
    const sel = new Set(s.selectedIds)
    if (sel.has(id)) sel.delete(id)
    else sel.add(id)
    return { selectedIds: sel }
  }),

  selectAll: () => set((s) => ({
    selectedIds: new Set(s.tweaks.filter((t) => !t.applied).map((t) => t.tweak.id))
  })),

  deselectAll: () => set({ selectedIds: new Set() }),

  toggleCategory: (cat) => set((s) => {
    const next = new Set(s.expandedCategories)
    if (next.has(cat)) next.delete(cat)
    else next.add(cat)
    return { expandedCategories: next }
  }),

  setDns: async (primary, secondary) => {
    try {
      return await window.dinho.windowsTweaksSetDns(primary, secondary)
    } catch {
      return false
    }
  },
}))
