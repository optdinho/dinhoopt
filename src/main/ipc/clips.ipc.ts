import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { IPC } from '@shared/channels'
import type {
  AudioSessionInfo,
  ClipInfo,
  ClipMergeResult,
  ClipTrimResult,
  ClipsConfig,
  HotkeyBinding,
  MicDeviceInfo,
} from '@shared/types'
import { BrowserWindow, app, dialog, ipcMain, shell } from 'electron'
import {
  config as C,
  buildEngineConfig,
  clipPathInOutputDir,
  getCurrentConfigPayload,
  getDefaultOutputDir,
  persistClipsConfig,
} from '../services/clips-config-manager'
import { getLogger } from '../services/logger.service'
import { getCachedThumbnailPath, getThumbnailDataUrl } from '../services/thumbnail-generator'
import {
  getCurrentStatus,
  isEngineCapturing,
  isEngineRunning,
  isPipeConnected,
  readClipsFromDisk,
  sendPipeCommand,
  sendWithFallback,
  setEngineCapturing,
  startClipCapture,
  startEngine,
  stopEngineProcess,
} from './clips-engine-connection'

export function registerClipsIpc(): void {
  ipcMain.handle(IPC.CLIPS_GET_STATUS, getCurrentStatus)

  ipcMain.handle(IPC.CLIPS_START_ENGINE, startEngine)

  ipcMain.handle(IPC.CLIPS_STOP_ENGINE, async (): Promise<{ success: boolean }> => {
    stopEngineProcess()
    return { success: true }
  })

  ipcMain.handle(IPC.CLIPS_START_CAPTURE, startClipCapture)

  ipcMain.handle(IPC.CLIPS_STOP_CAPTURE, async (): Promise<{ success: boolean; error?: string }> => {
    if (!isEngineRunning()) {
      setEngineCapturing(false)
      return { success: true }
    }
    const result = await sendWithFallback('stopCapture')
    if (result.success) {
      setEngineCapturing(false)
    }
    return result
  })

  ipcMain.handle(IPC.CLIPS_SAVE_CLIP, async (): Promise<{ success: boolean; error?: string }> => {
    if (!isEngineRunning()) {
      return { success: false, error: 'Engine not running' }
    }
    if (!isPipeConnected()) {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (isPipeConnected()) break
        if (!isEngineRunning()) return { success: false, error: 'Engine not running' }
      }
    }
    if (isPipeConnected()) {
      const engineConfig = buildEngineConfig()
      await sendWithFallback('config', engineConfig)
    }
    return await sendWithFallback('saveClip')
  })

  ipcMain.handle(IPC.CLIPS_LIST_CLIPS, async (): Promise<ClipInfo[]> => {
    return await readClipsFromDisk()
  })

  ipcMain.handle(
    IPC.CLIPS_DELETE_CLIP,
    async (_event, clipName: unknown): Promise<{ success: boolean; error?: string }> => {
      if (typeof clipName !== 'string') return { success: false, error: 'Invalid clip name' }
      const clipPath = clipPathInOutputDir(clipName)
      if (!clipPath) {
        return { success: false, error: 'Invalid path' }
      }
      try {
        const outputDir = getDefaultOutputDir()
        unlinkSync(clipPath)
        const thumbPath = getCachedThumbnailPath(outputDir, clipName)
        if (thumbPath) {
          try {
            unlinkSync(thumbPath)
          } catch {
            /* ignore thumbnail cleanup failure */
          }
        }
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(IPC.CLIPS_OPEN_CLIP, async (_event, clipPath: unknown): Promise<void> => {
    if (typeof clipPath !== 'string') return
    try {
      await shell.openPath(clipPath)
    } catch (err) {
      getLogger().error('clips', `Failed to open clip: ${err}`)
    }
  })

  ipcMain.handle(IPC.CLIPS_GET_THUMBNAIL, async (_event, clipName: unknown): Promise<string | null> => {
    if (typeof clipName !== 'string') return null
    return getThumbnailDataUrl(getDefaultOutputDir(), clipName)
  })

  ipcMain.handle(IPC.CLIPS_GET_CONFIG, (): ClipsConfig => getCurrentConfigPayload() as ClipsConfig)

  ipcMain.handle(
    IPC.CLIPS_SET_CONFIG,
    async (_event, config: unknown): Promise<{ success: boolean; error?: string }> => {
      getLogger().info('clips', `Config update requested: ${JSON.stringify(config)}`)
      const c = config as Record<string, unknown> | undefined
      if (c) {
        if (typeof c.replayTimeSeconds === 'number') C.engineReplayTimeSeconds = c.replayTimeSeconds
        if (typeof c.fps === 'number') C.engineFps = c.fps
        if (typeof c.width === 'number') C.width = c.width
        if (typeof c.height === 'number') C.height = c.height
        if (typeof c.bitrateKbps === 'number') C.bitrateKbps = c.bitrateKbps
        if (typeof c.cq === 'number') C.cq = Math.max(0, Math.min(51, c.cq))
        if (typeof c.maxrateKbps === 'number') C.maxrateKbps = Math.max(1000, c.maxrateKbps)
        if (typeof c.bufsizeKbps === 'number') C.bufsizeKbps = Math.max(2000, c.bufsizeKbps)
        if (typeof c.bframes === 'number') C.bframes = Math.max(0, Math.min(16, c.bframes))
        if (typeof c.lookahead === 'number') C.lookahead = Math.max(0, Math.min(256, c.lookahead))
        if (typeof c.encoderPreset === 'string') C.encoderPreset = c.encoderPreset
        if (typeof c.codec === 'string') C.codec = c.codec
        if (typeof c.adapterIndex === 'number') C.adapterIndex = c.adapterIndex
        if (typeof c.micEnabled === 'boolean') C.micEnabled = c.micEnabled
        if (typeof c.audioLoopback === 'boolean') C.audioLoopback = c.audioLoopback
        if (typeof c.forceSoftware === 'boolean') C.forceSoftware = c.forceSoftware
        if (typeof c.gameDetection === 'boolean') C.gameDetection = c.gameDetection
        if (typeof c.gameAudioOnly === 'boolean') C.gameAudioOnly = c.gameAudioOnly
        if (typeof c.customGameProcess === 'string') {
          C.customGameProcess = c.customGameProcess
          getLogger().info(
            'clips',
            `Config customGameProcess set to "${c.customGameProcess}" (pipeConnected=${isPipeConnected()})`,
          )
          if (isPipeConnected() && c.customGameProcess) {
            sendWithFallback('setCustomGameProcess', { processName: c.customGameProcess })
              .then((r) => {
                getLogger().info('clips', `setCustomGameProcess sent: success=${r.success} error=${r.error}`)
              })
              .catch(() => {
                getLogger().warning('clips', 'setCustomGameProcess send failed (caught)')
              })
          }
        }
        if (typeof c.micDeviceId === 'string') {
          C.micDeviceId = c.micDeviceId
          if (isPipeConnected()) {
            sendWithFallback('setMicDevice', { deviceId: c.micDeviceId }).catch(() => {})
          }
        }
        if (typeof c.autoStartCapture === 'boolean') C.autoStartCapture = c.autoStartCapture
        if (typeof c.useExcludeMode === 'boolean') C.useExcludeMode = c.useExcludeMode
        if (typeof c.excludeProcessId === 'number') C.excludeProcessId = c.excludeProcessId
        if (typeof c.gameVolume === 'number') C.gameVolume = Math.max(0, Math.min(2, c.gameVolume))
        if (typeof c.micVolume === 'number') C.micVolume = Math.max(0, Math.min(2, c.micVolume))
        if (c.pushToTalk === 'off' || c.pushToTalk === 'hold' || c.pushToTalk === 'toggle') C.pushToTalk = c.pushToTalk
        if (Array.isArray(c.pushToTalkKeys)) {
          C.pushToTalkKeys = (c.pushToTalkKeys as unknown[]).filter((k) => typeof k === 'number') as number[]
          if (C.pushToTalkKeys.length === 0) C.pushToTalkKeys = [0x7a]
        } else if (typeof c.pushToTalkKey === 'number') {
          C.pushToTalkKeys = [c.pushToTalkKey as number]
        }
        if (Array.isArray(c.hotkeys)) C.hotkeys = c.hotkeys as HotkeyBinding[]
        if (typeof c.outputDirectory === 'string') C.outputDirectory = c.outputDirectory
        if (typeof c.noiseSuppression === 'boolean') C.noiseSuppression = c.noiseSuppression
        if (typeof c.audioSampleRate === 'number') C.audioSampleRate = c.audioSampleRate
        if (typeof c.autoCleanupEnabled === 'boolean') C.autoCleanupEnabled = c.autoCleanupEnabled
        if (typeof c.autoCleanupThresholdPercent === 'number')
          C.autoCleanupThresholdPercent = Math.max(50, Math.min(99, c.autoCleanupThresholdPercent))
      }
      persistClipsConfig()
      if (isPipeConnected()) {
        const engineConfig = buildEngineConfig()
        const hotkeyInfo = (engineConfig.Hotkeys as Record<string, unknown>[]).map(
          (h) => `vk=0x${(h.vk as number).toString(16)} mods=[${(h.modifiers as number[]).join(',')}] act=${h.action}`,
        )
        getLogger().info(
          'clips',
          `Config sync to engine: hotkeys=${JSON.stringify(hotkeyInfo)} pipeConnected=${isPipeConnected()}`,
        )
        const syncResult = await sendWithFallback('config', engineConfig)
        if (!syncResult.success) {
          getLogger().warning('clips', `Config sync to engine failed: ${syncResult.error}`)
        }
      } else {
        getLogger().info('clips', 'Config sync: pipe not connected, skipping')
      }
      return { success: true }
    },
  )

  ipcMain.handle(IPC.CLIPS_SELECT_OUTPUT_DIR, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Escolher pasta de saída dos clipes',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getDefaultOutputDir(),
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) return null
    const selectedPath = result.filePaths[0]
    C.outputDirectory = selectedPath
    return selectedPath
  })

  ipcMain.handle(IPC.CLIPS_GET_RUNNING_PROCESSES, async (): Promise<Array<{ name: string; pid: number }>> => {
    return new Promise((resolve) => {
      execFile('tasklist', ['/FO', 'CSV', '/NH'], { timeout: 5000, windowsHide: true }, (err, stdout) => {
        if (err) {
          resolve([])
          return
        }
        const processes: Array<{ name: string; pid: number }> = []
        for (const line of stdout.split('\n')) {
          const parts = line.match(/"([^"]+)","(\d+)"/)
          if (parts) {
            processes.push({ name: parts[1]!, pid: Number(parts[2]!) })
          }
        }
        resolve(processes)
      })
    })
  })

  ipcMain.handle(IPC.CLIPS_GET_AUDIO_SESSIONS, async (): Promise<AudioSessionInfo[]> => {
    if (!isPipeConnected()) return []
    try {
      const resp = await sendPipeCommand('getAudioSessions')
      const sessions = resp.payload?.sessions
      if (Array.isArray(sessions)) {
        return sessions as AudioSessionInfo[]
      }
      return []
    } catch {
      return []
    }
  })

  ipcMain.handle(
    IPC.CLIPS_SET_AUDIO_SESSIONS,
    async (_event, sessionPids: unknown): Promise<{ success: boolean; error?: string }> => {
      if (!Array.isArray(sessionPids)) {
        return { success: false, error: 'sessionPids must be an array' }
      }
      const pids = sessionPids.filter((p): p is number => typeof p === 'number')
      C.selectedAudioSessions = pids
      persistClipsConfig()
      if (!isPipeConnected()) {
        return { success: false, error: 'Engine pipe not connected' }
      }
      try {
        const resp = await sendPipeCommand('setAudioSessions', { pids })
        if (resp.payload?.success === false) {
          return { success: false, error: (resp.payload?.error as string) || 'Command failed' }
        }
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  ipcMain.handle(IPC.CLIPS_GET_MIC_DEVICES, async (): Promise<MicDeviceInfo[]> => {
    getLogger().info('clips-mic', `pipeConnected=${isPipeConnected()}`)
    if (!isPipeConnected()) return []
    try {
      const resp = await sendPipeCommand('getMicDevices')
      getLogger().info(
        'clips-mic',
        `response cmd=${resp.cmd} payload keys=${Object.keys(resp.payload ?? {})} hasDevices=${'devices' in (resp.payload ?? {})}`,
      )
      const devices = resp.payload?.devices
      if (Array.isArray(devices)) {
        getLogger().info('clips-mic', `returning ${devices.length} devices`)
        return devices as MicDeviceInfo[]
      }
      getLogger().warning('clips-mic', 'devices is not an array')
      return []
    } catch (err) {
      getLogger().warning('clips-mic', `error: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  })

  ipcMain.handle(
    IPC.CLIPS_SET_MIC_DEVICE,
    async (_event, deviceId: unknown): Promise<{ success: boolean; error?: string }> => {
      if (typeof deviceId !== 'string') {
        return { success: false, error: 'deviceId must be a string' }
      }
      C.micDeviceId = deviceId
      persistClipsConfig()
      if (!isPipeConnected()) {
        return { success: true }
      }
      try {
        await sendPipeCommand('setMicDevice', { deviceId })
        return { success: true }
      } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : String(err) }
      }
    },
  )

  interface GpuInfo {
    index: number
    name: string
    vendorId: number
  }

  ipcMain.handle(IPC.CLIPS_GET_GPUS, async (): Promise<GpuInfo[]> => {
    if (!isPipeConnected()) return []
    try {
      const resp = await sendPipeCommand('getGpus')
      if (Array.isArray(resp.payload)) {
        return resp.payload as GpuInfo[]
      }
      return []
    } catch {
      return []
    }
  })

  ipcMain.handle(
    IPC.CLIPS_SET_FAVORITE,
    async (_event, clipName: unknown, favorite: unknown): Promise<{ success: boolean; error?: string }> => {
      if (typeof clipName !== 'string' || !clipName) {
        return { success: false, error: 'Invalid clip name' }
      }
      if (typeof favorite !== 'boolean') {
        return { success: false, error: 'Invalid favorite value' }
      }
      const resolvedName = clipPathInOutputDir(`.${clipName}.favorite`)
      if (!resolvedName) {
        return { success: false, error: 'Invalid clip name' }
      }
      try {
        if (favorite) {
          writeFileSync(resolvedName, '', 'utf-8')
        } else {
          if (existsSync(resolvedName)) {
            unlinkSync(resolvedName)
          }
        }
        return { success: true }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        getLogger().error('clips', `Failed to set favorite: ${msg}`)
        return { success: false, error: msg }
      }
    },
  )

  ipcMain.handle(
    IPC.CLIPS_TRIM_CLIP,
    async (_event, clipPath: string, startSeconds: number, endSeconds: number): Promise<ClipTrimResult> => {
      if (!clipPath || typeof clipPath !== 'string') {
        return { success: false, error: 'Invalid clip path' }
      }
      const safePath = clipPathInOutputDir(clipPath)
      if (!safePath || !existsSync(safePath)) {
        return { success: false, error: 'Clip file not found' }
      }
      if (
        typeof startSeconds !== 'number' ||
        typeof endSeconds !== 'number' ||
        endSeconds <= startSeconds ||
        startSeconds < 0
      ) {
        return { success: false, error: 'Invalid trim range' }
      }
      const outDir = join(getDefaultOutputDir(), 'trimmed')
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
      const baseName = basename(safePath, '.mp4')
      const outPath = join(outDir, `${baseName}_trimmed_${Date.now()}.mp4`)
      return new Promise((resolve) => {
        const args = [
          '-y',
          '-loglevel',
          'error',
          '-ss',
          String(startSeconds),
          '-to',
          String(endSeconds),
          '-i',
          safePath,
          '-c',
          'copy',
          outPath,
        ]
        const proc = execFile('ffmpeg', args, { timeout: 120_000 }, (err) => {
          if (err) {
            resolve({ success: false, error: err.message })
          } else {
            resolve({ success: true, path: outPath })
          }
        })
        proc.on('error', (e) => resolve({ success: false, error: e.message }))
      })
    },
  )

  ipcMain.handle(IPC.CLIPS_MERGE_CLIPS, async (_event, clipPaths: string[]): Promise<ClipMergeResult> => {
    if (!Array.isArray(clipPaths) || clipPaths.length < 2) {
      return { success: false, error: 'At least 2 clips required' }
    }
    const safePaths: string[] = []
    for (const p of clipPaths) {
      if (typeof p !== 'string') {
        return { success: false, error: 'Invalid clip path' }
      }
      const safe = clipPathInOutputDir(p)
      if (!safe || !existsSync(safe)) {
        return { success: false, error: `Clip not found: ${p}` }
      }
      safePaths.push(safe)
    }
    const outDir = join(getDefaultOutputDir(), 'merged')
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true })
    const concatFile = join(outDir, `concat_${Date.now()}.txt`)
    const outPath = join(outDir, `merged_${Date.now()}.mp4`)
    try {
      const lines = safePaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`)
      writeFileSync(concatFile, lines.join('\n'), 'utf-8')
      return await new Promise((resolve) => {
        const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', concatFile, '-c', 'copy', outPath]
        const proc = execFile('ffmpeg', args, { timeout: 120_000 }, (err) => {
          try {
            unlinkSync(concatFile)
          } catch {}
          if (err) {
            resolve({ success: false, error: err.message })
          } else {
            resolve({ success: true, path: outPath })
          }
        })
        proc.on('error', (e) => {
          try {
            unlinkSync(concatFile)
          } catch {}
          resolve({ success: false, error: e.message })
        })
      })
    } catch (err) {
      try {
        unlinkSync(concatFile)
      } catch {}
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
