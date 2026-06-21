import type { ScanItem } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cacheItems, clearCache, getCachedItem, getCachedItems, setMaxCacheSize } from './scan-cache'

function makeItem(id: string): ScanItem {
  return {
    id,
    path: `C:\\temp\\${id}`,
    size: 1024,
    category: 'system',
    subcategory: 'temp',
    lastModified: Date.now(),
    selected: true,
  }
}

describe('scan-cache', () => {
  beforeEach(() => {
    clearCache()
    setMaxCacheSize(200_000)
  })

  it('caches and retrieves a single item by id', () => {
    const item = makeItem('a')
    cacheItems([item])
    expect(getCachedItem('a')).toEqual(item)
  })

  it('returns undefined for unknown id', () => {
    expect(getCachedItem('nonexistent')).toBeUndefined()
  })

  it('caches multiple items and retrieves a subset', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')]
    cacheItems(items)
    const result = getCachedItems(['a', 'c'])
    expect(result).toHaveLength(2)
    expect(result[0]!.id).toBe('a')
    expect(result[1]!.id).toBe('c')
  })

  it('skips unknown ids in getCachedItems', () => {
    cacheItems([makeItem('x')])
    const result = getCachedItems(['x', 'missing'])
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe('x')
  })

  it('clearCache removes all items', () => {
    cacheItems([makeItem('a'), makeItem('b')])
    clearCache()
    expect(getCachedItem('a')).toBeUndefined()
    expect(getCachedItem('b')).toBeUndefined()
  })

  it('overwrites items with the same id', () => {
    const item1 = makeItem('a')
    const item2 = { ...makeItem('a'), size: 9999 }
    cacheItems([item1])
    cacheItems([item2])
    expect(getCachedItem('a')?.size).toBe(9999)
  })

  it('setMaxCacheSize reduces the effective cache limit', () => {
    setMaxCacheSize(100)
    const batch1 = Array.from({ length: 100 }, (_, i) => makeItem(`evict-${i}`))
    cacheItems(batch1)
    expect(getCachedItem('evict-0')).toBeDefined()

    const batch2 = [makeItem('overflow')]
    cacheItems(batch2)
    expect(getCachedItem('evict-0')).toBeUndefined()
    expect(getCachedItem('overflow')).toBeDefined()
  })

  it('setMaxCacheSize with 0 is clamped to 1', () => {
    setMaxCacheSize(0)
    const items = Array.from({ length: 2 }, (_, i) => makeItem(`clamp-${i}`))
    cacheItems(items)
    // Only the first item fits (limit=1, items truncated to 1)
    expect(getCachedItem('clamp-0')).toBeDefined()
    expect(getCachedItem('clamp-1')).toBeUndefined()
  })

  it('setMaxCacheSize with negative is clamped to 1', () => {
    setMaxCacheSize(-5)
    const items = Array.from({ length: 2 }, (_, i) => makeItem(`neg-${i}`))
    cacheItems(items)
    expect(getCachedItem('neg-0')).toBeDefined()
    expect(getCachedItem('neg-1')).toBeUndefined()
  })

  it('evicts cache when exceeding max size', () => {
    // Fill cache with items up to the limit (200,000), then add more to trigger eviction
    const batch1 = Array.from({ length: 200000 }, (_, i) => makeItem(`old-${i}`))
    cacheItems(batch1)
    expect(getCachedItem('old-0')).toBeDefined()

    // Adding 1 more item should trigger eviction of the oldest entry
    const batch2 = [makeItem('new-item')]
    cacheItems(batch2)
    // Oldest item should be evicted to make room
    expect(getCachedItem('old-0')).toBeUndefined()
    expect(getCachedItem('new-item')).toBeDefined()
  })

  it('truncates input exceeding MAX_CACHE_SIZE to 200000 items', () => {
    const items = Array.from({ length: 200001 }, (_, i) => makeItem(`big-${i}`))
    cacheItems(items)
    expect(getCachedItem('big-0')).toBeDefined()
    expect(getCachedItem('big-199999')).toBeDefined()
    expect(getCachedItem('big-200000')).toBeUndefined()
  })

  it('bulk-clears cache partially when toRemove exceeds three-quarters of MAX_CACHE_SIZE', () => {
    // Fill cache to max capacity
    const batch1 = Array.from({ length: 200000 }, (_, i) => makeItem(`old-${i}`))
    cacheItems(batch1)
    expect(getCachedItem('old-0')).toBeDefined()

    // Add 150001 items so that toRemove = 200000 + 150001 - 200000 = 150001 > 150000
    // keep = entries.slice(150001) → 49999 old items remain
    const batch2 = Array.from({ length: 150001 }, (_, i) => makeItem(`mid-${i}`))
    cacheItems(batch2)

    // First 150001 old items evicted
    expect(getCachedItem('old-0')).toBeUndefined()
    expect(getCachedItem('old-150000')).toBeUndefined()
    // Last 49999 old items preserved
    expect(getCachedItem('old-150001')).toBeDefined()
    expect(getCachedItem('old-199999')).toBeDefined()
    // All new items present
    expect(getCachedItem('mid-0')).toBeDefined()
    expect(getCachedItem('mid-150000')).toBeDefined()
  })

  it('handles undefined keys in incremental removal (defensive guard on line 46)', () => {
    // The Map supports any key type. When an entry has key=undefined,
    // keys.next().value returns undefined, exercising the else path
    // of `if (key !== undefined)` in the incremental removal branch.
    setMaxCacheSize(10)
    // biome-ignore lint/suspicious/noExplicitAny: testing defensive guard with undefined key
    const itemWithUndefinedId = { ...makeItem('ignored'), id: undefined as any }
    const fill = Array.from({ length: 9 }, (_, i) => makeItem(`fill-${i}`))
    // Insert the undefined-key item first (Map preserves insertion order)
    cacheItems([itemWithUndefinedId, ...fill])
    // Cache now has 10 entries: {undefined, fill-0...fill-8}
    expect(getCachedItem('fill-0')).toBeDefined()

    // Add 1 more item → toRemove = 1 → incremental removal
    // First key from iterator is undefined → else path of key !== undefined
    cacheItems([makeItem('new-item')])
    // The undefined-key entry was skipped (not deleted), new-item added
    // fill-0 was NOT deleted because the loop consumed only 1 key (undefined)
    // and skipped deletion, leaving fill-0 in place
    expect(getCachedItem('new-item')).toBeDefined()
    expect(getCachedItem('fill-0')).toBeDefined()
  })

  it('caches if originalItems length equals limit exactly', () => {
    setMaxCacheSize(3)
    const items = Array.from({ length: 3 }, (_, i) => makeItem(`exact-${i}`))
    cacheItems(items)
    expect(getCachedItem('exact-0')).toBeDefined()
    expect(getCachedItem('exact-2')).toBeDefined()
  })

  it('handles empty items array', () => {
    cacheItems([])
    expect(getCachedItems([])).toEqual([])
  })

  it('returns all matching items with getCachedItems', () => {
    const items = [makeItem('a'), makeItem('b'), makeItem('c')]
    cacheItems(items)
    const result = getCachedItems(['a', 'b', 'c'])
    expect(result).toHaveLength(3)
    expect(result.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
})
