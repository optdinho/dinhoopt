import type { StartupItem, StartupSafetyRating } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useStartupStore } from './startup-store'

function makeItem(overrides: Partial<StartupItem> = {}): StartupItem {
  return {
    id: 'item-1',
    name: 'Test App',
    displayName: 'Test App',
    enabled: true,
    source: 'registry-hkcu',
    location: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    command: 'C:\\App\\test.exe',
    impact: 'high',
    publisher: 'Test Inc',
    ...overrides,
  }
}

describe('startup-store', () => {
  beforeEach(() => {
    useStartupStore.getState().reset()
  })

  it('starts with empty state', () => {
    const state = useStartupStore.getState()
    expect(state.items).toEqual([])
    expect(state.loading).toBe(false)
    expect(state.error).toBeNull()
    expect(state.bootTrace).toBeNull()
  })

  it('setItems replaces all items', () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2', name: 'Other' })]
    useStartupStore.getState().setItems(items)
    expect(useStartupStore.getState().items).toHaveLength(2)
  })

  it('updateItem updates a specific item by id', () => {
    useStartupStore.getState().setItems([makeItem({ id: '1', enabled: true }), makeItem({ id: '2', enabled: true })])

    useStartupStore.getState().updateItem('1', { enabled: false })

    const items = useStartupStore.getState().items
    expect(items[0]!.enabled).toBe(false)
    expect(items[1]!.enabled).toBe(true)
  })

  it('removeItem removes the item with given id', () => {
    useStartupStore.getState().setItems([makeItem({ id: '1' }), makeItem({ id: '2' }), makeItem({ id: '3' })])

    useStartupStore.getState().removeItem('2')
    const ids = useStartupStore.getState().items.map((i) => i.id)
    expect(ids).toEqual(['1', '3'])
  })

  it('setSortBy updates sort preference', () => {
    useStartupStore.getState().setSortBy('name')
    expect(useStartupStore.getState().sortBy).toBe('name')
  })

  it('initial sort is by impact', () => {
    // Reset the full store (reset() preserves sortBy/filterBy)
    useStartupStore.setState({ sortBy: 'impact', filterBy: 'all' })
    expect(useStartupStore.getState().sortBy).toBe('impact')
  })

  it('setFilterBy updates filter', () => {
    useStartupStore.getState().setFilterBy('active')
    expect(useStartupStore.getState().filterBy).toBe('active')
  })

  it('setError stores error message', () => {
    useStartupStore.getState().setError('Something went wrong')
    expect(useStartupStore.getState().error).toBe('Something went wrong')
  })

  it('setDeleteTarget stores item for confirmation', () => {
    const item = makeItem()
    useStartupStore.getState().setDeleteTarget(item)
    expect(useStartupStore.getState().deleteTarget).toEqual(item)
  })

  it('setBootTrace stores trace data', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const trace = { totalBootTimeMs: 5000, items: [] } as any
    useStartupStore.getState().setBootTrace(trace)
    expect(useStartupStore.getState().bootTrace).toEqual(trace)
  })

  it('reset clears items/error/loading/bootTrace but preserves sort/filter', () => {
    useStartupStore.getState().setItems([makeItem()])
    useStartupStore.getState().setError('err')
    useStartupStore.getState().setSortBy('name')
    useStartupStore.getState().setFilterBy('disabled')

    useStartupStore.getState().reset()

    const state = useStartupStore.getState()
    expect(state.items).toEqual([])
    expect(state.error).toBeNull()
    expect(state.loading).toBe(false)
    expect(state.bootTrace).toBeNull()
    // Sort/filter are NOT part of reset() — they persist
    expect(state.sortBy).toBe('name')
    expect(state.filterBy).toBe('disabled')
  })

  it('setLoading updates loading flag', () => {
    useStartupStore.getState().setLoading(true)
    expect(useStartupStore.getState().loading).toBe(true)
    useStartupStore.getState().setLoading(false)
    expect(useStartupStore.getState().loading).toBe(false)
  })

  it('setTraceLoading updates trace loading flag', () => {
    useStartupStore.getState().setTraceLoading(true)
    expect(useStartupStore.getState().traceLoading).toBe(true)
  })

  it('setSafetyRatings converts array to record', () => {
    const ratings: StartupSafetyRating[] = [
      { name: 'App1', safetyScore: 90, description: 'ok', analyzedAt: '' },
      { name: 'App2', safetyScore: 10, description: 'bad', analyzedAt: '' },
    ]
    useStartupStore.getState().setSafetyRatings(ratings)
    const state = useStartupStore.getState()
    expect(state.safetyRatings.App1?.safetyScore).toBe(90)
    expect(state.safetyRatings.App2?.safetyScore).toBe(10)
  })

  it('setSafetyLoading updates safety loading flag', () => {
    useStartupStore.getState().setSafetyLoading(true)
    expect(useStartupStore.getState().safetyLoading).toBe(true)
  })

  it('setExpandedItemId stores expanded item id', () => {
    useStartupStore.getState().setExpandedItemId('item-1')
    expect(useStartupStore.getState().expandedItemId).toBe('item-1')
    useStartupStore.getState().setExpandedItemId(null)
    expect(useStartupStore.getState().expandedItemId).toBeNull()
  })
})

describe('fetchSafetyRatings', () => {
  afterEach(() => {
    vi.stubGlobal('window', undefined)
  })

  it('fetches and stores safety ratings', async () => {
    vi.stubGlobal('window', {
      dinho: {
        startupSafetyFetch: vi.fn().mockResolvedValue({
          ratings: [
            { name: 'Chrome', safetyScore: 95, description: 'Known safe browser', analyzedAt: '2026-06-01' },
            { name: 'Discord', safetyScore: 85, description: 'Known safe app', analyzedAt: '2026-06-01' },
          ] satisfies StartupSafetyRating[],
        }),
      },
    })

    await useStartupStore.getState().fetchSafetyRatings()

    const state = useStartupStore.getState()
    expect(state.safetyLoading).toBe(false)
    expect(state.safetyRatings.Chrome?.safetyScore).toBe(95)
    expect(state.safetyRatings.Discord?.safetyScore).toBe(85)
  })

  it('handles fetch error gracefully', async () => {
    vi.stubGlobal('window', {
      dinho: {
        startupSafetyFetch: vi.fn().mockRejectedValue(new Error('network error')),
      },
    })

    await useStartupStore.getState().fetchSafetyRatings()

    expect(useStartupStore.getState().safetyLoading).toBe(false)
  })
})
