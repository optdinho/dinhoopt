import type {
  CurrentDns,
  DnsBenchmarkResult,
  DnsPreset,
  GamingTimerStatus,
  WindowsTweakApplyProgress,
  WindowsTweakResult,
  WindowsTweakState,
} from '@shared/types'
import { create } from 'zustand'
import logger from '@/lib/renderer-logger'

interface WindowsTweaksStoreState {
  tweaks: WindowsTweakState[]
  dnsPresets: DnsPreset[]
  dnsBenchmark: DnsBenchmarkResult[]
  dnsBenchmarking: boolean
  currentDns: CurrentDns
  selectedIds: Set<string>
  scanning: boolean
  applying: boolean
  progress: WindowsTweakApplyProgress | null
  lastResult: WindowsTweakResult | null
  revertResult: WindowsTweakResult | null
  expandedCategories: Set<string>
  gamingTimer: GamingTimerStatus | null
  gamingTimerLoading: boolean
  /** A leitura do catálogo falhou (a lista vazia não significa "sem tweaks"). */
  loadError: boolean
  /** A leitura das predefinições DNS falhou. */
  dnsPresetsError: boolean
  /** A medição DNS falhou (lista vazia seria enganadora). */
  dnsBenchmarkError: boolean
  /** A leitura do DNS em uso falhou. */
  currentDnsError: boolean

  load: () => Promise<void>
  loadDnsPresets: () => Promise<void>
  benchmarkDns: () => Promise<void>
  loadCurrentDns: () => Promise<void>
  apply: () => Promise<void>
  revert: () => Promise<void>
  toggle: (id: string) => void
  selectAll: () => void
  deselectAll: () => void
  toggleCategory: (cat: string) => void
  setDns: (primary: string, secondary?: string) => Promise<boolean>
  netshTcpApply: () => Promise<{ success: boolean; error?: string }>
  netshTcpRevert: () => Promise<{ success: boolean; error?: string }>
  loadGamingTimer: () => Promise<void>
  setGamingTimer: (
    settings: Partial<Pick<GamingTimerStatus, 'hpetOff' | 'tscSyncPolicy' | 'dynamicTickDisabled'>>,
  ) => Promise<{ success: boolean; errors: string[] }>
  revertGamingTimer: () => Promise<{ success: boolean; errors: string[] }>
  setAutoTuning: (action: 'apply' | 'revert') => Promise<{ success: boolean; error?: string }>
}

const defaultProgress: WindowsTweakApplyProgress = { current: 0, total: 0, currentTweak: '' }

export const useWindowsTweaksStore = create<WindowsTweaksStoreState>((set, get) => ({
  tweaks: [],
  dnsPresets: [],
  dnsBenchmark: [],
  dnsBenchmarking: false,
  currentDns: { primary: null, secondary: null, source: 'none' } as CurrentDns,
  selectedIds: new Set(),
  scanning: false,
  applying: false,
  progress: null,
  lastResult: null,
  revertResult: null,
  expandedCategories: new Set(),
  gamingTimer: null,
  gamingTimerLoading: false,
  loadError: false,
  dnsPresetsError: false,
  dnsBenchmarkError: false,
  currentDnsError: false,

  load: async () => {
    set({ scanning: true })
    try {
      const tweaks = await window.dinho.windowsTweaksStatus()
      set({ tweaks, scanning: false, loadError: false })
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to load tweaks', err)
      set({ scanning: false, loadError: true })
    }
  },

  loadDnsPresets: async () => {
    try {
      const dnsPresets = await window.dinho.windowsTweaksGetDnsPresets()
      set({ dnsPresets, dnsPresetsError: false })
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to load DNS presets', err)
      set({ dnsPresetsError: true })
    }
  },

  benchmarkDns: async () => {
    if (get().dnsBenchmarking) return
    set({ dnsBenchmarking: true })
    try {
      const results = await window.dinho.windowsTweaksBenchmarkDns()
      set({ dnsBenchmark: results, dnsBenchmarkError: false })
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to benchmark DNS', err)
      set({ dnsBenchmark: [], dnsBenchmarkError: true })
    } finally {
      set({ dnsBenchmarking: false })
    }
  },

  loadCurrentDns: async () => {
    try {
      const currentDns = await window.dinho.windowsTweaksCurrentDns()
      set({ currentDns, currentDnsError: false })
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to read current DNS', err)
      set({ currentDnsError: true })
    }
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

  toggle: (id) =>
    set((s) => {
      const sel = new Set(s.selectedIds)
      if (sel.has(id)) sel.delete(id)
      else sel.add(id)
      return { selectedIds: sel }
    }),

  selectAll: () =>
    set((s) => ({
      selectedIds: new Set(s.tweaks.filter((t) => !t.applied).map((t) => t.tweak.id)),
    })),

  deselectAll: () => set({ selectedIds: new Set() }),

  toggleCategory: (cat) =>
    set((s) => {
      const next = new Set(s.expandedCategories)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return { expandedCategories: next }
    }),

  setDns: async (primary, secondary) => {
    try {
      const ok = await window.dinho.windowsTweaksSetDns(primary, secondary)
      if (ok) await get().loadCurrentDns()
      return ok
    } catch {
      return false
    }
  },

  netshTcpApply: async () => {
    try {
      return await window.dinho.windowsTweaksNetshTcp('apply')
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to apply netsh TCP tweaks', err)
      return { success: false }
    }
  },

  netshTcpRevert: async () => {
    try {
      return await window.dinho.windowsTweaksNetshTcp('revert')
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to revert netsh TCP tweaks', err)
      return { success: false }
    }
  },

  loadGamingTimer: async () => {
    set({ gamingTimerLoading: true })
    try {
      const gamingTimer = await window.dinho.gamingTimerGet()
      set({ gamingTimer, gamingTimerLoading: false })
    } catch (err) {
      // Não fabricar um estado "saudável": a UI mostra a falha (timerLoadFailed)
      // em vez de sugerir que o timer já está no default.
      logger.error('windows-tweaks-store', 'Failed to load gaming timer status', err)
      set({ gamingTimer: null, gamingTimerLoading: false })
    }
  },

  setGamingTimer: async (settings) => {
    try {
      const result = await window.dinho.gamingTimerSet(settings)
      if (result.success) get().loadGamingTimer()
      return result
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to set gaming timer settings', err)
      return { success: false, errors: [] }
    }
  },

  revertGamingTimer: async () => {
    try {
      const result = await window.dinho.gamingTimerRevert()
      if (result.success) get().loadGamingTimer()
      return result
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to revert gaming timer settings', err)
      return { success: false, errors: [] }
    }
  },

  setAutoTuning: async (action) => {
    try {
      const result = await window.dinho.gamingAutoTuning(action)
      if (result.success) get().loadGamingTimer()
      return result
    } catch (err) {
      logger.error('windows-tweaks-store', 'Failed to set TCP auto-tuning', err)
      return { success: false }
    }
  },
}))
