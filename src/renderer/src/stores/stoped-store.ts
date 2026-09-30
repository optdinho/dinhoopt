import type { StopedChangeResult, StopedServiceState, StopedStatusResult } from '@shared/types'
import { create } from 'zustand'

interface StopedStoreState {
  services: StopedServiceState[]
  runningCount: number
  stoppedCount: number
  missingCount: number
  loading: boolean
  changing: boolean
  error: string | null
  lastResult: StopedChangeResult | null
  loaded: boolean

  load: () => Promise<void>
  setService: (id: string, enabled: boolean) => Promise<StopedChangeResult>
  setAll: (enabled: boolean) => Promise<StopedChangeResult>
  clearError: () => void
  clearLastResult: () => void
}

const INITIAL_STATE = {
  services: [],
  runningCount: 0,
  stoppedCount: 0,
  missingCount: 0,
  loading: false,
  changing: false,
  error: null,
  lastResult: null,
  loaded: false,
}

export const useStopedStore = create<StopedStoreState>((set, get) => ({
  ...INITIAL_STATE,

  load: async () => {
    set({ loading: true, error: null, lastResult: null })
    try {
      const data: StopedStatusResult = await window.dinho.stopedServicesStatus()
      set({
        services: data.services,
        runningCount: data.runningCount,
        stoppedCount: data.stoppedCount,
        missingCount: data.missingCount,
        loading: false,
        loaded: true,
      })
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to load STOPED services',
      })
    }
  },

  setService: async (id: string, enabled: boolean) => {
    set({ changing: true, error: null })
    try {
      const result = await window.dinho.stopedServicesSet(id, enabled)
      // Refresh status to reflect SCM reality (startType/running)
      await get().load()
      set({ changing: false, lastResult: result })
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to change service'
      set({ changing: false, error: msg })
      return {
        success: false,
        error: msg,
        changed: [],
        failed: [],
        rebootRequired: false,
      }
    }
  },

  setAll: async (enabled: boolean) => {
    set({ changing: true, error: null })
    try {
      const result = await window.dinho.stopedServicesSetAll(enabled)
      await get().load()
      set({ changing: false, lastResult: result })
      return result
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to change all services'
      set({ changing: false, error: msg })
      return {
        success: false,
        error: msg,
        changed: [],
        failed: [],
        rebootRequired: false,
      }
    }
  },

  clearError: () => set({ error: null }),
  clearLastResult: () => set({ lastResult: null }),
}))
