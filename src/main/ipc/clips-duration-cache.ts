import { execFile } from 'node:child_process'

// ─── Duration cache (LRU, 500 entries) ───────────────────────
interface CacheEntry {
  duration: number
  mtimeMs: number
}

const MAX_CACHE_ENTRIES = 500
const _durationCache = new Map<string, CacheEntry>()

function cacheGet(filePath: string, currentMtimeMs: number): number | null {
  const entry = _durationCache.get(filePath)
  if (entry && entry.mtimeMs === currentMtimeMs) {
    // LRU: move to end (most recently used)
    _durationCache.delete(filePath)
    _durationCache.set(filePath, entry)
    return entry.duration
  }
  return null
}

function cacheSet(filePath: string, duration: number, mtimeMs: number): void {
  if (_durationCache.size >= MAX_CACHE_ENTRIES) {
    // Evict oldest (first entry)
    const oldest = _durationCache.keys().next().value
    if (oldest !== undefined) _durationCache.delete(oldest)
  }
  _durationCache.set(filePath, { duration, mtimeMs })
}

export function invalidateDurationCache(filePath?: string): void {
  if (filePath) {
    _durationCache.delete(filePath)
  } else {
    _durationCache.clear()
  }
}

const DURATION_CONCURRENCY = 6

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length)
  let nextIdx = 0

  async function worker(): Promise<void> {
    while (nextIdx < tasks.length) {
      const idx = nextIdx++
      results[idx] = await tasks[idx]()
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()))
  return results
}

export async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const stderr = await new Promise<string>((resolve, reject) => {
      execFile(
        'ffmpeg',
        ['-i', filePath, '-f', 'null', '-'],
        {
          encoding: 'utf-8',
          timeout: 5000,
          windowsHide: true,
        },
        (err, _stdout, stderrOut) => {
          if (err && !stderrOut) {
            reject(err)
            return
          }
          resolve(stderrOut ?? '')
        },
      )
    })
    const match = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d+)/)
    if (!match) return 0
    const h = Number.parseInt(match[1]!, 10)
    const m = Number.parseInt(match[2]!, 10)
    const s = Number.parseInt(match[3]!, 10)
    const cs = Number.parseInt(match[4]!.padEnd(3, '0'), 10)
    const dur = h * 3600 + m * 60 + s + cs / 1000
    return Number.isFinite(dur) ? Math.round(dur) : 0
  } catch {
    return 0
  }
}

// Batch duration lookup — returns cached values, computes missing ones with concurrency limit
export async function getDurationsForClips(
  clips: Array<{ path: string; mtimeMs: number }>,
): Promise<Map<string, number>> {
  const result = new Map<string, number>()
  const missing: Array<{ path: string; mtimeMs: number }> = []

  for (const clip of clips) {
    const cached = cacheGet(clip.path, clip.mtimeMs)
    if (cached !== null) {
      result.set(clip.path, cached)
    } else {
      missing.push(clip)
    }
  }

  if (missing.length > 0) {
    const computed = await runWithConcurrency(
      missing.map((clip) => async () => {
        const duration = await getVideoDuration(clip.path)
        cacheSet(clip.path, duration, clip.mtimeMs)
        return { path: clip.path, duration }
      }),
      DURATION_CONCURRENCY,
    )
    for (const c of computed) {
      result.set(c.path, c.duration)
    }
  }

  return result
}
