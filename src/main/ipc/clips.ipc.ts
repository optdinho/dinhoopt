import { execFile } from 'node:child_process'
import { access, stat as fsStat, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import type { AudioSessionInfo, ClipInfo, HotkeyBinding, IpcResult, MicDeviceInfo } from '@shared/types'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { rememberAmdDetection, resolveAmdAvailable } from '../services/clips-amd-cache'
import {
  buildEngineConfig,
  config as C,
  clipPathInOutputDir,
  getCurrentConfigPayload,
  getDefaultOutputDir,
  migrateHotkeys,
  normalizeFps,
  persistClipsConfig,
} from '../services/clips-config-manager'
import { AMD_VENDOR_ID } from '../services/clips-enhance'
import { uploadClipToGofile } from '../services/clips-publish'
import { psEncodedArgs } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'
import { getCachedThumbnailPath, getThumbnailDataUrl } from '../services/thumbnail-generator'
import { registerClipsEncodeIpc } from './clips-encode.ipc'
import {
  getCurrentStatus,
  invalidateClipsCache,
  invalidateDurationCache,
  isEngineRunning,
  isPipeConnected,
  onceEngineStopped,
  readClipsFromDisk,
  sendPipeCommand,
  sendPipeCommandLongRunning,
  sendWithFallback,
  startClipCapture,
  startEngine,
  stopClipCapture,
  stopEngineProcess,
  waitForPipeConnected,
} from './clips-engine-connection'

// ─── Item 9: helpers de resultado ───────────────────────────────
// Substituem as construções `{ success: true/false, error: … }` repetidas
// pelo ficheiro. Os textos de erro passam para dentro dos helpers sem qualquer
// alteração — são contrato visível (UI + testes).

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

let _micDevicesCache: MicDeviceInfo[] | null = null
let _micDevicesCacheTs = 0

let _amdDetected: boolean | null = null

const _publishingPaths = new Set<string>()
const _publishingControllers = new Map<string, AbortController>()

const VALID_ENCODER_PRESETS = new Set(['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'])

export function resetMicDevicesCache(): void {
  _micDevicesCache = null
  _micDevicesCacheTs = 0
}

export function enumerateMicDevicesLocal(): Promise<MicDeviceInfo[]> {
  if (_micDevicesCache && Date.now() - _micDevicesCacheTs < 10_000) {
    return Promise.resolve(_micDevicesCache)
  }
  const ps = [
    'Add-Type -AssemblyName System.Runtime.WindowsRuntime',
    '$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq \'IAsyncOperation`1\' })[0]',
    'function AsTask($WinRtTask, $ResultType) {',
    '  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)',
    '  $netTask = $asTask.Invoke($null, @($WinRtTask))',
    '  $netTask.Wait(-1) | Out-Null',
    '  $netTask.Result',
    '}',
    '[Windows.Devices.Enumeration.DeviceInformation,Windows.Devices,ContentType=WindowsRuntime] | Out-Null',
    '[Windows.Devices.Enumeration.DeviceClass,Windows.Devices,ContentType=WindowsRuntime] | Out-Null',
    '$task = [Windows.Devices.Enumeration.DeviceInformation]::FindAllAsync([Windows.Devices.Enumeration.DeviceClass]::AudioCapture)',
    '$devices = AsTask $task ([Windows.Devices.Enumeration.DeviceInformationCollection])',
    '$defaultId = ""',
    'try { $defaultId = [Windows.Devices.Enumeration.DeviceInformation]::GetDefaultAsync([Windows.Devices.Enumeration.DeviceClass]::AudioCapture).GetAwaiter().GetResult().Id } catch {}',
    'foreach ($d in $devices) {',
    '  $isDef = if ($d.Id -eq $defaultId) { "1" } else { "0" }',
    '  Write-Output ($d.Id + "|" + $d.Name + "|" + $isDef)',
    '}',
  ].join('\r\n')
  return new Promise((resolve) => {
    // The old script had three defects, each of which alone broke enumerate:
    //  1. `"IAsyncOperation`1"` in double quotes — PowerShell ate the backtick
    //     (→ IAsyncOperation1), the AsTask filter matched 0 and `(...)[0]`
    //     threw "cannot index into a null array". Now single-quoted.
    //  2. $ResultType was `IReadOnlyList<DeviceInformation>` (plus a stray
    //     `.Result`), but FindAllAsync(DeviceClass) yields an
    //     IAsyncOperation<DeviceInformationCollection> → COM cast failed.
    //  3. AsTask returned the Task instead of its `.Result`.
    // -EncodedCommand passes the script verbatim (no argv re-quoting), which is
    // extra safety given the script is full of quotes.
    execFile('powershell', psEncodedArgs(ps), { timeout: 15000, windowsHide: true }, (_err, stdout) => {
      if (_err || !stdout) {
        getLogger().info('clips-mic', `local enumerate failed: ${_err?.message ?? 'empty output'}`)
        resolve([])
        return
      }
      const lines = stdout.trim().split(/\r?\n/).filter(Boolean)
      const devices: MicDeviceInfo[] = lines
        .map((line) => {
          const [id, name, isDef] = line.split('|')
          return {
            id: (id ?? '').trim(),
            name: (name ?? '').trim(),
            isDefault: isDef === '1',
            channels: 2,
            sampleRate: 48000,
          }
        })
        .filter((d) => d.id && d.name)
      _micDevicesCache = devices
      _micDevicesCacheTs = Date.now()
      getLogger().info('clips-mic', `local enumerate returned ${devices.length} devices`)
      resolve(devices)
    })
  })
}

export function registerClipsIpc(): void {
  ipcMain.handle(IPC.CLIPS_GET_STATUS, getCurrentStatus)

  ipcMain.handle(IPC.CLIPS_START_ENGINE, startEngine)

  ipcMain.handle(IPC.CLIPS_STOP_ENGINE, async (): Promise<{ success: boolean }> => {
    stopEngineProcess()
    return ok()
  })

  ipcMain.handle(IPC.CLIPS_START_CAPTURE, startClipCapture)

  ipcMain.handle(IPC.CLIPS_STOP_CAPTURE, async (): Promise<IpcResult> => {
    const result = await stopClipCapture()
    return result.success ? ok() : fail(result.error ?? 'Failed to stop capture')
  })

  ipcMain.handle(IPC.CLIPS_SAVE_CLIP, async (): Promise<IpcResult> => {
    if (!isEngineRunning()) {
      getLogger().warning('clips', 'SaveClip failed: Engine not running')
      return fail('Engine not running')
    }
    if (!isPipeConnected()) {
      // Item 4 — espera dirigida por eventos, sem polling: subscrição à paragem
      // explícita do engine aborta a espera de imediato (utilizador, fim da app,
      // auto-session). Uma queda NATURAL do processo não é observável daqui (não
      // existe notificação para crash), por isso é apanhada pelo único
      // isEngineRunning() abaixo, quando a espera termina ao fim de 5s — o texto
      // de erro é o mesmo de antes, só a latência difere.
      const controller = new AbortController()
      const unsubscribe = onceEngineStopped(() => controller.abort())
      try {
        const connected = await waitForPipeConnected(5000, { signal: controller.signal })
        if (!connected && (controller.signal.aborted || !isEngineRunning())) {
          getLogger().warning('clips', 'SaveClip failed: Engine stopped during reconnect wait')
          return fail('Engine not running')
        }
      } finally {
        unsubscribe()
      }
    }
    if (isPipeConnected()) {
      const engineConfig = buildEngineConfig()
      await sendWithFallback('config', engineConfig)
    }
    try {
      const resp = await sendPipeCommandLongRunning('saveClip')
      if (resp.payload?.success === false || resp.payload?.error) {
        getLogger().warning('clips', `SaveClip failed: ${resp.payload?.error || 'Save failed'}`)
        return fail(String(resp.payload?.error || 'Save failed'))
      }
      invalidateClipsCache()
      return ok()
    } catch (err) {
      getLogger().warning('clips', `SaveClip exception: ${errMessage(err)}`)
      return fail(errMessage(err))
    }
  })

  ipcMain.handle(IPC.CLIPS_LIST_CLIPS, async (): Promise<ClipInfo[]> => {
    invalidateClipsCache()
    return readClipsFromDisk()
  })

  ipcMain.handle(IPC.CLIPS_DELETE_CLIP, async (_event, clipName: unknown): Promise<IpcResult> => {
    if (typeof clipName !== 'string') {
      getLogger().warning('clips', 'DeleteClip failed: Invalid clip name (not a string)')
      return fail('Invalid clip name')
    }
    const clipPath = clipPathInOutputDir(clipName)
    if (!clipPath) {
      getLogger().warning('clips', `DeleteClip failed: Invalid path for '${clipName}'`)
      return fail('Invalid path')
    }
    try {
      const outputDir = getDefaultOutputDir()
      await unlink(clipPath)
      const thumbPath = getCachedThumbnailPath(outputDir, clipName)
      if (thumbPath) {
        try {
          await unlink(thumbPath)
        } catch {
          /* ignore thumbnail cleanup failure */
        }
      }
      const engineThumb = join(outputDir, `${clipName.replace(/\.mp4$/, '')}.thumb.jpg`)
      if (await fileExists(engineThumb)) {
        try {
          await unlink(engineThumb)
        } catch {
          /* ignore engine thumbnail cleanup failure */
        }
      }
      invalidateDurationCache(clipPath)
      invalidateClipsCache()
      return ok()
    } catch (err) {
      const msg = errMessage(err)
      getLogger().warning('clips', `DeleteClip failed: ${msg}`)
      return fail(msg)
    }
  })

  ipcMain.handle(IPC.CLIPS_RENAME_CLIP, async (_event, clipName: unknown, newName: unknown): Promise<IpcResult> => {
    if (typeof clipName !== 'string' || !clipName) {
      getLogger().warning('clips', 'RenameClip failed: Invalid clip name')
      return fail('Invalid clip name')
    }
    if (typeof newName !== 'string' || !newName) {
      getLogger().warning('clips', 'RenameClip failed: Invalid new name')
      return fail('Invalid new name')
    }
    let resolvedName = newName
    if (resolvedName.endsWith('.mp4')) {
      resolvedName = resolvedName.slice(0, -4)
    }
    if (!resolvedName) {
      getLogger().warning('clips', 'RenameClip failed: Invalid new name (empty after stripping .mp4)')
      return fail('Invalid new name')
    }
    resolvedName = `${resolvedName}.mp4`
    const oldPath = clipPathInOutputDir(clipName)
    if (!oldPath) {
      getLogger().warning('clips', `RenameClip failed: Invalid old clip name '${clipName}'`)
      return fail('Invalid old clip name')
    }
    const newPath = clipPathInOutputDir(resolvedName)
    if (!newPath) {
      getLogger().warning('clips', `RenameClip failed: Invalid new clip name '${resolvedName}'`)
      return fail('Invalid new clip name')
    }
    try {
      if (!(await fileExists(oldPath))) {
        getLogger().warning('clips', `RenameClip failed: Clip '${clipName}' not found`)
        return fail('Clip not found')
      }
      if (await fileExists(newPath)) {
        getLogger().warning('clips', `RenameClip failed: A clip named '${resolvedName}' already exists`)
        return fail('A clip with that name already exists')
      }
      await rename(oldPath, newPath)
      const outputDir = getDefaultOutputDir()
      const oldThumbPath = getCachedThumbnailPath(outputDir, clipName)
      if (oldThumbPath && (await fileExists(oldThumbPath))) {
        const newThumbPath = join(outputDir, '.thumbnails', `${resolvedName.replace(/\.mp4$/, '')}.jpg`)
        try {
          await rename(oldThumbPath, newThumbPath)
        } catch {
          /* ignore thumbnail rename failure */
        }
      }
      const oldEngineThumb = join(outputDir, `${clipName.replace(/\.mp4$/, '')}.thumb.jpg`)
      if (await fileExists(oldEngineThumb)) {
        const newEngineThumb = join(outputDir, `${resolvedName.replace(/\.mp4$/, '')}.thumb.jpg`)
        try {
          await rename(oldEngineThumb, newEngineThumb)
        } catch {
          /* ignore engine thumbnail rename failure */
        }
      }
      const oldFavPath = join(outputDir, `.${clipName}.favorite`)
      if (await fileExists(oldFavPath)) {
        const newFavPath = join(outputDir, `.${resolvedName}.favorite`)
        try {
          await rename(oldFavPath, newFavPath)
        } catch {
          /* ignore favorite rename failure */
        }
      }
      invalidateDurationCache(oldPath)
      invalidateClipsCache()
      return ok()
    } catch (err) {
      const msg = errMessage(err)
      getLogger().warning('clips', `RenameClip failed: ${msg}`)
      return fail(msg)
    }
  })

  ipcMain.handle(IPC.CLIPS_OPEN_CLIP, async (_event, clipPath: unknown): Promise<void> => {
    if (typeof clipPath !== 'string') return
    const safe = clipPathInOutputDir(clipPath)
    if (!safe) return
    try {
      await shell.openPath(safe)
    } catch (err) {
      getLogger().error('clips', `Failed to open clip: ${err}`)
    }
  })

  ipcMain.handle(IPC.CLIPS_GET_THUMBNAIL, async (_event, clipName: unknown): Promise<string | null> => {
    if (typeof clipName !== 'string') return null
    const safe = clipPathInOutputDir(`${clipName}.mp4`)
    if (!safe) return null
    return getThumbnailDataUrl(getDefaultOutputDir(), clipName)
  })

  ipcMain.handle(IPC.CLIPS_GET_CONFIG, () => getCurrentConfigPayload())

  ipcMain.handle(IPC.CLIPS_SET_CONFIG, async (_event, config: unknown): Promise<IpcResult> => {
    getLogger().info('clips', `Config update requested: ${JSON.stringify(config)}`)
    const c = config as Record<string, unknown> | undefined
    if (c) {
      if (typeof c.replayTimeSeconds === 'number')
        C.engineReplayTimeSeconds = Math.max(30, Math.min(600, c.replayTimeSeconds))
      if (typeof c.fps === 'number') C.engineFps = normalizeFps(c.fps)
      if (typeof c.width === 'number') C.width = c.width
      if (typeof c.height === 'number') C.height = c.height
      if (typeof c.bitrateKbps === 'number') C.bitrateKbps = c.bitrateKbps
      if (typeof c.cq === 'number') C.cq = Math.max(0, Math.min(51, c.cq))
      if (typeof c.maxrateKbps === 'number') C.maxrateKbps = Math.max(1000, c.maxrateKbps)
      if (typeof c.bufsizeKbps === 'number') C.bufsizeKbps = Math.max(2000, c.bufsizeKbps)
      if (typeof c.bframes === 'number') C.bframes = Math.max(0, Math.min(16, c.bframes))
      if (typeof c.lookahead === 'number') C.lookahead = Math.max(0, Math.min(256, c.lookahead))
      if (typeof c.encoderPreset === 'string' && VALID_ENCODER_PRESETS.has(c.encoderPreset))
        C.encoderPreset = c.encoderPreset
      C.codec = 'auto'
      if (typeof c.adapterIndex === 'number') C.adapterIndex = c.adapterIndex
      if (typeof c.micEnabled === 'boolean') C.micEnabled = c.micEnabled
      if (typeof c.audioLoopback === 'boolean') C.audioLoopback = c.audioLoopback
      if (typeof c.stretchToFit === 'boolean') C.stretchToFit = c.stretchToFit
      if (c.replayBufferMode === 'ram' || c.replayBufferMode === 'hybrid' || c.replayBufferMode === 'disk')
        C.replayBufferMode = c.replayBufferMode
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
      if (typeof c.gameVolume === 'number') C.gameVolume = Math.max(0, Math.min(4, c.gameVolume))
      if (typeof c.micVolume === 'number') C.micVolume = Math.max(0, Math.min(4, c.micVolume))
      if (c.pushToTalk === 'off' || c.pushToTalk === 'hold' || c.pushToTalk === 'toggle') C.pushToTalk = c.pushToTalk
      if (Array.isArray(c.pushToTalkKeys)) {
        C.pushToTalkKeys = (c.pushToTalkKeys as unknown[]).filter((k) => typeof k === 'number') as number[]
        if (C.pushToTalkKeys.length === 0) C.pushToTalkKeys = [0x7a]
      } else if (typeof c.pushToTalkKey === 'number') {
        C.pushToTalkKeys = [c.pushToTalkKey as number]
      }
      if (Array.isArray(c.hotkeys)) {
        // Migra ações legadas na ESCRITA também (pushToTalk → toggleMic, toggleCapture →
        // screenshot): o load já migra, mas sem isto uma config antiga re-entraria pela UI
        // e seria re-persistida com a ação morta (o <select> de ClipsConfigGame.tsx não a
        // oferece mais → valor branco).
        C.hotkeys = migrateHotkeys(
          c.hotkeys.filter(
            (h): h is HotkeyBinding =>
              typeof h === 'object' &&
              h !== null &&
              typeof (h as Record<string, unknown>).vk === 'number' &&
              typeof (h as Record<string, unknown>).action === 'string' &&
              Array.isArray((h as Record<string, unknown>).modifiers),
          ),
        )
      }
      if (typeof c.outputDirectory === 'string' && c.outputDirectory.length > 0 && c.outputDirectory.length < 1024) {
        try {
          const stat = await fsStat(c.outputDirectory)
          if (stat.isDirectory()) {
            C.outputDirectory = c.outputDirectory
          }
        } catch {
          /* reject invalid path */
        }
      }
      if (typeof c.noiseSuppression === 'boolean') C.noiseSuppression = c.noiseSuppression
      if (typeof c.audioSampleRate === 'number') C.audioSampleRate = c.audioSampleRate
      if (typeof c.autoCleanupEnabled === 'boolean') C.autoCleanupEnabled = c.autoCleanupEnabled
      if (typeof c.autoCleanupThresholdGB === 'number')
        C.autoCleanupThresholdGB = Math.max(1, Math.min(100, c.autoCleanupThresholdGB))
      if (typeof c.adaptiveQuality === 'boolean') C.adaptiveQuality = c.adaptiveQuality
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
        return fail(syncResult.error || 'Config sync to engine failed')
      }
    } else {
      getLogger().info('clips', 'Config sync: pipe not connected, skipping')
    }
    return ok()
  })

  ipcMain.handle(IPC.CLIPS_SELECT_OUTPUT_DIR, async (): Promise<string | null> => {
    const win = BrowserWindow.getFocusedWindow()
    const opts: Electron.OpenDialogOptions = {
      title: 'Escolher pasta de saída dos clipes',
      properties: ['openDirectory', 'createDirectory'],
      defaultPath: getDefaultOutputDir(),
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (result.canceled || !result.filePaths.length) return null
    const selectedPath = result.filePaths[0]!
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

  ipcMain.handle(IPC.CLIPS_SET_AUDIO_SESSIONS, async (_event, sessionPids: unknown): Promise<IpcResult> => {
    if (!Array.isArray(sessionPids)) {
      getLogger().warning('clips', 'SetAudioSessions failed: sessionPids must be an array')
      return fail('sessionPids must be an array')
    }
    const pids = sessionPids.filter((p): p is number => typeof p === 'number')
    C.selectedAudioSessions = pids
    persistClipsConfig()
    if (!isPipeConnected()) {
      getLogger().warning('clips', 'SetAudioSessions failed: engine pipe not connected')
      return fail('Engine pipe not connected')
    }
    try {
      const resp = await sendPipeCommand('setAudioSessions', { pids })
      if (resp.payload?.success === false) {
        getLogger().warning('clips', `SetAudioSessions failed: ${resp.payload?.error || 'Command failed'}`)
        return fail((resp.payload?.error as string) || 'Command failed')
      }
      return ok()
    } catch (err) {
      getLogger().warning('clips', `SetAudioSessions failed: ${errMessage(err)}`)
      return fail(errMessage(err))
    }
  })

  ipcMain.handle(IPC.CLIPS_GET_MIC_DEVICES, async (): Promise<MicDeviceInfo[]> => {
    getLogger().info('clips-mic', `pipeConnected=${isPipeConnected()}`)
    if (isPipeConnected()) {
      try {
        const resp = await sendPipeCommand('getMicDevices')
        getLogger().info(
          'clips-mic',
          `response cmd=${resp.cmd} payload keys=${Object.keys(resp.payload ?? {})} hasDevices=${'devices' in (resp.payload ?? {})}`,
        )
        const devices = resp.payload?.devices
        if (Array.isArray(devices)) {
          getLogger().info('clips-mic', `returning ${devices.length} devices from engine`)
          return devices as MicDeviceInfo[]
        }
        getLogger().warning('clips-mic', 'devices is not an array')
      } catch (err) {
        getLogger().warning('clips-mic', `pipe error: ${errMessage(err)}`)
      }
    }
    return enumerateMicDevicesLocal()
  })

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
        // 0x1414 = Microsoft Basic Render Driver (software fallback, no hw encoder)
        const gpus = (resp.payload as GpuInfo[]).filter(
          (gpu) => gpu && typeof gpu === 'object' && typeof gpu.vendorId === 'number' && gpu.vendorId !== 0x1414,
        )
        // Persist the result so enhancement stays available on later runs even
        // when the engine is stopped (the pipe cannot answer while it is down).
        const amdDetected = gpus.some((gpu) => gpu.vendorId === AMD_VENDOR_ID)
        _amdDetected = amdDetected
        rememberAmdDetection(amdDetected)
        return gpus
      }
      return []
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC.CLIPS_GET_ENHANCE_SUPPORT, (): { amd: boolean } => ({
    amd: resolveAmdAvailable(_amdDetected),
  }))

  ipcMain.handle(IPC.CLIPS_SET_FAVORITE, async (_event, clipName: unknown, favorite: unknown): Promise<IpcResult> => {
    if (typeof clipName !== 'string' || !clipName) {
      getLogger().warning('clips', 'SetFavorite failed: Invalid clip name')
      return fail('Invalid clip name')
    }
    if (typeof favorite !== 'boolean') {
      getLogger().warning('clips', 'SetFavorite failed: Invalid favorite value (must be boolean)')
      return fail('Invalid favorite value')
    }
    const resolvedName = clipPathInOutputDir(`.${clipName}.favorite`)
    if (!resolvedName) {
      getLogger().warning('clips', `SetFavorite failed: Invalid clip name '${clipName}'`)
      return fail('Invalid clip name')
    }
    try {
      if (favorite) {
        await writeFile(resolvedName, '', 'utf-8')
      } else {
        if (await fileExists(resolvedName)) {
          await unlink(resolvedName)
        }
      }
      return ok()
    } catch (err) {
      const msg = errMessage(err)
      getLogger().error('clips', `Failed to set favorite: ${msg}`)
      return fail(msg)
    }
  })

  // ── Encode cluster (trim/merge + cancel) lives in clips-encode.ipc.ts ──
  registerClipsEncodeIpc({ amdDetected: () => _amdDetected })

  ipcMain.handle(IPC.CLIPS_OPEN_EXTERNAL, (_event, url: unknown): IpcResult => {
    if (typeof url !== 'string') {
      return fail('Invalid URL')
    }
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'https:') {
        getLogger().warning('clips', `Blocked non-https external URL: ${url}`)
        return fail('Only https URLs are allowed')
      }
      shell.openExternal(parsed.toString())
      return { success: true, data: { opened: true } }
    } catch {
      getLogger().warning('clips', `Invalid external URL: ${url}`)
      return fail('Invalid URL')
    }
  })

  ipcMain.handle(IPC.CLIPS_PUBLISH, async (_event, clipPath: unknown): Promise<IpcResult> => {
    if (typeof clipPath !== 'string' || !clipPath) {
      getLogger().warning('clips', 'Publish failed: Invalid clip path')
      return fail('Invalid clip path')
    }
    const safe = clipPathInOutputDir(clipPath)
    if (!safe || !(await fileExists(safe))) {
      getLogger().warning('clips', `Publish failed: Clip file not found '${clipPath}'`)
      return fail('Clip file not found')
    }
    if (_publishingPaths.has(safe)) {
      getLogger().warning('clips', 'Publish failed: Upload already in progress')
      return fail('Upload already in progress')
    }
    const controller = new AbortController()
    _publishingPaths.add(safe)
    _publishingControllers.set(safe, controller)
    try {
      const result = await uploadClipToGofile(
        safe,
        (progress) => {
          for (const win of BrowserWindow.getAllWindows()) {
            win.webContents.send(IPC.CLIPS_PUBLISH_PROGRESS, { clipPath: safe, ...progress })
          }
        },
        controller.signal,
      )
      return result.success
        ? { success: true, data: { link: result.link } }
        : {
            success: false,
            error: result.error ?? 'Upload failed',
            ...(result.cancelled ? { code: 'ABORTED' } : {}),
          }
    } finally {
      _publishingPaths.delete(safe)
      _publishingControllers.delete(safe)
    }
  })

  ipcMain.handle(IPC.CLIPS_PUBLISH_CANCEL, (_event, clipPath: unknown): IpcResult => {
    if (typeof clipPath !== 'string' || !clipPath) {
      return fail('Invalid clip path')
    }
    const safe = clipPathInOutputDir(clipPath)
    const controller = safe ? _publishingControllers.get(safe) : undefined
    if (!safe || !controller) {
      getLogger().warning('clips', 'Publish cancel failed: no upload in progress')
      return fail('No upload in progress')
    }
    controller.abort(new Error('Aborted'))
    return ok()
  })
}

/** How many clip uploads are in flight. Read by the update-install guard. */
export function activePublishCount(): number {
  return _publishingPaths.size
}
