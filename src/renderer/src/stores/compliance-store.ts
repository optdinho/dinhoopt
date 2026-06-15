import type { ComplianceApplyResult, ComplianceScanProgress, ComplianceState } from '@shared/types'
import { create } from 'zustand'

interface ComplianceStoreState {
  state: ComplianceState | null
  status: 'idle' | 'scanning' | 'applying' | 'done'
  applyResult: ComplianceApplyResult | null
  expandedCategories: Set<string>
  progress: ComplianceScanProgress | null

  setState: (state: ComplianceState | null) => void
  setStatus: (status: 'idle' | 'scanning' | 'applying' | 'done') => void
  setApplyResult: (result: ComplianceApplyResult | null) => void
  setExpandedCategories: (categories: Set<string>) => void
  toggleCategory: (id: string) => void
  setProgress: (progress: ComplianceScanProgress | null) => void
  reset: () => void
  scan: () => Promise<void>
  apply: (ids: string[]) => Promise<void>
  revert: (ids: string[]) => Promise<void>
}

export const useComplianceStore = create<ComplianceStoreState>((set) => ({
  state: null,
  status: 'idle',
  applyResult: null,
  expandedCategories: new Set<string>(),
  progress: null,

  setState: (state) => set({ state }),
  setStatus: (status) => set({ status }),
  setApplyResult: (applyResult) => set({ applyResult }),
  setExpandedCategories: (expandedCategories) => set({ expandedCategories }),
  toggleCategory: (id) =>
    set((s) => {
      const next = new Set(s.expandedCategories)
      next.has(id) ? next.delete(id) : next.add(id)
      return { expandedCategories: next }
    }),
  setProgress: (progress) => set({ progress }),
  reset: () =>
    set({
      state: null,
      status: 'idle',
      applyResult: null,
      expandedCategories: new Set<string>(),
      progress: null,
    }),

  scan: async () => {
    set({ status: 'scanning', progress: null })
    const cleanup = window.dinho.onComplianceProgress((data) => {
      set({ progress: data })
    })
    try {
      const compState = await window.dinho.complianceScan()
      set({ state: compState, status: 'done' })
    } catch {
      set({ status: 'idle' })
    } finally {
      cleanup()
    }
  },

  apply: async (ids) => {
    set({ status: 'applying', applyResult: null })
    try {
      const result = await window.dinho.complianceApply(ids)
      const updated = await window.dinho.complianceScan()
      set({ state: updated, applyResult: result, status: 'done' })
    } catch {
      set({ status: 'done' })
    }
  },

  revert: async (ids) => {
    set({ status: 'applying', applyResult: null })
    try {
      const result = await window.dinho.complianceRevert(ids)
      const updated = await window.dinho.complianceScan()
      set({ state: updated, applyResult: result, status: 'done' })
    } catch {
      set({ status: 'done' })
    }
  },
}))
