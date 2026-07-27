import type { LogConfig, LogEntry, LogFilter } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLoggerStore } from './logger-store'

function mockKudu() {
  const mock = {
    logsList: vi.fn(),
    logsClear: vi.fn(),
    logsExport: vi.fn(),
    logsConfigGet: vi.fn(),
    logsConfigSet: vi.fn(),
  }
  if (typeof window === 'undefined') {
    ;(globalThis as any).window = {}
  }
  ;(window as any).dinho = mock
  return mock
}

function makeLogEntry(overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    timestamp: '2024-01-01T00:00:00Z',
    level: 'info',
    module: 'system',
    message: 'Test log',
    ...overrides,
  }
}

function makeLogFilter(overrides: Partial<LogFilter> = {}): LogFilter {
  return {
    level: 'info',
    search: '',
    module: '',
    ...overrides,
  }
}

function makeLogConfig(overrides: Partial<LogConfig> = {}): LogConfig {
  return {
    retentionDays: 7,
    ...overrides,
  }
}

describe('logger-store', () => {
  beforeEach(() => {
    useLoggerStore.setState({
      entries: [],
      total: 0,
      page: 1,
      pageSize: 50,
      filter: {},
      config: { retentionDays: 7 },
      loading: false,
    })
  })

  it('starts with default state', () => {
    const state = useLoggerStore.getState()
    expect(state.entries).toEqual([])
    expect(state.total).toBe(0)
    expect(state.page).toBe(1)
    expect(state.pageSize).toBe(50)
    expect(state.filter).toEqual({})
    expect(state.config).toEqual({ retentionDays: 7 })
    expect(state.loading).toBe(false)
  })

  it('setFilter updates filter and resets page', () => {
    const kudu = mockKudu()
    kudu.logsList.mockResolvedValue({ entries: [], total: 0 })
    const filter = makeLogFilter({ level: 'error' })
    useLoggerStore.getState().setFilter(filter)
    const state = useLoggerStore.getState()
    expect(state.filter).toEqual(filter)
    expect(state.page).toBe(1)
    expect(kudu.logsList).toHaveBeenCalled()
  })

  it('setPage updates page and fetches logs', () => {
    const kudu = mockKudu()
    kudu.logsList.mockResolvedValue({ entries: [], total: 0 })
    useLoggerStore.getState().setPage(3)
    expect(useLoggerStore.getState().page).toBe(3)
    expect(kudu.logsList).toHaveBeenCalled()
  })

  it('fetchLogs calls kudu.logsList and stores result', async () => {
    const kudu = mockKudu()
    const entries = [makeLogEntry({ message: 'test' })]
    kudu.logsList.mockResolvedValue({ entries, total: 1 })
    await useLoggerStore.getState().fetchLogs()
    const state = useLoggerStore.getState()
    expect(state.entries).toEqual(entries)
    expect(state.total).toBe(1)
    expect(state.loading).toBe(false)
  })

  it('fetchLogs handles error gracefully', async () => {
    const kudu = mockKudu()
    kudu.logsList.mockRejectedValue(new Error('fail'))
    await useLoggerStore.getState().fetchLogs()
    expect(useLoggerStore.getState().loading).toBe(false)
  })

  it('fetchLogs does not update entries when result is null', async () => {
    const kudu = mockKudu()
    kudu.logsList.mockResolvedValue(null)
    await useLoggerStore.getState().fetchLogs()
    expect(useLoggerStore.getState().entries).toEqual([])
    expect(useLoggerStore.getState().total).toBe(0)
  })

  it('clearLogs calls kudu.logsClear and resets entries', async () => {
    const kudu = mockKudu()
    kudu.logsClear.mockResolvedValue(undefined)
    useLoggerStore.getState().setFilter({ level: 'info' })
    useLoggerStore.getState().setPage(2)
    await useLoggerStore.getState().clearLogs()
    expect(kudu.logsClear).toHaveBeenCalled()
    const state = useLoggerStore.getState()
    expect(state.entries).toEqual([])
    expect(state.total).toBe(0)
    expect(state.page).toBe(1)
  })

  it('clearLogs handles error gracefully', async () => {
    const kudu = mockKudu()
    kudu.logsClear.mockRejectedValue(new Error('fail'))
    await useLoggerStore.getState().clearLogs()
  })

  it('exportLogs calls kudu.logsExport and returns string', async () => {
    const kudu = mockKudu()
    kudu.logsExport.mockResolvedValue('csv,data')
    const result = await useLoggerStore.getState().exportLogs()
    expect(result).toBe('csv,data')
    expect(kudu.logsExport).toHaveBeenCalled()
  })

  it('exportLogs returns empty string on error', async () => {
    const kudu = mockKudu()
    kudu.logsExport.mockRejectedValue(new Error('fail'))
    const result = await useLoggerStore.getState().exportLogs()
    expect(result).toBe('')
  })

  it('exportLogs returns empty string when result is null', async () => {
    const kudu = mockKudu()
    kudu.logsExport.mockResolvedValue(null)
    const result = await useLoggerStore.getState().exportLogs()
    expect(result).toBe('')
  })

  it('fetchConfig calls kudu.logsConfigGet and stores config', async () => {
    const kudu = mockKudu()
    const config = makeLogConfig({ retentionDays: 30 })
    kudu.logsConfigGet.mockResolvedValue(config)
    await useLoggerStore.getState().fetchConfig()
    expect(useLoggerStore.getState().config).toEqual(config)
  })

  it('fetchConfig handles error gracefully', async () => {
    const kudu = mockKudu()
    kudu.logsConfigGet.mockRejectedValue(new Error('fail'))
    await useLoggerStore.getState().fetchConfig()
    expect(useLoggerStore.getState().config).toEqual({ retentionDays: 7 })
  })

  it('fetchConfig does not update config when result is null', async () => {
    const kudu = mockKudu()
    kudu.logsConfigGet.mockResolvedValue(null)
    await useLoggerStore.getState().fetchConfig()
    expect(useLoggerStore.getState().config).toEqual({ retentionDays: 7 })
  })

  it('setConfig calls kudu.logsConfigSet and stores config', async () => {
    const kudu = mockKudu()
    const config = makeLogConfig({ retentionDays: 14 })
    kudu.logsConfigSet.mockResolvedValue(undefined)
    await useLoggerStore.getState().setConfig(config)
    expect(kudu.logsConfigSet).toHaveBeenCalledWith(config)
    expect(useLoggerStore.getState().config).toEqual(config)
  })

  it('setConfig handles error gracefully', async () => {
    const kudu = mockKudu()
    kudu.logsConfigSet.mockRejectedValue(new Error('fail'))
    await useLoggerStore.getState().setConfig(makeLogConfig({ retentionDays: 99 }))
    expect(useLoggerStore.getState().config).toEqual({ retentionDays: 7 })
  })
})
