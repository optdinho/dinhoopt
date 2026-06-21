import type { ScanItem } from '@shared/types'

/**
 * In-memory cache of scan results so clean handlers can look up
 * item paths by ID. Shared across all cleaner categories.
 *
 * Cache lifecycle:
 * - Entries remain valid for the duration of the current scan cycle.
 * - Pre-existing entries from prior cycles are harmless (renderer never
 *   requests stale IDs).
 * - When the limit is reached, the oldest entries (by insertion order)
 *   are evicted first. Since categories are scanned in order, the first
 *   category's items are at highest risk. The limit is set generously
 *   (200,000) to accommodate a full multi-category scan without eviction.
 */
const itemCache = new Map<string, ScanItem>()
let _maxCacheSize = 200_000

/**
 * Override the maximum cache size (default: 200,000).
 * Useful for testing or runtime configuration.
 */
export function setMaxCacheSize(n: number): void {
  _maxCacheSize = Math.max(1, n)
}

export function cacheItems(originalItems: ScanItem[]): void {
  const limit = _maxCacheSize
  const items = originalItems.length > limit ? originalItems.slice(0, limit) : originalItems
  if (itemCache.size + items.length > limit) {
    const toRemove = itemCache.size + items.length - limit
    if (toRemove > limit * 0.75) {
      // Bulk clear: keep only the newest entries (avoids O(n) iteration
      // of the full map when most entries need to go).
      const entries = [...itemCache.entries()]
      const keep = entries.slice(toRemove)
      itemCache.clear()
      for (const [k, v] of keep) {
        itemCache.set(k, v)
      }
    } else {
      // Incremental removal of the oldest entries (Map insertion order).
      const keys = itemCache.keys()
      for (let i = 0; i < toRemove; i++) {
        const key = keys.next().value
        if (key !== undefined) itemCache.delete(key)
      }
    }
  }
  for (const item of items) {
    itemCache.set(item.id, item)
  }
}

export function getCachedItem(id: string): ScanItem | undefined {
  return itemCache.get(id)
}

export function getCachedItems(ids: string[]): ScanItem[] {
  const items: ScanItem[] = []
  for (const id of ids) {
    const item = itemCache.get(id)
    if (item) items.push(item)
  }
  return items
}

export function clearCache(): void {
  itemCache.clear()
}
