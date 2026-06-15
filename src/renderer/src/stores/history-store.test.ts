import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useHistoryStore } from './history-store'

import type { HistoryEntryType, ScanHistoryEntry } from '@shared/types'

function makeEntry(overrides: Partial<ScanHistoryEntry> = {}): ScanHistoryEntry {
  return {
    id: overrides.id ?? '1',
    type: (overrides.type ?? 'cleaner') as HistoryEntryType,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
    duration: overrides.duration ?? 1000,
    totalItemsFound: overrides.totalItemsFound ?? 10,
    totalItemsCleaned: overrides.totalItemsCleaned ?? 8,
    totalItemsSkipped: overrides.totalItemsSkipped ?? 2,
    totalSpaceSaved: overrides.totalSpaceSaved ?? 1024,
    categories: overrides.categories ?? [],
    errorCount: overrides.errorCount ?? 0,
  }
}

beforeEach(() => {
  vi.stubGlobal('window', {
    dinho: {
      historyGet: vi.fn(),
      historyAdd: vi.fn(),
      historyClear: vi.fn(),
      onHistoryChanged: vi.fn(),
    },
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  useHistoryStore.setState({ entries: [], loaded: false })
})

describe('history-store', () => {
  it('starts with default values', () => {
    const s = useHistoryStore.getState()
    expect(s.entries).toEqual([])
    expect(s.loaded).toBe(false)
  })

  it('load fetches entries and sets loaded', async () => {
    const entries = [makeEntry({ id: '1' }), makeEntry({ id: '2' })]
    vi.mocked(window.dinho.historyGet).mockResolvedValue(entries)
    await useHistoryStore.getState().load()
    const s = useHistoryStore.getState()
    expect(s.entries).toEqual(entries)
    expect(s.loaded).toBe(true)
  })

  it('load handles failure gracefully', async () => {
    vi.mocked(window.dinho.historyGet).mockRejectedValue(new Error('fail'))
    await useHistoryStore.getState().load()
    const s = useHistoryStore.getState()
    expect(s.entries).toEqual([])
    expect(s.loaded).toBe(true)
  })

  it('addEntry prepends entry and caps at 100', async () => {
    vi.mocked(window.dinho.historyAdd).mockResolvedValue(undefined)
    await useHistoryStore.getState().addEntry(makeEntry({ id: '1' }))
    expect(useHistoryStore.getState().entries).toHaveLength(1)
  })

  it('addEntry caps entries at 100', async () => {
    vi.mocked(window.dinho.historyAdd).mockResolvedValue(undefined)
    useHistoryStore.setState({ entries: Array.from({ length: 100 }, (_, i) => makeEntry({ id: String(i) })) })
    await useHistoryStore.getState().addEntry(makeEntry({ id: '101' }))
    expect(useHistoryStore.getState().entries).toHaveLength(100)
    expect(useHistoryStore.getState().entries[0]!.id).toBe('101')
  })

  it('addEntry handles failure silently', async () => {
    vi.mocked(window.dinho.historyAdd).mockRejectedValue(new Error('fail'))
    await expect(useHistoryStore.getState().addEntry(makeEntry({ id: '1' }))).resolves.toBeUndefined()
  })

  it('clear empties entries', async () => {
    vi.mocked(window.dinho.historyClear).mockResolvedValue(undefined)
    useHistoryStore.setState({ entries: [makeEntry({ id: '1' })] })
    await useHistoryStore.getState().clear()
    expect(useHistoryStore.getState().entries).toEqual([])
  })

  it('clear handles failure silently', async () => {
    vi.mocked(window.dinho.historyClear).mockRejectedValue(new Error('fail'))
    await expect(useHistoryStore.getState().clear()).resolves.toBeUndefined()
  })
})
