import type { AgentEvaluationResult } from '@shared/driver-agent-types'
import { create } from 'zustand'

interface DriverAgentState {
  result: AgentEvaluationResult | null
  evaluating: boolean
  installing: boolean
  error: string | null
  installResult: { success: boolean; error?: string; rebootRequired?: boolean } | null

  evaluate: () => Promise<void>
  approveSelected: () => Promise<void>
  toggleCandidate: (updateId: string) => void
  approveAll: () => void
  clearAll: () => void
  getSelectedIds: () => string[]
  reset: () => void
}

export const useDriverAgentStore = create<DriverAgentState>((set, get) => ({
  result: null,
  evaluating: false,
  installing: false,
  error: null,
  installResult: null,

  evaluate: async () => {
    set({ evaluating: true, error: null, installResult: null })
    try {
      const result = await window.dinho.driverAgentEvaluate()
      set({ result, evaluating: false })
    } catch (err) {
      set({
        evaluating: false,
        error: err instanceof Error ? err.message : 'Falha na avaliação dos agentes',
      })
    }
  },

  approveSelected: async () => {
    const ids = get().getSelectedIds()
    if (ids.length === 0) return

    set({ installing: true, installResult: null, error: null })
    try {
      const result = await window.dinho.driverAgentApprove(ids)
      set({ installing: false, installResult: result })

      if (result.success) {
        const r = get().result
        if (r) {
          set({
            result: {
              ...r,
              candidates: r.candidates.filter((c) => !ids.includes(c.updateId)),
              totalCandidates: r.totalCandidates - ids.length,
            },
          })
        }
      }
    } catch (err) {
      set({
        installing: false,
        error: err instanceof Error ? err.message : 'Falha na instalação',
      })
    }
  },

  toggleCandidate: (updateId: string) => {
    const r = get().result
    if (!r) return
    set({
      result: {
        ...r,
        candidates: r.candidates.map((c) => (c.updateId === updateId ? { ...c, approved: !c.approved } : c)),
      },
    })
  },

  approveAll: () => {
    const r = get().result
    if (!r) return
    set({
      result: {
        ...r,
        candidates: r.candidates.map((c) => ({
          ...c,
          approved: c.consensusLabel !== 'skip',
        })),
      },
    })
  },

  clearAll: () => {
    const r = get().result
    if (!r) return
    set({
      result: {
        ...r,
        candidates: r.candidates.map((c) => ({ ...c, approved: false })),
      },
    })
  },

  getSelectedIds: () => {
    const r = get().result
    if (!r) return []
    return r.candidates.filter((c) => c.approved).map((c) => c.updateId)
  },

  reset: () =>
    set({
      result: null,
      evaluating: false,
      installing: false,
      error: null,
      installResult: null,
    }),
}))
