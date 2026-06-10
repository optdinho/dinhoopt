import { createJsonStore } from './store-base'

const THROTTLE_WINDOW_MS = 24 * 60 * 60 * 1000

const store = createJsonStore<Record<string, number>>({
  name: 'trim-history.json',
  defaults: {},
  devSuffix: 'Kudu-Dev',
})

export function getTrimHistory(): Record<string, number> {
  try {
    const data = store.load()
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(data)) {
        if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v)) {
          out[k] = v
        }
      }
      return out
    }
  } catch {
    // Corrupt file — return empty and let the next write recover
  }
  return {}
}

export function getLastTrimAt(driveId: string): number | null {
  const all = getTrimHistory()
  return all[driveId] ?? null
}

export function setLastTrimAt(driveId: string, when: number = Date.now()): void {
  const history = getTrimHistory()
  history[driveId] = when
  store.save(history)
}

export function isThrottled(driveId: string, now: number = Date.now()): boolean {
  const last = getLastTrimAt(driveId)
  if (last === null) return false
  return now - last < THROTTLE_WINDOW_MS
}

export function _resetTrimHistoryPathCache(): void {
  store.resetCache()
}
