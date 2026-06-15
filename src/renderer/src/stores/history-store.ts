import type { ScanHistoryEntry } from '@shared/types'
import { create } from 'zustand'

interface HistoryState {
  entries: ScanHistoryEntry[]
  loaded: boolean
  load: () => Promise<void>
  addEntry: (entry: ScanHistoryEntry) => Promise<void>
  clear: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set, _get) => ({
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
  },
}))

let _historyListenerRegistered = false
if (typeof window !== 'undefined' && window.dinho && !_historyListenerRegistered) {
  _historyListenerRegistered = true
  window.dinho.onHistoryChanged(() => {
    useHistoryStore.getState().load()
  })
}
