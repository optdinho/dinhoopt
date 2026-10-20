import { execFile } from 'node:child_process'
import { access, mkdir, unlink, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { IPC } from '@shared/channels'
import type { ClipEncodeProgressEvent, ClipMergeResult, ClipTrimResult, IpcResult } from '@shared/types'
import { BrowserWindow, ipcMain } from 'electron'
import {
  cancelClipJob,
  clearClipJob,
  createProgressEmitter,
  FFMPEG_PROGRESS_ARGS,
  isClipJobCancelled,
  registerClipJob,
} from '../services/clip-encode-job'
import { resolveAmdAvailable } from '../services/clips-amd-cache'
import { config as C, clipPathInOutputDir, getDefaultOutputDir } from '../services/clips-config-manager'
import { buildReEncodeArgs, resolveTrimCodec } from '../services/clips-encode-args'
import {
  appendSharpnessFilter,
  buildAmfEnhanceVf,
  normalizeSharpness,
  parseEnhanceOption,
  probeVideoResolution,
} from '../services/clips-enhance'
import { trackChildProcess } from '../services/exec-utf8'
import { getFfmpegPath } from '../services/ffmpeg-path'
import { getLogger } from '../services/logger.service'
import { getCachedDurationSeconds, invalidateClipsCache, readEngineStatus } from './clips-engine-connection'

// ─── Result helpers (shared convention with clips.ipc.ts) ───────
// Same plain-literal shapes as the host module: error strings are visible
// contract (UI + tests) and must not change here.

function ok(): { success: true } {
  return { success: true }
}

function fail(error: string): { success: false; error: string } {
  return { success: false, error }
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** Pushes a re-encode reading to every live window. */
function sendClipProgress(channel: string, event: ClipEncodeProgressEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue
    win.webContents.send(channel, event)
  }
}

/**
 * Stable identity for a merge job, so the renderer can match readings to the
 * job it started and cancel exactly that one. The order is normalised because
 * the selection order carries no meaning for the key.
 */
function mergeJobKey(safePaths: string[]): string {
  return [...safePaths].sort().join('|')
}

export function registerClipsEncodeIpc(deps: { amdDetected: () => boolean | null }): void {
  const isAmdAvailable = () => resolveAmdAvailable(deps.amdDetected())

  ipcMain.handle(
    IPC.CLIPS_TRIM_CLIP,
    async (
      _event,
      clipPath: string,
      startSeconds: number,
      endSeconds: number,
      reEncode?: boolean,
      enhance?: unknown,
      sharpness?: unknown,
    ): Promise<ClipTrimResult> => {
      if (!clipPath || typeof clipPath !== 'string') {
        getLogger().warning('clips', 'TrimClip failed: Invalid clip path')
        return fail('Invalid clip path')
      }
      const safePath = clipPathInOutputDir(clipPath)
      if (!safePath || !(await fileExists(safePath))) {
        getLogger().warning('clips', `TrimClip failed: Clip file not found '${clipPath}'`)
        return fail('Clip file not found')
      }
      if (
        typeof startSeconds !== 'number' ||
        typeof endSeconds !== 'number' ||
        endSeconds <= startSeconds ||
        startSeconds < 0
      ) {
        getLogger().warning('clips', `TrimClip failed: Invalid trim range (${startSeconds}-${endSeconds})`)
        return fail('Invalid trim range')
      }
      const outDir = getDefaultOutputDir()
      await mkdir(outDir, { recursive: true })
      const baseName = basename(safePath, '.mp4')
      const outPath = join(outDir, `${baseName} DiNho Clipe ${Date.now()}.mp4`)
      const copyArgs = ['-c', 'copy']
      const enhanceOption = parseEnhanceOption(enhance)
      let enhanceVf: string | null = null
      if (enhanceOption !== 'none') {
        if (!reEncode) {
          getLogger().warning('clips', 'TrimClip enhance ignored: enhancement requires re-encode')
        } else if (!isAmdAvailable()) {
          getLogger().warning('clips', 'TrimClip enhance ignored: no AMD GPU detected')
        } else {
          const res = await probeVideoResolution(getFfmpegPath(), safePath)
          if (res) {
            enhanceVf = buildAmfEnhanceVf(enhanceOption, res.w, res.h)
          } else {
            getLogger().warning('clips', 'TrimClip enhance ignored: could not probe source resolution')
          }
        }
      }
      const sharpnessVal = normalizeSharpness(sharpness)
      if (sharpnessVal > 0 && !reEncode) {
        getLogger().warning('clips', 'TrimClip sharpness ignored: sharpening requires re-encode')
      }
      const vfChain = appendSharpnessFilter(enhanceVf, sharpnessVal)
      // Item 8: re-encodar com o codec que o engine detectou, não com libx264 fixo. Quem tem
      // GPU parava de gastar CPU editando um clipe que tinha saído do encoder de hardware.
      const trimCodec = resolveTrimCodec(readEngineStatus().codec)
      const reEncodeArgs = buildReEncodeArgs({
        codec: trimCodec,
        cq: C.cq,
        maxrateKbps: C.maxrateKbps,
        bufsizeKbps: C.bufsizeKbps,
      })
      const totalSeconds = endSeconds - startSeconds
      const jobKey = safePath
      return new Promise((resolve) => {
        const seekArgs = reEncode
          ? [
              '-i',
              safePath,
              '-ss',
              String(startSeconds),
              '-to',
              String(endSeconds),
              ...reEncodeArgs,
              ...(vfChain ? ['-vf', vfChain] : []),
            ]
          : ['-ss', String(startSeconds), '-to', String(endSeconds), '-i', safePath, ...copyArgs]
        const args = ['-y', '-loglevel', 'error', ...FFMPEG_PROGRESS_ARGS, ...seekArgs, outPath]
        // Settles the promise exactly once: ffmpeg reports a killed process as
        // an error, and a user cancel must not surface as a failure.
        let settled = false
        const finish = (result: ClipTrimResult) => {
          if (settled) return
          settled = true
          clearClipJob(jobKey)
          resolve(result)
        }
        const emitter = createProgressEmitter(jobKey, totalSeconds, (event) => {
          sendClipProgress(IPC.CLIPS_TRIM_PROGRESS, event)
        })
        const proc = execFile(getFfmpegPath(), args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err) => {
          if (isClipJobCancelled(jobKey)) {
            // A half-written file is worse than no file: it would show up in
            // the grid as an unplayable clip.
            void unlink(outPath).catch(() => {
              /* ignore cleanup error */
            })
            getLogger().info('clips', 'TrimClip cancelled by user')
            finish({ success: false, cancelled: true })
            return
          }
          if (err) {
            void unlink(outPath).catch(() => {
              /* ignore cleanup error */
            })
            getLogger().warning('clips', `TrimClip ffmpeg failed: ${err.message}`)
            finish(fail(err.message))
          } else {
            invalidateClipsCache()
            finish({ success: true, path: outPath })
          }
        })
        registerClipJob(jobKey, proc)
        // Undefined only in test doubles; execFile always pipes stderr in prod.
        proc.stderr?.on('data', (chunk: Buffer) => emitter.push(chunk.toString('utf8')))
        trackChildProcess(proc)
        proc.on('error', (e) => {
          void unlink(outPath).catch(() => {
            /* ignore cleanup error */
          })
          getLogger().warning('clips', `TrimClip process error: ${e.message}`)
          finish(fail(e.message))
        })
      })
    },
  )

  ipcMain.handle(IPC.CLIPS_TRIM_CANCEL, (_event, clipPath: unknown): IpcResult => {
    if (typeof clipPath !== 'string') return fail('Invalid clip path')
    const safePath = clipPathInOutputDir(clipPath)
    if (!safePath || !cancelClipJob(safePath)) {
      getLogger().warning('clips', 'Trim cancel failed: no re-encode in progress')
      return fail('No re-encode in progress')
    }
    return ok()
  })

  ipcMain.handle(
    IPC.CLIPS_MERGE_CLIPS,
    async (_event, clipPaths: string[], enhance?: unknown, sharpness?: unknown): Promise<ClipMergeResult> => {
      if (!Array.isArray(clipPaths) || clipPaths.length < 2) {
        getLogger().warning(
          'clips',
          `MergeClips failed: At least 2 clips required (got ${Array.isArray(clipPaths) ? clipPaths.length : 0})`,
        )
        return fail('At least 2 clips required')
      }
      const safePaths: string[] = []
      for (const p of clipPaths) {
        if (typeof p !== 'string') {
          getLogger().warning('clips', 'MergeClips failed: Invalid clip path (not a string)')
          return fail('Invalid clip path')
        }
        const safe = clipPathInOutputDir(p)
        if (!safe || !(await fileExists(safe))) {
          getLogger().warning('clips', `MergeClips failed: Clip not found '${p}'`)
          return fail(`Clip not found: ${p}`)
        }
        safePaths.push(safe)
      }
      const outDir = getDefaultOutputDir()
      await mkdir(outDir, { recursive: true })
      const now = new Date()
      const pad = (n: number) => String(n).padStart(2, '0')
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
      const concatFile = join(outDir, `concat_${Date.now()}.txt`)
      const outPath = join(outDir, `DiNho Clipes ${ts}.mp4`)
      const enhanceOption = parseEnhanceOption(enhance)
      let enhanceVf: string | null = null
      if (enhanceOption !== 'none') {
        if (!isAmdAvailable()) {
          getLogger().warning('clips', 'MergeClips enhance ignored: no AMD GPU detected')
        } else {
          const res = await probeVideoResolution(getFfmpegPath(), safePaths[0]!)
          if (res) {
            enhanceVf = buildAmfEnhanceVf(enhanceOption, res.w, res.h)
          } else {
            getLogger().warning('clips', 'MergeClips enhance ignored: could not probe source resolution')
          }
        }
      }
      const sharpnessVal = normalizeSharpness(sharpness)
      const vfChain = appendSharpnessFilter(enhanceVf, sharpnessVal)
      // Item 8: mesma regra do trim — o merge com filtro re-encodava em libx264 fixo.
      const mergeCodec = resolveTrimCodec(readEngineStatus().codec)
      const streamArgs =
        vfChain !== null
          ? buildReEncodeArgs({
              codec: mergeCodec,
              cq: C.cq,
              maxrateKbps: C.maxrateKbps,
              bufsizeKbps: C.bufsizeKbps,
              vfChain,
            })
          : ['-c', 'copy']
      try {
        const lines = safePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
        await writeFile(concatFile, lines.join('\n'), 'utf-8')
        // The merged output is as long as the sum of its parts, which is the
        // denominator the progress bar needs. Read from the warm duration cache
        // so the encode never waits on extra ffmpeg probes.
        const totalSeconds = safePaths.reduce((sum, p) => sum + getCachedDurationSeconds(p), 0)
        const jobKey = mergeJobKey(safePaths)
        return await new Promise((resolve) => {
          const args = [
            '-y',
            '-loglevel',
            'error',
            ...FFMPEG_PROGRESS_ARGS,
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            concatFile,
            ...streamArgs,
            outPath,
          ]
          let settled = false
          const finish = (result: ClipMergeResult) => {
            if (settled) return
            settled = true
            clearClipJob(jobKey)
            resolve(result)
          }
          const emitter = createProgressEmitter(jobKey, totalSeconds, (event) => {
            sendClipProgress(IPC.CLIPS_MERGE_PROGRESS, event)
          })
          const proc = execFile(getFfmpegPath(), args, { timeout: 120_000, maxBuffer: 8 * 1024 * 1024 }, (err) => {
            void unlink(concatFile).catch(() => {})
            if (isClipJobCancelled(jobKey)) {
              void unlink(outPath).catch(() => {
                /* ignore cleanup error */
              })
              getLogger().info('clips', 'MergeClips cancelled by user')
              finish({ success: false, cancelled: true })
              return
            }
            if (err) {
              void unlink(outPath).catch(() => {
                /* ignore cleanup error */
              })
              getLogger().warning('clips', `MergeClips ffmpeg failed: ${err.message}`)
              finish(fail(err.message))
            } else {
              invalidateClipsCache()
              finish({ success: true, path: outPath })
            }
          })
          registerClipJob(jobKey, proc)
          proc.stderr?.on('data', (chunk: Buffer) => emitter.push(chunk.toString('utf8')))
          trackChildProcess(proc)
          proc.on('error', (e) => {
            void unlink(concatFile).catch(() => {})
            void unlink(outPath).catch(() => {
              /* ignore cleanup error */
            })
            getLogger().warning('clips', `MergeClips process error: ${e.message}`)
            finish(fail(e.message))
          })
        })
      } catch (err) {
        await unlink(concatFile).catch(() => {})
        getLogger().warning('clips', `MergeClips failed: ${errMessage(err)}`)
        return fail(errMessage(err))
      }
    },
  )

  ipcMain.handle(IPC.CLIPS_MERGE_CANCEL, (_event, clipPaths: unknown): IpcResult => {
    if (!Array.isArray(clipPaths) || clipPaths.length < 2) {
      return fail('At least 2 clips required')
    }
    const safePaths: string[] = []
    for (const p of clipPaths) {
      if (typeof p !== 'string') return fail('Invalid clip path')
      const safe = clipPathInOutputDir(p)
      if (!safe) return fail('Invalid clip path')
      safePaths.push(safe)
    }
    if (!cancelClipJob(mergeJobKey(safePaths))) {
      getLogger().warning('clips', 'Merge cancel failed: no re-encode in progress')
      return fail('No re-encode in progress')
    }
    return ok()
  })
}
