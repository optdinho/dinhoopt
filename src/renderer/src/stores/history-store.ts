import { create } from 'zustand'
import type { ScanHistoryEntry } from '@shared/types'

interface HistoryState {
  entries: ScanHistoryEntry[]
  loaded: boolean
  load: () => Promise<void>
  addEntry: (entry: ScanHistoryEntry) => Promise<void>
  clear: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, get) => ({
  entries: [],
  loaded: false,

  load: async () => {
    try {
      const entries = await window.dinho.historyGet()
      set({ entries, loaded: true })
    } catch {
      set({ entries: [], loaded: true })
    }
  },

  addEntry: async (entry) => {
    try {
      await window.dinho.historyAdd(entry)
      set((s) => ({ entries: [entry, ...s.entries].slice(0, 100) }))
    } catch {
      // Silent fail
    }
  },

  clear: async () => {
    try {
      await window.dinho.historyClear()
      set({ entries: [] })
    } catch {
      // Silent fail
    }
  }
}))

// Auto-refresh when main process signals a new entry was added.
// Guard against duplicate listeners on HMR reload.
let _historyListenerRegistered = false
if (!_historyListenerRegistered) {
  _historyListenerRegistered = true
  window.dinho.onHistoryChanged(() => {
    useHistoryStore.getState().load()
  })
}
