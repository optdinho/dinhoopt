import { create } from 'zustand'
import type { PrivacyShieldState, PrivacyApplyResult, PrivacyScanProgress } from '@shared/types'

interface PrivacyStoreState {
  state: PrivacyShieldState | null
  status: 'idle' | 'scanning' | 'applying' | 'done'
  applyResult: PrivacyApplyResult | null
  expandedCategories: Set<string>
  progress: PrivacyScanProgress | null

  setState: (state: PrivacyShieldState | null) => void
  setStatus: (status: 'idle' | 'scanning' | 'applying' | 'done') => void
  setApplyResult: (result: PrivacyApplyResult | null) => void
  setExpandedCategories: (categories: Set<string>) => void
  toggleCategory: (id: string) => void
  setProgress: (progress: PrivacyScanProgress | null) => void
  reset: () => void
  scan: () => Promise<void>
  apply: (ids: string[]) => Promise<void>
  revert: (ids: string[]) => Promise<void>
}

export const usePrivacyStore = create<PrivacyStoreState>((set) => ({
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
      progress: null
    }),

  scan: async () => {
    set({ status: 'scanning', progress: null })

    const cleanup = window.dinho.onPrivacyProgress((data) => {
      set({ progress: data })
    })

    try {
      const shieldState = await window.dinho.privacyScan()
      set({ state: shieldState, status: 'done' })
    } catch {
      set({ status: 'idle' })
    } finally {
      cleanup()
    }
  },

  apply: async (ids) => {
    set({ status: 'applying', applyResult: null })
    try {
      const result = await window.dinho.privacyApply(ids)
      const updated = await window.dinho.privacyScan()
      set({ state: updated, applyResult: result, status: 'done' })
    } catch {
      set({ status: 'done' })
    }
  },

  revert: async (ids) => {
    set({ status: 'applying', applyResult: null })
    try {
      const result = await window.dinho.privacyRevert(ids)
      const updated = await window.dinho.privacyScan()
      set({ state: updated, applyResult: result, status: 'done' })
    } catch {
      set({ status: 'done' })
    }
  }
}))
