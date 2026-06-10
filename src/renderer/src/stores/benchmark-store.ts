import { create } from 'zustand'
import type { BenchmarkResult, BenchmarkProgress } from '@shared/types'

interface BenchmarkStoreState {
  status: 'idle' | 'running' | 'done'
  progress: BenchmarkProgress | null
  result: BenchmarkResult | null

  run: () => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
}

export const useBenchmarkStore = create<BenchmarkStoreState>((set) => ({
  status: 'idle',
  progress: null,
  result: null,

  run: async () => {
    set({ status: 'running', progress: null, result: null })

    const cleanup = window.dinho.onBenchmarkProgress((data) => {
      set({ progress: data })
    })

    try {
      const result = await window.dinho.benchmarkRun()
      set({ status: 'done', result })
    } catch {
      set({ status: 'idle' })
    } finally {
      cleanup()
    }
  },

  cancel: async () => {
    await window.dinho.benchmarkCancel()
    set({ status: 'idle' })
  },

  reset: () => set({ status: 'idle', progress: null, result: null }),
}))
