import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ClipInfo, ClipsEngineStatus } from '@shared/types'
import { buildEngineConfig, config as C, getDefaultOutputDir } from '../services/clips-config-manager'
import { getFfmpegPath } from '../services/ffmpeg-path'
import { getLogger } from '../services/logger.service'
import {
  isEngineCapturing as _isEngineCapturing,
  isEngineRunning as _isEngineRunning,
  setEngineCapturing as _setEngineCapturing,
  initEnginePipeIntegration,
  readEngineStatus,
  registerGetCurrentStatus,
} from './clips-engine'
import {
  isPipeConnected as _isPipeConnected,
  sendWithFallback as _sendWithFallback,
  waitForPipeConnection as _waitForPipeConnection,
  connectPipe,
} from './clips-pipe'

// ─── Initialize pipe/engine integration (runs once) ───────────

initEnginePipeIntegration()

// Re-register with the real getCurrentStatus below
registerGetCurrentStatus(getCurrentStatus)

// ─── Re-exports ───────────────────────────────────────────────

export {
  getEnginePath,
  getEnginePid,
  isEngineCapturing,
  isEngineRunning,
  setEngineCapturing,
  startEngine,
  stopEngineProcess,
} from './clips-engine'
export { isPipeConnected, sendPipeCommand, sendPipeCommandLongRunning, sendWithFallback } from './clips-pipe'

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
    _durationCache.delete(filePath)
    _durationCache.set(filePath, entry)
    return entry.duration
  }
  return null
}

function cacheSet(filePath: string, duration: number, mtimeMs: number): void {
  if (_durationCache.size >= MAX_CACHE_ENTRIES) {
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

// ─── Public API ───────────────────────────────────────────────

export async function getVideoDuration(filePath: string): Promise<number> {
  try {
    const stderr = await new Promise<string>((resolve, reject) => {
      execFile(
        getFfmpegPath(),
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

export async function readClipsFromDisk(): Promise<ClipInfo[]> {
  const dir = getDefaultOutputDir()
  try {
    await new Promise<void>((resolve, reject) => {
      existsSync(dir) ? resolve() : reject(new Error('not found'))
    })
  } catch {
    return []
  }
  try {
    const allFiles = await readdir(dir)
    const files = allFiles.filter((f) => f.endsWith('.mp4'))

    const entries = await runWithConcurrency(
      files.map((f) => async () => {
        const fullPath = join(dir, f)
        try {
          const s = await stat(fullPath)
          const mtimeMs = s.mtime.getTime()
          const createdAt = s.birthtime.getTime() > 0 ? s.birthtime.toISOString() : s.mtime.toISOString()
          return { name: f, path: fullPath, size: s.size, createdAt, mtimeMs }
        } catch {
          return null
        }
      }),
      12,
    )

    const valid = entries.filter(
      (e): e is { name: string; path: string; size: number; createdAt: string; mtimeMs: number } => e !== null,
    )

    valid.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

    const durationMap = await getDurationsForClips(valid)

    return valid.map((e) => ({
      name: e.name,
      path: e.path,
      size: e.size,
      createdAt: e.createdAt,
      duration: durationMap.get(e.path) ?? 0,
    }))
  } catch (err) {
    getLogger().error('clips', `Failed to list clips: ${err}`)
    return []
  }
}

export function getCurrentStatus(): ClipsEngineStatus {
  const e = readEngineStatus()
  return {
    running: _isEngineRunning(),
    capturing: e.capturing,
    uptime: _isEngineRunning() ? Math.floor((Date.now() - e.startTime) / 1000) : 0,
    fps: C.engineFps,
    replayTimeSeconds: C.engineReplayTimeSeconds,
    captureBackend: e.captureBackend || undefined,
    encoder: e.encoder || undefined,
    estimatedRamMB: e.estimatedRamMB || undefined,
    diskSpaceOk: e.diskSpaceOk,
    currentGame: C.customGameProcess || e.currentGame || undefined,
    customGameProcess: C.customGameProcess || undefined,
    lastCrashRecovered: e.lastCrashRecovered || undefined,
    audioLoopback: e.audioLoopback || undefined,
    audioFallback: e.audioFallback || undefined,
    audioSampleRate: C.audioSampleRate,
    replayBufferBytes: e.replayBufferBytes || undefined,
    replayBufferVideoFrames: e.replayBufferVideoFrames || undefined,
    replayBufferVideoBytes: e.replayBufferVideoBytes || undefined,
    replayBufferAudioPackets: e.replayBufferAudioPackets || undefined,
    replayBufferAudioBytes: e.replayBufferAudioBytes || undefined,
  }
}

export async function startClipCapture(): Promise<{ success: boolean; error?: string }> {
  if (!_isEngineRunning()) {
    return { success: false, error: 'Engine not running' }
  }
  if (_isEngineCapturing()) {
    return { success: true }
  }

  if (!_isPipeConnected()) {
    getLogger().info('clips', 'startClipCapture: pipe not connected, attempting reconnect...')
    connectPipe()
    const connected = await _waitForPipeConnection(5000)
    if (!connected) {
      return { success: false, error: 'Engine pipe not connected' }
    }
  }

  const configPayload = buildEngineConfig()
  await _sendWithFallback('config', configPayload).catch(() => {
    getLogger().warning('clips', 'startClipCapture: config sync failed')
  })

  const e = readEngineStatus()
  const rawProcessName = (e.currentGame || '').replace(/ \(.*?\) \[.*?\]$/, '').trim()
  const targetGame = C.customGameProcess || rawProcessName || ''
  getLogger().info(
    'clips',
    `startClipCapture: targetGame="${targetGame}" configCustomGameProcess="${C.customGameProcess}" engineCurrentGame="${e.currentGame}"`,
  )
  const payload = targetGame ? { gameProcess: targetGame } : undefined
  const result = await _sendWithFallback('startCapture', payload)
  if (result.success) {
    _setEngineCapturing(true)
  }
  return result
}
