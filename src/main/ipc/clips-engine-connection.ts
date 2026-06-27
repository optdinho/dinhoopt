import { type ChildProcess, execFile, execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { type Socket, connect as netConnect } from 'node:net'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import type { ClipInfo, ClipsEngineStatus, HotkeyBinding } from '@shared/types'
import { BrowserWindow, app } from 'electron'
import {
  config as C,
  buildEngineConfig,
  getDefaultOutputDir,
  persistClipsConfig,
} from '../services/clips-config-manager'
import { getLogger } from '../services/logger.service'
import { getCachedThumbnailPath } from '../services/thumbnail-generator'

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

let engineProcess: ChildProcess | null = null
let pipeSocket: Socket | null = null
let pipeConnected = false
let pipeBuffer = ''
let engineRunning = false
let engineCapturing = false
let engineStartTime = 0
let engineCaptureBackend = ''
let engineEncoder = ''
let engineReplayBufferBytes = 0
let engineEstimatedRamMB = 0
let engineDiskSpaceOk = true
let engineCurrentGame = ''
let engineLastCrashRecovered = false
let engineAudioLoopback = false
let engineAudioFallback = false
let engineReplayBufferVideoFrames = 0
let engineReplayBufferVideoBytes = 0
let engineReplayBufferAudioPackets = 0
let engineReplayBufferAudioBytes = 0
const pendingRequests = new Map<string, PendingRequest>()
let reconnectTimer: ReturnType<typeof setTimeout> | null = null

export function isEngineRunning(): boolean {
  return engineRunning
}

export function isEngineCapturing(): boolean {
  return engineCapturing
}

export function isPipeConnected(): boolean {
  return pipeConnected
}

export function getEnginePid(): number | undefined {
  return engineProcess?.pid
}

export function setEngineCapturing(v: boolean): void {
  engineCapturing = v
}

function getEnginePath(): string {
  if (process.env.DINHO_CLIPS_ENGINE_PATH && existsSync(process.env.DINHO_CLIPS_ENGINE_PATH)) {
    return process.env.DINHO_CLIPS_ENGINE_PATH
  }
  const desktop = process.env.USERPROFILE ? join(process.env.USERPROFILE, 'Desktop') : ''
  const isDev = !app.isPackaged
  const engineSubpath = join(
    'src',
    'DiNho.Capture.Poc',
    'bin',
    isDev ? 'Debug' : 'Release',
    'net9.0-windows10.0.26100.0',
    isDev ? ENGINE_EXE : join('publish', ENGINE_EXE),
  )
  const candidates = [
    desktop ? join(desktop, 'dinho-clips-poc', engineSubpath) : '',
    join(__dirname, '..', '..', 'dinho-clips-poc', engineSubpath),
    join(__dirname, '..', '..', 'clips-engine', ENGINE_EXE),
    join(process.resourcesPath || '', 'clips-engine', ENGINE_EXE),
    join(process.cwd(), 'dinho-clips-poc', engineSubpath),
  ]
  for (const p of candidates) {
    if (p && existsSync(p)) return p
  }
  const fallback = desktop ? join(desktop, 'dinho-clips-poc', engineSubpath) : (candidates[1] ?? ENGINE_EXE)
  return fallback
}

export { getEnginePath }

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

export async function readClipsFromDisk(): Promise<ClipInfo[]> {
  const dir = getDefaultOutputDir()
  if (!existsSync(dir)) return []
  try {
    const files = readdirSync(dir).filter((f) => f.endsWith('.mp4'))
    const entries = files.map((f) => {
      const fullPath = join(dir, f)
      try {
        const stat = statSync(fullPath)
        return {
          name: f,
          path: fullPath,
          size: stat.size,
          createdAt: stat.birthtime.getTime() > 0 ? stat.birthtime.toISOString() : stat.mtime.toISOString(),
          durationPromise: getVideoDuration(fullPath),
        }
      } catch {
        return null
      }
    })
    const resolved = await Promise.all(
      entries
        .filter((e): e is NonNullable<typeof e> => e !== null)
        .map(async (e) => ({
          name: e.name,
          path: e.path,
          size: e.size,
          createdAt: e.createdAt,
          duration: await e.durationPromise,
        })),
    )
    return resolved.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  } catch (err) {
    getLogger().error('clips', `Failed to list clips: ${err}`)
    return []
  }
}

export function getCurrentStatus(): ClipsEngineStatus {
  return {
    running: engineRunning,
    capturing: engineCapturing,
    uptime: engineRunning ? Math.floor((Date.now() - engineStartTime) / 1000) : 0,
    fps: C.engineFps,
    replayTimeSeconds: C.engineReplayTimeSeconds,
    captureBackend: engineCaptureBackend || undefined,
    encoder: engineEncoder || undefined,
    estimatedRamMB: engineEstimatedRamMB || undefined,
    diskSpaceOk: engineDiskSpaceOk,
    currentGame: C.customGameProcess || engineCurrentGame || undefined,
    customGameProcess: C.customGameProcess || undefined,
    lastCrashRecovered: engineLastCrashRecovered || undefined,
    audioLoopback: engineAudioLoopback || undefined,
    audioFallback: engineAudioFallback || undefined,
    audioSampleRate: C.audioSampleRate,
    replayBufferBytes: engineReplayBufferBytes || undefined,
    replayBufferVideoFrames: engineReplayBufferVideoFrames || undefined,
    replayBufferVideoBytes: engineReplayBufferVideoBytes || undefined,
    replayBufferAudioPackets: engineReplayBufferAudioPackets || undefined,
    replayBufferAudioBytes: engineReplayBufferAudioBytes || undefined,
  }
}

export function sendPipeCommand(cmd: string, payload?: Record<string, unknown>): Promise<PipeMessage> {
  return new Promise((resolve, reject) => {
    if (!pipeSocket || !pipeConnected) {
      reject(new Error('Pipe not connected'))
      return
    }
    const existing = pendingRequests.get(cmd)
    if (existing) {
      clearTimeout(existing.timer)
      pendingRequests.delete(cmd)
    }

    const envelope: PipeEnvelope = { v: 1, cmd, ...(payload !== undefined ? { payload } : {}) }
    const line = `${JSON.stringify(envelope)}\n`
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
    const d = p.data as Record<string, unknown> | undefined
    const src = d ?? p
    getLogger().info(
      'clips-pipe',
      `Engine status: game="${src.game}" recording=${src.recording} fps=${src.fps} backend=${src.captureBackend}`,
    )

    engineCapturing = src.recording === true
    if (typeof src.fps === 'number') C.engineFps = src.fps
    if (typeof src.replayTimeSeconds === 'number') C.engineReplayTimeSeconds = src.replayTimeSeconds
    if (typeof src.captureBackend === 'string') engineCaptureBackend = src.captureBackend
    if (typeof src.encoder === 'string') engineEncoder = src.encoder
    if (typeof src.estimatedRamMB === 'number') engineEstimatedRamMB = src.estimatedRamMB
    if (typeof src.diskSpaceOk === 'boolean') engineDiskSpaceOk = src.diskSpaceOk
    if (typeof src.game === 'string') engineCurrentGame = src.game
    if (typeof src.lastCrashRecovered === 'boolean') engineLastCrashRecovered = src.lastCrashRecovered
    if (typeof src.audioLoopback === 'boolean') {
      engineAudioLoopback = src.audioLoopback
      C.audioLoopback = src.audioLoopback
    }
    if (typeof src.audioFallback === 'boolean') {
      engineAudioFallback = src.audioFallback
    }
    if (typeof src.gameVolume === 'number') C.gameVolume = Math.max(0, Math.min(2, src.gameVolume))
    if (typeof src.micVolume === 'number') C.micVolume = Math.max(0, Math.min(2, src.micVolume))
    if (typeof src.width === 'number') C.width = src.width
    if (typeof src.height === 'number') C.height = src.height
    if (typeof src.bitrateKbps === 'number') C.bitrateKbps = src.bitrateKbps
    if (typeof src.audioSampleRate === 'number') C.audioSampleRate = src.audioSampleRate
    if (typeof src.replayBufferBytes === 'number') engineReplayBufferBytes = src.replayBufferBytes
    if (typeof src.replayBufferVideoFrames === 'number') engineReplayBufferVideoFrames = src.replayBufferVideoFrames
    if (typeof src.replayBufferVideoBytes === 'number') engineReplayBufferVideoBytes = src.replayBufferVideoBytes
    if (typeof src.replayBufferAudioPackets === 'number') engineReplayBufferAudioPackets = src.replayBufferAudioPackets
    if (typeof src.replayBufferAudioBytes === 'number') engineReplayBufferAudioBytes = src.replayBufferAudioBytes
    if (typeof src.outputDirectory === 'string' && src.outputDirectory) {
      const engineDir = src.outputDirectory as string
      if (C.outputDirectory && C.outputDirectory !== engineDir) {
        getLogger().warning(
          'clips',
          `Output directory mismatch: frontend="${C.outputDirectory}" engine="${engineDir}" — adopting engine directory`,
        )
      }
      C.outputDirectory = engineDir
    }
    persistClipsConfig()
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
    if (win) {
      win.webContents.send(IPC.CLIPS_ENGINE_STATUS, getCurrentStatus())
    }
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
    syncConfigOnConnect()
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

async function syncConfigOnConnect(): Promise<void> {
  try {
    const engineConfig = buildEngineConfig()
    await sendWithFallback('config', engineConfig)
    getLogger().info('clips-pipe', 'Full config synced to engine on connect')
  } catch {
    getLogger().warning('clips-pipe', 'Config sync on connect failed (will retry on next config update)')
  }
}

export async function sendWithFallback(
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

export async function startClipCapture(): Promise<{ success: boolean; error?: string }> {
  if (!engineRunning) {
    return { success: false, error: 'Engine not running' }
  }
  if (engineCapturing) {
    return { success: true }
  }
  const rawProcessName = (engineCurrentGame || '').replace(/ \(.*?\) \[.*?\]$/, '').trim()
  const targetGame = C.customGameProcess || rawProcessName || ''
  getLogger().info(
    'clips',
    `startClipCapture: targetGame="${targetGame}" configCustomGameProcess="${C.customGameProcess}" engineCurrentGame="${engineCurrentGame}"`,
  )
  const payload = targetGame ? { gameProcess: targetGame } : undefined
  const result = await sendWithFallback('startCapture', payload)
  if (result.success) {
    engineCapturing = true
  }
  return result
}

export function stopEngineProcess(): void {
  if (!engineProcess) return
  try {
    if (pipeConnected) {
      sendPipeCommand('stopEngine').catch(() => {})
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
}

export async function startEngine(): Promise<{ success: boolean; error?: string }> {
  if (engineRunning) return { success: true }

  const exePath = getEnginePath()
  if (!existsSync(exePath)) {
    const err = `Engine executable not found at: ${exePath}`
    getLogger().error('clips', err)
    return { success: false, error: err }
  }

  try {
    execFile('taskkill', ['/F', '/IM', 'DiNho.Capture.Poc.exe'], { timeout: 3000, windowsHide: true }, () => {})
    await new Promise((resolve) => setTimeout(resolve, 500))
  } catch {
    /* ok */
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

    if (!app.isPackaged) {
      try {
        const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
        if (win) win.webContents.openDevTools()
      } catch {
        /* OK */
      }
    }

    connectPipe()

    const connected = await waitForPipeConnection(8000)
    if (!connected) {
      const msg = `Engine pipe not connected after timeout (engineRunning=${engineRunning}, pid=${engineProcess?.pid})`
      getLogger().error('clips', msg)
      cleanup()
      return { success: false, error: msg }
    }

    const initialConfig = buildEngineConfig()
    const hkInfo = (initialConfig.Hotkeys as Record<string, unknown>[]).map(
      (h) => `vk=0x${(h.vk as number).toString(16)} mods=[${(h.modifiers as number[]).join(',')}] act=${h.action}`,
    )
    getLogger().info('clips', `Initial config sync: pipeConnected=${pipeConnected} hotkeys=${JSON.stringify(hkInfo)}`)
    sendWithFallback('config', initialConfig).catch(() => {
      getLogger().warning('clips', 'Initial config sync to engine failed')
    })

    if (C.selectedAudioSessions.length > 0) {
      sendPipeCommand('setAudioSessions', { pids: C.selectedAudioSessions }).catch(() => {
        getLogger().warning('clips', 'Initial audio session sync to engine failed')
      })
    }

    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    getLogger().error('clips', `Failed to start engine: ${msg}`)
    engineRunning = false
    return { success: false, error: msg }
  }
}
