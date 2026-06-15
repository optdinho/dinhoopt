import type { HostsEntry, HostsFileData } from '@shared/types'
import { create } from 'zustand'

interface WriteResult {
  success: boolean
  error?: string
}

interface FlushResult {
  success: boolean
  error?: string
}

interface HostsEditorState {
  entries: HostsEntry[]
  headerComment: string
  originalEntries: HostsEntry[]
  originalHeaderComment: string
  status: 'idle' | 'reading' | 'writing' | 'flushing' | 'complete' | 'error'
  error: string | null
  readResult: HostsFileData | null
  writeResult: WriteResult | null
  flushResult: FlushResult | null

  setEntries: (entries: HostsEntry[]) => void
  setHeaderComment: (headerComment: string) => void
  setStatus: (status: HostsEditorState['status']) => void
  setError: (error: string | null) => void
  setReadResult: (result: HostsFileData | null) => void
  setWriteResult: (result: WriteResult | null) => void
  setFlushResult: (result: FlushResult | null) => void
  setOriginal: (entries: HostsEntry[], headerComment: string) => void
  revert: () => void
  toggleEntry: (id: string) => void
  updateEntry: (id: string, fields: Partial<Pick<HostsEntry, 'ip' | 'hostname' | 'comment' | 'enabled'>>) => void
  addEntry: () => void
  setBulkEntries: (entries: HostsEntry[]) => void
  removeEntry: (id: string) => void
  reset: () => void
}

export const useHostsEditorStore = create<HostsEditorState>((set, _get) => ({
  entries: [],
  headerComment: '',
  originalEntries: [],
  originalHeaderComment: '',
  status: 'idle',
  error: null,
  readResult: null,
  writeResult: null,
  flushResult: null,

  setEntries: (entries) => set({ entries }),
  setHeaderComment: (headerComment) => set({ headerComment }),
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error }),
  setReadResult: (readResult) => set({ readResult }),
  setWriteResult: (writeResult) => set({ writeResult }),
  setFlushResult: (flushResult) => set({ flushResult }),

  setOriginal: (entries, headerComment) => set({ originalEntries: entries, originalHeaderComment: headerComment }),

  revert: () =>
    set((s) => ({
      entries: s.originalEntries.map((e) => ({ ...e })),
      headerComment: s.originalHeaderComment,
    })),

  toggleEntry: (id) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, enabled: !e.enabled } : e)),
    })),

  updateEntry: (id, fields) =>
    set((s) => ({
      entries: s.entries.map((e) => (e.id === id ? { ...e, ...fields } : e)),
    })),

  addEntry: () =>
    set((s) => ({
      entries: [...s.entries, { id: crypto.randomUUID(), ip: '', hostname: '', comment: '', enabled: true }],
    })),

  setBulkEntries: (newEntries) =>
    set((s) => {
      const existing = new Set(s.entries.map((e) => e.hostname.toLowerCase()))
      const unique = newEntries.filter((e) => !existing.has(e.hostname.toLowerCase()))
      if (unique.length === 0) return s
      return {
        entries: [...s.entries, ...unique.map((e) => ({ ...e, id: crypto.randomUUID() }))],
      }
    }),

  removeEntry: (id) =>
    set((s) => ({
      entries: s.entries.filter((e) => e.id !== id),
    })),

  reset: () =>
    set({
      entries: [],
      headerComment: '',
      originalEntries: [],
      originalHeaderComment: '',
      status: 'idle',
      error: null,
      readResult: null,
      writeResult: null,
      flushResult: null,
    }),
}))
