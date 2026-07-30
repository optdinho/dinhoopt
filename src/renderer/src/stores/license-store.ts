import type { LicenseResult } from '@shared/types'
import { create } from 'zustand'
import i18n from '../i18n'

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
      const hwid = (await window.dinho?.licenseGetHwid?.()) ?? ''
      set({ hwid })
      return hwid
    } catch {
      return ''
    }
  },

  activate: async (key: string) => {
    set({ isActivating: true, error: null })
    try {
      const result = (await window.dinho?.licenseActivate?.(key)) ?? { valid: false, reason: i18n.t('activationError', { ns: 'license' }) }
      set({ isActivating: false, status: result })
      if (!result.valid) set({ error: result.reason ?? null })
      return result
    } catch (e: unknown) {
      const err = e as { message?: string }
      set({ isActivating: false, error: err?.message || i18n.t('activationFailedShort', { ns: 'license' }) })
      return { valid: false, reason: err?.message || i18n.t('activationFailedShort', { ns: 'license' }) }
    }
  },

  checkStatus: async () => {
    set({ loading: true })
    try {
      const result = (await window.dinho?.licenseStatus?.()) ?? { valid: false, reason: i18n.t('noConnection', { ns: 'license' }) }
      set({ status: result, loading: false })
      return result
    } catch (_e: unknown) {
      set({ status: { valid: false, reason: i18n.t('checkFailed', { ns: 'license' }) }, loading: false })
      return { valid: false, reason: i18n.t('checkFailed', { ns: 'license' }) }
    }
  },
}))
