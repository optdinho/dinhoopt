import type { ScanItem } from '@shared/types'
import { beforeEach, describe, expect, it } from 'vitest'
import { cacheItems, clearCache, getCachedItem, getCachedItems } from './scan-cache'

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

  it('evicts cache when exceeding max size', () => {
    // Fill cache with items up to the limit (50,000), then add more to trigger eviction
    const batch1 = Array.from({ length: 50000 }, (_, i) => makeItem(`old-${i}`))
    cacheItems(batch1)
    expect(getCachedItem('old-0')).toBeDefined()

    // Adding 1 more item should trigger eviction of the oldest entry
    const batch2 = [makeItem('new-item')]
    cacheItems(batch2)
    // Oldest item should be evicted to make room
    expect(getCachedItem('old-0')).toBeUndefined()
    expect(getCachedItem('new-item')).toBeDefined()
  })

  it('truncates input exceeding MAX_CACHE_SIZE to 50000 items', () => {
    const items = Array.from({ length: 50001 }, (_, i) => makeItem(`big-${i}`))
    cacheItems(items)
    expect(getCachedItem('big-0')).toBeDefined()
    expect(getCachedItem('big-49999')).toBeDefined()
    expect(getCachedItem('big-50000')).toBeUndefined()
  })

  it('bulk-clears cache partially when toRemove exceeds half of MAX_CACHE_SIZE', () => {
    // Fill cache to max capacity
    const batch1 = Array.from({ length: 50000 }, (_, i) => makeItem(`old-${i}`))
    cacheItems(batch1)
    expect(getCachedItem('old-0')).toBeDefined()

    // Add 30000 items so that toRemove = 50000 + 30000 - 50000 = 30000 > 25000
    // keep = entries.slice(30000) → 20000 old items remain
    const batch2 = Array.from({ length: 30000 }, (_, i) => makeItem(`mid-${i}`))
    cacheItems(batch2)

    // First 30000 old items evicted
    expect(getCachedItem('old-0')).toBeUndefined()
    expect(getCachedItem('old-29999')).toBeUndefined()
    // Last 20000 old items preserved
    expect(getCachedItem('old-30000')).toBeDefined()
    expect(getCachedItem('old-49999')).toBeDefined()
    // All new items present
    expect(getCachedItem('mid-0')).toBeDefined()
    expect(getCachedItem('mid-29999')).toBeDefined()
  })
})
