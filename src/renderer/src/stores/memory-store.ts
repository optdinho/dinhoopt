import type { MemoryInfo, MemoryOptimizeProgress, MemoryOptimizeResult, MemoryProcess } from '@shared/types'
import { create } from 'zustand'
import logger from '@/lib/renderer-logger'

/** Falha do carregamento inicial (`load`) ou da operação de otimização. */
export type MemoryErrorKind = 'load' | 'optimize'

interface MemorySuccess {
  freedBytes: number
  /** Um ou mais passos falharam, mas a operação libertou memória. */
  partial: boolean
}

interface MemoryState {
  info: MemoryInfo | null
  processes: MemoryProcess[]
  loading: boolean
  optimizing: boolean
  errorKind: MemoryErrorKind | null
  success: MemorySuccess | null
  progress: MemoryOptimizeProgress | null
  result: MemoryOptimizeResult | null
  load: () => Promise<void>
  optimize: () => Promise<void>
  clearError: () => void
  clearSuccess: () => void
}

export const useMemoryStore = create<MemoryState>((set, get) => ({
  info: null,
  processes: [],
  loading: false,
  optimizing: false,
  errorKind: null,
  success: null,
  progress: null,
  result: null,

  load: async () => {
    set({ loading: true, errorKind: null })
    try {
      const data = await window.dinho.memoryInfo()
      set({ info: data.info, processes: data.processes, loading: false })
    } catch (err) {
      logger.error('memory-store', 'Failed to load memory info', err)
      set({ loading: false, errorKind: 'load' })
    }
  },

  optimize: async () => {
    const { optimizing } = get()
    if (optimizing) return

    set({ optimizing: true, errorKind: null, success: null, progress: null, result: null })

    const unsub = window.dinho.onMemoryProgress((data: MemoryOptimizeProgress) => {
      set({ progress: data })
    })

    try {
      const res = await window.dinho.memoryOptimize()
      if (res.success) {
        set({
          success: { freedBytes: res.freedBytes, partial: res.steps.some((s) => !s.success) },
          errorKind: null,
        })
      } else {
        set({ success: null, errorKind: 'optimize' })
      }
      set({ result: res, optimizing: false, progress: null })

      // Refresh dos números mostrados sem deixar uma falha de leitura competir
      // com o resultado da operação (uma leitura falhada é registada, não exibida).
      try {
        const data = await window.dinho.memoryInfo()
        set({ info: data.info, processes: data.processes })
      } catch (err) {
        logger.error('memory-store', 'Failed to refresh memory info after optimization', err)
      }
    } catch (err) {
      logger.error('memory-store', 'Memory optimization failed', err)
      set({ optimizing: false, progress: null, errorKind: 'optimize' })
    } finally {
      unsub()
    }
  },

  clearError: () => set({ errorKind: null }),
  clearSuccess: () => set({ success: null }),
}))
