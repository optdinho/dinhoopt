import type { LogConfig, LogEntry, LogFilter } from '@shared/types'
import { create } from 'zustand'

interface LoggerState {
  entries: LogEntry[]
  total: number
  page: number
  pageSize: number
  filter: LogFilter
  config: LogConfig
  loading: boolean
  setFilter: (filter: LogFilter) => void
  setPage: (page: number) => void
  fetchLogs: () => Promise<void>
  clearLogs: () => Promise<void>
  exportLogs: () => Promise<string>
  fetchConfig: () => Promise<void>
  setConfig: (config: LogConfig) => Promise<void>
}

export const useLoggerStore = create<LoggerState>((set, get) => ({
  entries: [],
  total: 0,
  page: 1,
  pageSize: 50,
  filter: {},
  config: { retentionDays: 7 },
  loading: false,

  setFilter: (filter) => {
    set({ filter, page: 1 })
    get().fetchLogs()
  },

  setPage: (page) => {
    set({ page })
    get().fetchLogs()
  },

  fetchLogs: async () => {
    set({ loading: true })
    try {
      const { filter, page, pageSize } = get()
      const result = await window.dinho?.logsList?.(filter, page, pageSize)
      if (result) {
        set({ entries: result.entries, total: result.total })
      }
    } catch {
      // silencia erros
    } finally {
      set({ loading: false })
    }
  },

  clearLogs: async () => {
    try {
      await window.dinho?.logsClear?.()
      set({ entries: [], total: 0, page: 1 })
    } catch {
      // silencia erros
    }
  },

  exportLogs: async () => {
    try {
      const { filter } = get()
      return (await window.dinho?.logsExport?.(filter)) ?? ''
    } catch {
      return ''
    }
  },

  fetchConfig: async () => {
    try {
      const config = await window.dinho?.logsConfigGet?.()
      if (config) set({ config })
    } catch {
      // silencia erros
    }
  },

  setConfig: async (config) => {
    try {
      await window.dinho?.logsConfigSet?.(config)
      set({ config })
    } catch {
      // silencia erros
    }
  },
}))
