import { type ChildProcess, execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { connect as netConnect, type Socket } from 'node:net'
import { IPC } from '@shared/channels'
import type {
  AudioSessionInfo,
  ClipInfo,
  ClipsConfig,
  ClipsEngineStatus,
  HotkeyBinding,
  MicDeviceInfo,
} from '@shared/types'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { getLogger } from '../services/logger.service'
import { loadClipsConfig, saveClipsConfig } from '../services/clips-config-store'
import { getCachedThumbnailPath, getThumbnailDataUrl } from '../services/thumbnail-generator'

const ENGINE_PIPE = '\\\\.\\pipe\\dinho-clips-engine'
const ENGINE_EXE = 'DiNho.Capture.Poc.exe'
const PIPE_CONNECT_TIMEOUT = 10_000
const PIPE_RECONNECT_DELAY = 3_000
const ENGINE_GRACE_PERIOD = 5_000

interface PipeEnvelope {
  v: number
  cmd: string
  payload?: Record<string, unknown>
}

interface PipeMessage {
  cmd: string
  payload?: Record<string, unknown>
}

type PendingRequest = {
  resolve: (value: PipeMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const MODIFIER_VK_MAP: Record<string, number> = {
  Ctrl: 0x11,
  Shift: 0x10,
  Alt: 0x12,
}

function buildEngineConfig(): Record<string, unknown> {
  const hks = configHotkeys.length > 0 ? configHotkeys : defaultHotkeys()
  return {
    replayTimeSeconds: engineReplayTimeSeconds,
    micEnabled: configMicEnabled,
    audioLoopback: configAudioLoopback,
    fps: engineFps,
    width: configWidth,
    height: configHeight,
    bitrateKbps: configBitrateKbps,
    outputDirectory: getDefaultOutputDir(),
    forceSoftware: configForceSoftware,
    Hotkeys: hks.map((hk) => ({
      vk: hk.vk,
      modifiers: hk.modifiers.map((m) => MODIFIER_VK_MAP[m] ?? 0),
      action: hk.action.charAt(0).toUpperCase() + hk.action.slice(1),
      replayDurationSeconds: hk.replayDurationSeconds,
      enabled: hk.enabled,
    })),
    pushToTalk: configPushToTalk,
    pushToTalkKeys: configPushToTalkKeys,
    gameDetection: configGameDetection,
    gameAudioOnly: configGameAudioOnly,
    customGameProcess: configCustomGameProcess || undefined,
    micDeviceId: configMicDeviceId || undefined,
    autoStartCapture: configAutoStartCapture || undefined,
    useExcludeMode: configUseExcludeMode,
    excludeProcessId: configUseExcludeMode ? process.pid : configExcludeProcessId,
    gameVolume: configGameVolume,
    micVolume: configMicVolume,
    pushToTalkKey: configPushToTalkKeys[0],
    selectedAudioSessions: configSelectedAudioSessions.length > 0 ? configSelectedAudioSessions : undefined,
  }
}

let engineProcess: ChildProcess | null = null
let pipeSocket: Socket | null = null
let pipeConnected = false
let pipeBuffer = ''
let engineRunning = false
let engineCapturing = false
let engineStartTime = 0
let engineFps = 60
let engineReplayTimeSeconds = 60
let engineCaptureBackend = ''
let engineEncoder = ''
let engineEstimatedRamMB = 0
let engineDiskSpaceOk = true
let engineCurrentGame = ''
let engineLastCrashRecovered = false
let engineAudioLoopback = false
let engineAudioFallback = false
let configWidth = 1920
let configHeight = 1080
let configBitrateKbps = 20000
let configMicEnabled = true
let configAudioLoopback = false
let configForceSoftware = false
let configPushToTalk: 'off' | 'hold' | 'toggle' = 'off'
let configPushToTalkKeys: number[] = [0x7a]
let configGameDetection = false
let configGameAudioOnly = false
let configCustomGameProcess = ''
let configMicDeviceId = ''
let configAutoStartCapture = false
let configUseExcludeMode = false
let configExcludeProcessId = 0
let configHotkeys: HotkeyBinding[] = []
let configOutputDirectory = ''
let configGameVolume = 1.0
let configMicVolume = 1.0
let configSelectedAudioSessions: number[] = []
let pendingRequests = new Map<string, PendingRequest>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

function loadPersistedClipsConfig(): void {
  const saved = loadClipsConfig()
  configWidth = saved.width
  configHeight = saved.height
  configBitrateKbps = saved.bitrateKbps
  configMicEnabled = saved.micEnabled
  configAudioLoopback = saved.audioLoopback
  configForceSoftware = saved.forceSoftware
  configPushToTalk = saved.pushToTalk
  configPushToTalkKeys = saved.pushToTalkKeys
  configGameDetection = saved.gameDetection
  configGameAudioOnly = saved.gameAudioOnly
  configCustomGameProcess = saved.customGameProcess
  configMicDeviceId = saved.micDeviceId ?? ''
  configAutoStartCapture = saved.autoStartCapture ?? false
  configUseExcludeMode = saved.useExcludeMode ?? false
  configExcludeProcessId = saved.excludeProcessId ?? 0
  configGameVolume = saved.gameVolume ?? 1.0
  configMicVolume = saved.micVolume ?? 1.0
  configHotkeys = saved.hotkeys
  configOutputDirectory = saved.outputDirectory
  engineReplayTimeSeconds = saved.replayTimeSeconds
  engineFps = saved.fps
}

function persistClipsConfig(): void {
  saveClipsConfig({
    width: configWidth,
    height: configHeight,
    bitrateKbps: configBitrateKbps,
    micEnabled: configMicEnabled,
    audioLoopback: configAudioLoopback,
    forceSoftware: configForceSoftware,
    pushToTalk: configPushToTalk,
    pushToTalkKeys: configPushToTalkKeys,
    gameDetection: configGameDetection,
    gameAudioOnly: configGameAudioOnly,
    customGameProcess: configCustomGameProcess,
    micDeviceId: configMicDeviceId,
    autoStartCapture: configAutoStartCapture,
    useExcludeMode: configUseExcludeMode,
    excludeProcessId: configExcludeProcessId,
    gameVolume: configGameVolume,
    micVolume: configMicVolume,
    hotkeys: configHotkeys,
    outputDirectory: configOutputDirectory,
    replayTimeSeconds: engineReplayTimeSeconds,
    fps: engineFps,
  })
}

loadPersistedClipsConfig()

function getEnginePath(): string {
  if (process.env.DINHO_CLIPS_ENGINE_PATH && existsSync(process.env.DINHO_CLIPS_ENGINE_PATH)) {
    return process.env.DINHO_CLIPS_ENGINE_PATH
  }
  const desktop = process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Desktop') : ''
  const engineSubpath = join(
    'src',
    'DiNho.Capture.Poc',
    'bin',
    'Release',
    'net9.0-windows10.0.26100.0',
    'publish',
    ENGINE_EXE,
  )
  const candidates = [
    // env var fallback on desktop
    desktop ? join(desktop, 'dinho-clips-poc', engineSubpath) : '',
    // inside project (dev): __dirname = out/main/, 2 levels up = project root
    join(__dirname, '..', '..', 'dinho-clips-poc', engineSubpath),
    // clips-engine dir variants
    join(__dirname, '..', '..', 'clips-engine', ENGINE_EXE),
    // packaged app
    join(process.resourcesPath || '', 'clips-engine', ENGINE_EXE),
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  const fallback = desktop ? join(desktop, 'dinho-clips-poc', engineSubpath) : (candidates[1] ?? ENGINE_EXE)
  return fallback
}

function getDefaultOutputDir(): string {
  if (configOutputDirectory) return configOutputDirectory
  return join(process.env.USERPROFILE || 'C:\\Users\\Administrator', 'Desktop', 'DiNhoClips')
}

function readClipsFromDisk(): ClipInfo[] {
  const dir = getDefaultOutputDir()
  if (!existsSync(dir)) return []
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith('.mp4'))
      .map((f) => {
        const fullPath = join(dir, f)
        try {
          const stat = statSync(fullPath)
          return {
            name: f,
            path: fullPath,
            size: stat.size,
            createdAt: stat.birthtime.toISOString(),
            duration: 0,
          }
        } catch {
          return null
        }
      })
      .filter((c): c is ClipInfo => c !== null)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch (err) {
    getLogger().error('clips', `Failed to list clips: ${err}`)
    return []
  }
}

function getCurrentStatus(): ClipsEngineStatus {
  return {
    running: engineRunning,
    capturing: engineCapturing,
    uptime: engineRunning ? Math.floor((Date.now() - engineStartTime) / 1000) : 0,
    fps: engineFps,
    replayTimeSeconds: engineReplayTimeSeconds,
    captureBackend: engineCaptureBackend || undefined,
    encoder: engineEncoder || undefined,
    estimatedRamMB: engineEstimatedRamMB || undefined,
    diskSpaceOk: engineDiskSpaceOk,
    currentGame: configCustomGameProcess || engineCurrentGame || undefined,
    customGameProcess: configCustomGameProcess || undefined,
    lastCrashRecovered: engineLastCrashRecovered || undefined,
    audioLoopback: engineAudioLoopback || undefined,
    audioFallback: engineAudioFallback || undefined,
  }
}

function sendPipeCommand(cmd: string, payload?: Record<string, unknown>): Promise<PipeMessage> {
  return new Promise((resolve, reject) => {
    if (!pipeSocket || !pipeConnected) {
      reject(new Error('Pipe not connected'))
      return
    }
    // Delete any existing pending request for this cmd (avoid duplicates)
    const existing = pendingRequests.get(cmd)
    if (existing) {
      clearTimeout(existing.timer)
      pendingRequests.delete(cmd)
    }

    const envelope: PipeEnvelope = { v: 1, cmd, ...(payload !== undefined ? { payload } : {}) }
    const line = JSON.stringify(envelope) + '\n'
    getLogger().info('clips-pipe', `Sending: cmd=${cmd} payload=${JSON.stringify(payload ?? null)}`)

    const timer = setTimeout(() => {
      pendingRequests.delete(cmd)
      reject(new Error(`Command "${cmd}" timed out`))
    }, 5000)

    pendingRequests.set(cmd, { resolve, reject, timer })

    try {
      pipeSocket.write(line)
    } catch (err) {
      pendingRequests.delete(cmd)
      clearTimeout(timer)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

function onPipeData(chunk: Buffer): void {
  pipeBuffer += chunk.toString('utf-8')
  const lines = pipeBuffer.split('\n')
  pipeBuffer = lines.pop() || ''

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const msg: PipeMessage = JSON.parse(trimmed)
      handlePipeMessage(msg)
    } catch {
      getLogger().warning('clips-pipe', `Unparseable line: ${trimmed.slice(0, 200)}`)
    }
  }
}

function handlePipeMessage(msg: PipeMessage): void {
  if (msg.cmd === '_event' && msg.payload?.type === 'engineStatus') {
    const p = msg.payload as Record<string, unknown>
    // Engine nests status fields under payload.data
    const d = p.data as Record<string, unknown> | undefined
    const src = d ?? p
    getLogger().info(
      'clips-pipe',
      `Engine status: game="${src.game}" recording=${src.recording} fps=${src.fps} backend=${src.captureBackend}`,
    )

    engineCapturing = src.recording === true
    if (typeof src.fps === 'number') engineFps = src.fps
    if (typeof src.replayTimeSeconds === 'number') engineReplayTimeSeconds = src.replayTimeSeconds
    if (typeof src.captureBackend === 'string') engineCaptureBackend = src.captureBackend
    if (typeof src.encoder === 'string') engineEncoder = src.encoder
    if (typeof src.estimatedRamMB === 'number') engineEstimatedRamMB = src.estimatedRamMB
    if (typeof src.diskSpaceOk === 'boolean') engineDiskSpaceOk = src.diskSpaceOk
    if (typeof src.game === 'string') engineCurrentGame = src.game
    if (typeof src.lastCrashRecovered === 'boolean') engineLastCrashRecovered = src.lastCrashRecovered
    if (typeof src.audioLoopback === 'boolean') {
      engineAudioLoopback = src.audioLoopback
      configAudioLoopback = src.audioLoopback
    }
    if (typeof src.audioFallback === 'boolean') {
      engineAudioFallback = src.audioFallback
    }
    if (typeof src.gameVolume === 'number') configGameVolume = Math.max(0, Math.min(2, src.gameVolume))
    if (typeof src.micVolume === 'number') configMicVolume = Math.max(0, Math.min(2, src.micVolume))
    if (typeof src.width === 'number') configWidth = src.width
    if (typeof src.height === 'number') configHeight = src.height
    if (typeof src.bitrateKbps === 'number') configBitrateKbps = src.bitrateKbps
    persistClipsConfig()
    return
  }

  const pending = pendingRequests.get(msg.cmd)
  if (pending) {
    pendingRequests.delete(msg.cmd)
    clearTimeout(pending.timer)
    getLogger().info(
      'clips-pipe',
      `Received response for cmd="${msg.cmd}" payload=${JSON.stringify(msg.payload ?? null)}`,
    )
    pending.resolve(msg)
  } else {
    getLogger().info('clips-pipe', `No pending request for cmd="${msg.cmd}" (maybe late response)`)
  }
}

function connectPipe(): void {
  if (pipeSocket) {
    pipeSocket.destroy()
    pipeSocket = null
  }
  pipeConnected = false

  getLogger().info('clips-pipe', `Connecting to ${ENGINE_PIPE}...`)
  const sock = netConnect(ENGINE_PIPE)
  pipeSocket = sock

  sock.setTimeout(PIPE_CONNECT_TIMEOUT)

  sock.on('connect', () => {
    pipeConnected = true
    getLogger().info('clips-pipe', 'Connected to engine pipe')
    if (configMicDeviceId) {
      sendWithFallback('setMicDevice', { deviceId: configMicDeviceId }).catch(() => {})
    }
  })

  sock.on('data', onPipeData)

  sock.on('error', (err) => {
    getLogger().warning('clips-pipe', `Pipe error: ${err.message}`)
    pipeConnected = false
  })

  sock.on('close', () => {
    pipeConnected = false
    pipeSocket = null
    if (engineRunning) {
      schedulePipeReconnect()
    }
  })

  sock.on('timeout', () => {
    getLogger().warning('clips-pipe', 'Pipe connect timeout')
    sock.destroy()
    pipeConnected = false
    if (engineRunning) {
      schedulePipeReconnect()
    }
  })
}

function schedulePipeReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (engineRunning) {
      connectPipe()
    }
  }, PIPE_RECONNECT_DELAY)
}

function disconnectPipe(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Pipe disconnected'))
  }
  pendingRequests.clear()
  if (pipeSocket) {
    pipeSocket.destroy()
    pipeSocket = null
  }
  pipeConnected = false
}

async function waitForPipeConnection(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let attempts = 0
  while (Date.now() < deadline) {
    if (pipeConnected) {
      getLogger().info('clips-pipe', `Pipe connected after ${attempts * 200}ms`)
      return true
    }
    attempts++
    if (attempts % 10 === 0) {
      getLogger().info('clips-pipe', `Waiting for pipe... attempt ${attempts}/${Math.floor(timeoutMs / 200)}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  getLogger().error(
    'clips-pipe',
    `Pipe wait timeout after ${attempts * 200}ms (pipeSocket=${!!pipeSocket}, pipeConnected=${pipeConnected})`,
  )
  return pipeConnected
}

async function sendWithFallback(
  cmd: string,
  payload?: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  if (!pipeConnected) {
    return { success: false, error: 'Engine pipe not connected' }
  }
  try {
    const resp = await sendPipeCommand(cmd, payload)
    if (resp.payload?.success === false || resp.payload?.error) {
      return { success: false, error: (resp.payload?.error as string) || 'Command failed' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function registerClipsIpc(): void {
  ipcMain.handle(IPC.CLIPS_GET_STATUS, getCurrentStatus)

  ipcMain.handle(IPC.CLIPS_START_ENGINE, async (): Promise<{ success: boolean; error?: string }> => {
    if (engineRunning) return { success: true }

    const exePath = getEnginePath()
    if (!existsSync(exePath)) {
      const err = `Engine executable not found at: ${exePath}`
      getLogger().error('clips', err)
      return { success: false, error: err }
    }

    // Mata qualquer engine órfão de sessão anterior que ainda tenha o pipe aberto
    try {
      execFile('taskkill', ['/F', '/IM', 'DiNho.Capture.Poc.exe'], { timeout: 3000, windowsHide: true }, () => {})
      await new Promise((resolve) => setTimeout(resolve, 500))
    } catch {
      /* se não tinha processo, ok */
    }

    try {
      engineProcess = spawn(exePath, [], {
        cwd: join(exePath, '..'),
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      })

      engineRunning = true
      engineStartTime = Date.now()
      pipeBuffer = ''

      const logStdout = (data: Buffer) => {
        const text = data.toString('utf-8').trim()
        if (text) {
          getLogger().info('clips-engine', text)
          process.stdout.write(`[ENGINE] ${text}\n`)
        }
      }
      const logStderr = (data: Buffer) => {
        const text = data.toString('utf-8').trim()
        if (text) {
          getLogger().warning('clips-engine', text)
          process.stdout.write(`[ENGINE:ERR] ${text}\n`)
        }
      }

      engineProcess.stdout?.on('data', logStdout)
      engineProcess.stderr?.on('data', logStderr)

      const cleanup = () => {
        engineRunning = false
        engineCapturing = false
        engineProcess = null
        disconnectPipe()
      }

      engineProcess.on('exit', (code) => {
        getLogger().info('clips', `Engine exited with code ${code}`)
        cleanup()
      })

      engineProcess.on('error', (err) => {
        getLogger().error('clips', `Engine process error: ${err.message}`)
        cleanup()
      })

      getLogger().info('clips', `Engine started from: ${exePath}, PID: ${engineProcess.pid}`)

      // Abrir DevTools automaticamente para logs do engine
      try {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (win) win.webContents.openDevTools()
      } catch {
        /* OK */
      }

      connectPipe()

      const connected = await waitForPipeConnection(8000)
      if (!connected) {
        const msg = `Engine pipe not connected after timeout (engineRunning=${engineRunning}, pid=${engineProcess?.pid})`
        getLogger().error('clips', msg)
        cleanup()
        return { success: false, error: msg }
      }

      // Sync current persisted config (hotkeys, mic device, etc.) to engine
      const initialConfig = buildEngineConfig()
      const hkInfo = (initialConfig.Hotkeys as Record<string, unknown>[]).map(
        (h) => `vk=0x${(h.vk as number).toString(16)} mods=[${(h.modifiers as number[]).join(',')}] act=${h.action}`,
      )
      getLogger().info('clips', `Initial config sync: pipeConnected=${pipeConnected} hotkeys=${JSON.stringify(hkInfo)}`)
      sendWithFallback('config', initialConfig).catch(() => {
        getLogger().warning('clips', 'Initial config sync to engine failed')
      })

      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      getLogger().error('clips', `Failed to start engine: ${msg}`)
      engineRunning = false
      return { success: false, error: msg }
    }
  })

  ipcMain.handle(IPC.CLIPS_STOP_ENGINE, async (): Promise<{ success: boolean; error?: string }> => {
    if (!engineProcess) return { success: true }
    try {
      if (pipeConnected) {
        await sendPipeCommand('stopEngine')
      }
    } catch {
      /* ignore pipe errors during shutdown */
    }

    disconnectPipe()

    try {
      engineProcess.kill('SIGTERM')
      setTimeout(() => {
        if (engineProcess && !engineProcess.killed) {
          engineProcess.kill('SIGKILL')
        }
      }, ENGINE_GRACE_PERIOD)
    } finally {
      engineRunning = false
      engineCapturing = false
      engineProcess = null
    }
    return { success: true }
  })

  ipcMain.handle(IPC.CLIPS_START_CAPTURE, async (): Promise<{ success: boolean; error?: string }> => {
    if (!engineRunning) {
      return { success: false, error: 'Engine not running' }
    }
    // Send the current game process so engine captures the right window
    // Strip KnownGame tag "(FiveM)" and display mode "[FSO]" → raw process name
    const rawProcessName = (engineCurrentGame || '').replace(/ \(.*?\) \[.*?\]$/, '').trim()
    const targetGame = configCustomGameProcess || rawProcessName || ''
    getLogger().info(
      'clips',
      `CLIPS_START_CAPTURE: targetGame="${targetGame}" configCustomGameProcess="${configCustomGameProcess}" engineCurrentGame="${engineCurrentGame}"`,
    )
    const payload = targetGame ? { gameProcess: targetGame } : undefined
    getLogger().info('clips', `CLIPS_START_CAPTURE: sending startCapture payload=${JSON.stringify(payload)}`)
    const result = await sendWithFallback('startCapture', payload)
    getLogger().info('clips', `CLIPS_START_CAPTURE: result success=${result.success} error=${result.error}`)
    if (result.success) {
      engineCapturing = true
    }
    return result
  })

  ipcMain.handle(IPC.CLIPS_STOP_CAPTURE, async (): Promise<{ success: boolean; error?: string }> => {
    if (!engineRunning) {
      engineCapturing = false
      return { success: true }
    }
    const result = await sendWithFallback('stopCapture')
    if (result.success) {
      engineCapturing = false
    }
    return result
  })

  ipcMain.handle(IPC.CLIPS_SAVE_CLIP, async (): Promise<{ success: boolean; error?: string }> => {
    if (!engineRunning) {
      return { success: false, error: 'Engine not running' }
    }
    if (!pipeConnected) {
      const deadline = Date.now() + 5000
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        if (pipeConnected) break
        if (!engineRunning) return { success: false, error: 'Engine not running' }
      }
    }
    return await sendWithFallback('saveClip')
  })

  ipcMain.handle(IPC.CLIPS_LIST_CLIPS, (): ClipInfo[] => {
    return readClipsFromDisk()
  })

  ipcMain.handle(
    IPC.CLIPS_DELETE_CLIP,
    async (_event, clipName: unknown): Promise<{ success: boolean; error?: string }> => {
      if (typeof clipName !== 'string') return { success: false, error: 'Invalid clip name' }
      const outputDir = getDefaultOutputDir()
      const clipPath = join(outputDir, clipName)
      if (!clipPath.startsWith(outputDir)) {
        return { success: false, error: 'Invalid path' }
      }
      try {
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

  function defaultHotkeys(): HotkeyBinding[] {
    return [
      { id: 'hk-save-8', vk: 0x77, modifiers: [], action: 'saveClip', replayDurationSeconds: 60, enabled: true },
      { id: 'hk-capture', vk: 0x78, modifiers: [], action: 'toggleCapture', enabled: true },
      { id: 'hk-mic', vk: 0x79, modifiers: [], action: 'toggleMic', enabled: true },
    ]
  }

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

  function getCurrentConfigPayload(): Record<string, unknown> {
    return {
      replayTimeSeconds: engineReplayTimeSeconds,
      micEnabled: configMicEnabled,
      audioLoopback: configAudioLoopback,
      fps: engineFps,
      width: configWidth,
      height: configHeight,
      bitrateKbps: configBitrateKbps,
      outputDirectory: getDefaultOutputDir(),
      forceSoftware: configForceSoftware,
      hotkeys: configHotkeys.length > 0 ? configHotkeys : defaultHotkeys(),
      pushToTalk: configPushToTalk,
      pushToTalkKeys: configPushToTalkKeys,
      gameDetection: configGameDetection,
      gameAudioOnly: configGameAudioOnly,
      customGameProcess: configCustomGameProcess || undefined,
      micDeviceId: configMicDeviceId || undefined,
      autoStartCapture: configAutoStartCapture || undefined,
      pushToTalkKey: configPushToTalkKeys[0],
      gameVolume: configGameVolume,
      micVolume: configMicVolume,
      selectedAudioSessions: configSelectedAudioSessions,
      useExcludeMode: configUseExcludeMode,
      excludeProcessId: configExcludeProcessId,
    }
  }

  ipcMain.handle(IPC.CLIPS_GET_CONFIG, (): ClipsConfig => getCurrentConfigPayload() as unknown as ClipsConfig)

  ipcMain.handle(
    IPC.CLIPS_SET_CONFIG,
    async (_event, config: unknown): Promise<{ success: boolean; error?: string }> => {
      getLogger().info('clips', `Config update requested: ${JSON.stringify(config)}`)
      const c = config as Record<string, unknown> | undefined
      if (c) {
        if (typeof c.replayTimeSeconds === 'number') engineReplayTimeSeconds = c.replayTimeSeconds
        if (typeof c.fps === 'number') engineFps = c.fps
        if (typeof c.width === 'number') configWidth = c.width
        if (typeof c.height === 'number') configHeight = c.height
        if (typeof c.bitrateKbps === 'number') configBitrateKbps = c.bitrateKbps
        if (typeof c.micEnabled === 'boolean') configMicEnabled = c.micEnabled
        if (typeof c.audioLoopback === 'boolean') configAudioLoopback = c.audioLoopback
        if (typeof c.forceSoftware === 'boolean') configForceSoftware = c.forceSoftware
        if (typeof c.gameDetection === 'boolean') configGameDetection = c.gameDetection
        if (typeof c.gameAudioOnly === 'boolean') configGameAudioOnly = c.gameAudioOnly
        if (typeof c.customGameProcess === 'string') {
          configCustomGameProcess = c.customGameProcess
          getLogger().info(
            'clips',
            `Config customGameProcess set to "${c.customGameProcess}" (pipeConnected=${pipeConnected})`,
          )
          if (pipeConnected && c.customGameProcess) {
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
          configMicDeviceId = c.micDeviceId
          if (pipeConnected) {
            sendWithFallback('setMicDevice', { deviceId: c.micDeviceId }).catch(() => {})
          }
        }
        if (typeof c.autoStartCapture === 'boolean') configAutoStartCapture = c.autoStartCapture
        if (typeof c.useExcludeMode === 'boolean') configUseExcludeMode = c.useExcludeMode
        if (typeof c.excludeProcessId === 'number') configExcludeProcessId = c.excludeProcessId
        if (typeof c.gameVolume === 'number') configGameVolume = Math.max(0, Math.min(2, c.gameVolume))
        if (typeof c.micVolume === 'number') configMicVolume = Math.max(0, Math.min(2, c.micVolume))
        if (c.pushToTalk === 'off' || c.pushToTalk === 'hold' || c.pushToTalk === 'toggle')
          configPushToTalk = c.pushToTalk
        if (Array.isArray(c.pushToTalkKeys)) {
          configPushToTalkKeys = (c.pushToTalkKeys as unknown[]).filter((k) => typeof k === 'number') as number[]
          if (configPushToTalkKeys.length === 0) configPushToTalkKeys = [0x7a]
        } else if (typeof c.pushToTalkKey === 'number') {
          configPushToTalkKeys = [c.pushToTalkKey as number]
        }
        if (Array.isArray(c.hotkeys)) configHotkeys = c.hotkeys as HotkeyBinding[]
        if (typeof c.outputDirectory === 'string') configOutputDirectory = c.outputDirectory
      }
      persistClipsConfig()
      if (pipeConnected) {
        // Best-effort sync to engine (may not have setConfig handler)
        const engineConfig = buildEngineConfig()
        const hotkeyInfo = (engineConfig.Hotkeys as Record<string, unknown>[]).map(
          (h) => `vk=0x${(h.vk as number).toString(16)} mods=[${(h.modifiers as number[]).join(',')}] act=${h.action}`,
        )
        getLogger().info(
          'clips',
          `Config sync to engine: hotkeys=${JSON.stringify(hotkeyInfo)} pipeConnected=${pipeConnected}`,
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
    configOutputDirectory = selectedPath
    return selectedPath
  })

  ipcMain.handle(IPC.CLIPS_GET_AUDIO_SESSIONS, async (): Promise<AudioSessionInfo[]> => {
    if (!pipeConnected) return []
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
      configSelectedAudioSessions = pids
      if (!pipeConnected) {
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
    getLogger().info('clips-mic', `pipeConnected=${pipeConnected}`)
    if (!pipeConnected) return []
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
      configMicDeviceId = deviceId
      persistClipsConfig()
      if (!pipeConnected) {
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
}
