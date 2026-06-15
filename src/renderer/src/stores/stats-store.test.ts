import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { dinho: { onHistoryChanged: vi.fn() } })

// biome-ignore lint/suspicious/noExplicitAny: test mock
let useStatsStore: any
// biome-ignore lint/suspicious/noExplicitAny: test mock
let useHistoryStore: any

async function setup() {
  const mod = await import('./stats-store')
  const hist = await import('./history-store')
  useStatsStore = mod.useStatsStore
  useHistoryStore = hist.useHistoryStore
}

// biome-ignore lint/suspicious/noExplicitAny: test mock
function mockHistory(entries: any[]) {
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  useHistoryStore.setState({ entries } as any)
}

// biome-ignore lint/suspicious/noExplicitAny: test mock
function makeEntry(overrides: Partial<any> = {}) {
  return {
    id: '1',
    type: 'cleaner',
    timestamp: new Date().toISOString(),
    totalItemsCleaned: 10,
    totalSpaceSaved: 1024,
    totalItemsFound: 10,
    totalItemsSkipped: 0,
    duration: 1000,
    categories: [],
    errorCount: 0,
    ...overrides,
  }
}

describe('stats-store', () => {
  beforeAll(async () => {
    await setup()
  })

  beforeEach(() => {
    vi.clearAllMocks()
    useStatsStore.setState({
      stats: { totalSpaceSaved: 0, totalFilesCleaned: 0, totalScans: 0, lastScanDate: null, recentActivity: [] },
      loaded: false,
    })
    useHistoryStore.setState({ entries: [] })
  })

  it('starts with default stats and loaded=false', () => {
    const state = useStatsStore.getState()
    expect(state.stats.totalSpaceSaved).toBe(0)
    expect(state.stats.totalFilesCleaned).toBe(0)
    expect(state.stats.totalScans).toBe(0)
    expect(state.stats.lastScanDate).toBeNull()
    expect(state.stats.recentActivity).toEqual([])
    expect(state.loaded).toBe(false)
  })

  it('recompute with empty history returns defaults', () => {
    useStatsStore.getState().recompute()
    const state = useStatsStore.getState()
    expect(state.stats.totalScans).toBe(0)
    expect(state.loaded).toBe(true)
  })

  it('recompute aggregates totals from history entries', () => {
    mockHistory([
      makeEntry({ totalItemsCleaned: 10, totalSpaceSaved: 500 }),
      makeEntry({ totalItemsCleaned: 20, totalSpaceSaved: 1500 }),
    ])
    useStatsStore.getState().recompute()
    const state = useStatsStore.getState()
    expect(state.stats.totalFilesCleaned).toBe(30)
    expect(state.stats.totalSpaceSaved).toBe(2000)
    expect(state.stats.totalScans).toBe(2)
  })

  it('recompute sets lastScanDate from most recent entry', () => {
    const date = '2025-01-15T10:00:00.000Z'
    mockHistory([makeEntry({ timestamp: date })])
    useStatsStore.getState().recompute()
    expect(useStatsStore.getState().stats.lastScanDate).toBe(date)
  })

  it('recompute creates recentActivity with mapped types', () => {
    mockHistory([
      makeEntry({ type: 'cleaner', totalItemsCleaned: 5, totalSpaceSaved: 200 }),
      makeEntry({ type: 'registry', totalItemsCleaned: 3, totalSpaceSaved: 0 }),
    ])
    useStatsStore.getState().recompute()
    const activity = useStatsStore.getState().stats.recentActivity
    expect(activity).toHaveLength(2)
    expect(activity[0].type).toBe('clean')
    expect(activity[0].message).toContain('5 items')
    expect(activity[1].type).toBe('registry')
  })

  it('recompute caps recentActivity at 20 entries', () => {
    const entries = Array.from({ length: 30 }, (_, i) => makeEntry({ id: String(i) }))
    mockHistory(entries)
    useStatsStore.getState().recompute()
    expect(useStatsStore.getState().stats.recentActivity).toHaveLength(20)
  })
})
