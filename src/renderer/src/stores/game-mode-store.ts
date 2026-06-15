import type {
  GameModeAuditReport,
  GameModeConfig,
  GameModeOptimizationId,
  GameModeProgress,
  GameProfile,
} from '@shared/types'
import { create } from 'zustand'

interface GameModeStoreState {
  // Status
  active: boolean
  activatedAt: string | null
  pendingRestore: boolean

  // UI state
  status: 'idle' | 'activating' | 'deactivating'
  progress: GameModeProgress | null
  lastResult: { type: 'activate' | 'deactivate'; succeeded: number; failed: number } | null

  // Auto-detect
  detectedGame: string | null

  // Audit
  auditReport: GameModeAuditReport | null
  auditPhase: 'idle' | 'running'

  // Config (user preferences)
  config: GameModeConfig
  expandedCategories: Set<string>

  // Actions
  setActive: (active: boolean, activatedAt: string | null) => void
  setPendingRestore: (pending: boolean) => void
  setStatus: (status: 'idle' | 'activating' | 'deactivating') => void
  setProgress: (progress: GameModeProgress | null) => void
  setLastResult: (result: { type: 'activate' | 'deactivate'; succeeded: number; failed: number } | null) => void
  setDetectedGame: (name: string | null) => void
  setConfig: (config: GameModeConfig) => void
  toggleOptimization: (id: GameModeOptimizationId) => void
  toggleCategory: (category: string) => void
  setCustomProcessKillList: (list: string[]) => void
  setAutoDetect: (enabled: boolean) => void
  setAutoDeactivate: (enabled: boolean) => void
  setCustomGameProcesses: (list: string[]) => void
  setGameProfile: (processName: string, profile: GameProfile | null) => void
  runAudit: (phase: GameModeAuditReport['phase']) => Promise<void>
  clearAuditReport: () => void
}

const defaultConfig: GameModeConfig = {
  enabledOptimizations: [
    'svc-wsearch',
    'svc-sysmain',
    'proc-kill-updaters',
    'mem-clear-standby',
    'sys-focus-assist',
    'sys-power-plan',
    'sys-prevent-sleep',
    'sys-timer-resolution',
    'cpu-game-priority',
    'sys-disable-game-bar',
    'sys-disable-fse-opt',
    'net-flush-dns',
  ],
  customProcessKillList: [],
  autoDetect: false,
  autoDeactivate: true,
  customGameProcesses: [],
  gameProfiles: {},
}

export const useGameModeStore = create<GameModeStoreState>((set, get) => ({
  active: false,
  activatedAt: null,
  pendingRestore: false,

  status: 'idle',
  progress: null,
  lastResult: null,

  detectedGame: null,

  auditReport: null,
  auditPhase: 'idle',

  config: defaultConfig,
  expandedCategories: new Set<string>(),

  setActive: (active, activatedAt) => set({ active, activatedAt }),
  setPendingRestore: (pendingRestore) => set({ pendingRestore }),
  setStatus: (status) => set({ status }),
  setProgress: (progress) => set({ progress }),
  setLastResult: (lastResult) => set({ lastResult }),
  setDetectedGame: (detectedGame) => set({ detectedGame }),
  setConfig: (config) => set({ config }),

  runAudit: async (phase) => {
    set({ auditPhase: 'running' })
    try {
      const report = await window.dinho.gameModeRunAudit(phase)
      set({ auditReport: report, auditPhase: 'idle' })
    } catch {
      set({ auditPhase: 'idle' })
    }
  },

  clearAuditReport: () => set({ auditReport: null }),

  toggleOptimization: (id) => {
    const { config } = get()
    const enabled = config.enabledOptimizations.includes(id)
    const updated: GameModeConfig = {
      ...config,
      enabledOptimizations: enabled
        ? config.enabledOptimizations.filter((o) => o !== id)
        : [...config.enabledOptimizations, id],
    }
    set({ config: updated })
    window.dinho?.settingsSet?.({ gameMode: updated }).catch(() => {})
  },

  toggleCategory: (category) =>
    set((s) => {
      const next = new Set(s.expandedCategories)
      if (next.has(category)) next.delete(category)
      else next.add(category)
      return { expandedCategories: next }
    }),

  setCustomProcessKillList: (list) => {
    const { config } = get()
    const updated: GameModeConfig = { ...config, customProcessKillList: list }
    set({ config: updated })
    window.dinho?.settingsSet?.({ gameMode: updated }).catch(() => {})
  },

  setAutoDetect: (enabled) => {
    const { config } = get()
    const updated: GameModeConfig = { ...config, autoDetect: enabled }
    set({ config: updated })
    window.dinho?.settingsSet?.({ gameMode: updated }).catch(() => {})
  },

  setAutoDeactivate: (enabled) => {
    const { config } = get()
    const updated: GameModeConfig = { ...config, autoDeactivate: enabled }
    set({ config: updated })
    window.dinho?.settingsSet?.({ gameMode: updated }).catch(() => {})
  },

  setCustomGameProcesses: (list) => {
    const { config } = get()
    const updated: GameModeConfig = { ...config, customGameProcesses: list }
    set({ config: updated })
    window.dinho?.settingsSet?.({ gameMode: updated }).catch(() => {})
  },

  setGameProfile: (processName, profile) => {
    const { config } = get()
    const profiles = { ...config.gameProfiles }
    if (profile === null) {
      delete profiles[processName]
    } else {
      profiles[processName] = profile
    }
    const updated: GameModeConfig = { ...config, gameProfiles: profiles }
    set({ config: updated })
    window.dinho?.settingsSet?.({ gameMode: updated }).catch(() => {})
  },
}))

/** Hydrate config from persisted settings and check active status */
export function initGameModeStore(): void {
  window.dinho
    ?.settingsGet?.()
    .then((settings) => {
      if (settings?.gameMode) {
        useGameModeStore.getState().setConfig(settings.gameMode)
      }
    })
    .catch(() => {})

  window.dinho
    ?.gameModeStatus?.()
    .then((status) => {
      const s = useGameModeStore.getState()
      s.setActive(status.active, status.activatedAt)
      s.setPendingRestore(status.pendingRestore ?? false)
    })
    .catch(() => {})

  // Listen for auto-detect events globally so the store stays in sync
  // even when the user is on a different page.
  window.dinho?.onGameModeAutoEvent?.((event) => {
    const s = useGameModeStore.getState()
    if (event.type === 'game-detected') {
      s.setDetectedGame(event.processName)
    } else {
      s.setDetectedGame(null)
    }
    // Refresh active status from main process (source of truth)
    window.dinho
      ?.gameModeStatus?.()
      .then((status) => {
        const st = useGameModeStore.getState()
        st.setActive(status.active, status.activatedAt)
        st.setPendingRestore(status.pendingRestore ?? false)
      })
      .catch(() => {})
  })
}
