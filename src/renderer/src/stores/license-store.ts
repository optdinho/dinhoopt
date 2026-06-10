import { create } from 'zustand'
import type { LicenseResult } from '@shared/types'

interface LicenseState {
  hwid: string
  status: LicenseResult | null
  isActivating: boolean
  error: string | null
  loading: boolean
  getHwid: () => Promise<string>
  activate: (key: string) => Promise<LicenseResult>
  checkStatus: () => Promise<LicenseResult>
}

export const useLicenseStore = create<LicenseState>((set) => ({
  hwid: '',
  status: null,
  isActivating: false,
  error: null,
  loading: false,

  getHwid: async () => {
    try {
      const hwid = await window.dinho?.licenseGetHwid?.() ?? ''
      set({ hwid })
      return hwid
    } catch {
      return ''
    }
  },

  activate: async (key: string) => {
    set({ isActivating: true, error: null })
    try {
      const result = await window.dinho?.licenseActivate?.(key) ?? { valid: false, reason: 'Erro na ativação' }
      set({ isActivating: false, status: result })
      if (!result.valid) set({ error: result.reason })
      return result
    } catch (e: any) {
      set({ isActivating: false, error: e?.message || 'Erro ao ativar' })
      return { valid: false, reason: e?.message || 'Erro ao ativar' }
    }
  },

  checkStatus: async () => {
    set({ loading: true })
    try {
      const result = await window.dinho?.licenseStatus?.() ?? { valid: false, reason: 'Sem conexão' }
      set({ status: result, loading: false })
      return result
    } catch (e: any) {
      set({ status: { valid: false, reason: 'Erro ao verificar licença' }, loading: false })
      return { valid: false, reason: 'Erro ao verificar licença' }
    }
  },
}))
