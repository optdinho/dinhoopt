import type { MemoryInfo, MemoryOptimizeProgress, MemoryOptimizeResult, MemoryProcess } from '@shared/types'
import { create } from 'zustand'

interface MemoryState {
  info: MemoryInfo | null
  processes: MemoryProcess[]
  loading: boolean
  optimizing: boolean
  error: string | null
  success: string | null
  progress: MemoryOptimizeProgress | null
  result: MemoryOptimizeResult | null
  load: () => Promise<void>
  optimize: () => Promise<void>
  clearError: () => void
  clearSuccess: () => void
  reset: () => void
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  info: null,
  processes: [],
  loading: false,
  optimizing: false,
  error: null,
  success: null,
  progress: null,
  result: null,

  load: async () => {
    set({ loading: true, error: null })
    try {
      const data = await window.dinho.memoryInfo()
      set({ info: data.info, processes: data.processes, loading: false })
    } catch {
      set({ loading: false, error: 'Failed to load memory info' })
    }
  },

  optimize: async () => {
    const { optimizing } = get()
    if (optimizing) return

    set({ optimizing: true, error: null, success: null, progress: null, result: null })

    const unsub = window.dinho.onMemoryProgress((data: MemoryOptimizeProgress) => {
      set({ progress: data })
    })

    try {
      const res = await window.dinho.memoryOptimize()
      if (res.success) {
        const freedMb = (res.freedBytes / 1024 / 1024).toFixed(1)
        set({ success: `Freed ${freedMb} MB`, error: null })
      } else {
        set({ error: res.error || 'Optimization failed', success: null })
      }
      set({ result: res, optimizing: false, progress: null })
      await get().load()
    } catch {
      set({ optimizing: false, progress: null, error: 'Optimization failed' })
    } finally {
      unsub()
    }
  },

  clearError: () => set({ error: null }),
  clearSuccess: () => set({ success: null }),

  reset: () => {
    set({
      info: null,
      processes: [],
      loading: false,
      optimizing: false,
      error: null,
      success: null,
      progress: null,
      result: null,
    })
  },
}))
