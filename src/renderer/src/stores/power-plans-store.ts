import { create } from 'zustand'
import type { PowerPlanInfo, PowerPlanActivateResult } from '@shared/types'

interface PowerPlansState {
  plans: PowerPlanInfo[]
  loading: boolean
  activating: boolean
  error: string | null
  activeGuid: string | null
  lastResult: PowerPlanActivateResult | null

  loadPlans: () => Promise<void>
  activatePlan: (guid: string) => Promise<void>
  createPlan: (name: string) => Promise<void>
  deletePlan: (guid: string) => Promise<void>
  clearError: () => void
}

export const usePowerPlansStore = create<PowerPlansState>((set, get) => ({
  plans: [],
  loading: false,
  activating: false,
  error: null,
  activeGuid: null,
  lastResult: null,

  loadPlans: async () => {
    set({ loading: true, error: null })
    try {
      const plans = await window.dinho.powerPlansList()
      const active = plans.find((p) => p.isActive)
      set({ plans, loading: false, activeGuid: active?.guid ?? null })
    } catch {
      set({ loading: false, error: 'Falha ao carregar planos de energia' })
    }
  },

  activatePlan: async (guid) => {
    set({ activating: true, error: null, lastResult: null })
    try {
      const result = await window.dinho.powerPlansActivate(guid)
      if (result.success) {
        set((s) => ({
          plans: s.plans.map((p) => ({ ...p, isActive: p.guid === guid })),
          activeGuid: guid,
          activating: false,
          lastResult: result,
        }))
      } else {
        set({ activating: false, error: result.error ?? 'Falha ao ativar', lastResult: result })
      }
    } catch {
      set({ activating: false, error: 'Falha ao ativar plano de energia' })
    }
  },

  createPlan: async (name) => {
    set({ error: null })
    try {
      const result = await window.dinho.powerPlansCreate(name)
      if (result.success) {
        await get().loadPlans()
      } else {
        set({ error: result.error ?? 'Falha ao criar plano' })
      }
    } catch {
      set({ error: 'Falha ao criar plano de energia' })
    }
  },

  deletePlan: async (guid) => {
    set({ error: null })
    try {
      const result = await window.dinho.powerPlansDelete(guid)
      if (result.success) {
        set((s) => ({
          plans: s.plans.filter((p) => p.guid !== guid),
          activeGuid: s.activeGuid === guid ? null : s.activeGuid,
        }))
      } else {
        set({ error: result.error ?? 'Falha ao remover plano' })
      }
    } catch {
      set({ error: 'Falha ao remover plano de energia' })
    }
  },

  clearError: () => set({ error: null }),
}))
