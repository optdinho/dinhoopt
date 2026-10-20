import { connect as netConnect, type Socket } from 'node:net'
import { IPC } from '@shared/channels'
import type { ClipsEngineStatus } from '@shared/types'
import { BrowserWindow } from 'electron'
import { getLogger } from '../services/logger.service'

export const ENGINE_PIPE = '\\\\.\\pipe\\dinho-clips-engine'
const PIPE_CONNECT_TIMEOUT = 10_000
const PIPE_RECONNECT_DELAY = 3_000

// Protocol version shared with the C# engine handshake. Bump when the wire
// contract changes incompatibly (new required fields, envelope semantics, etc).
export const PROTO_VERSION = 1

// Set when the engine's handshake_ack reports failure or a protocol mismatch.
// While set, all commands except a re-handshake are rejected. Cleared on (re)connect.
let _handshakeError: string | null = null

// ─── Pipe types ──────────────────────────────────────────────

export interface PipeEnvelope {
  v: number
  cmd: string
  // 5.7: correlaciona a resposta com o pedido. O engine ecoa-o no envelope de
  // resposta (NamedPipeServer.cs:459) e roteia resultados long-running por ele
  // (ClientResponseRouter). Até a Fase 2 o Electron era o "cliente legacy que não
  // envia reqId" (NamedPipeServer.cs:324-325) — ver nota em nextReqId().
  reqId?: string
  payload?: Record<string, unknown>
}

export interface PipeMessage {
  cmd: string
  // Presente quando o engine ecoa o reqId do pedido; ausente em broadcasts
  // (_event/engineStatus/ramPressure) e em acks que o C# não ecoa.
  reqId?: string
  payload?: Record<string, unknown>
  // Raw JSON broadcasts from the engine (e.g. RamManager watchdog) carry no
  // v/cmd envelope — they arrive as { event: "ramPressure", ... }.
  event?: string
}

export type PendingRequest = {
  /** cmd original do pedido — usado para casar respostas sem reqId (fallback) e em logs. */
  cmd: string
  /** reqId gerado por nextReqId(); é a chave do pedido no mapa. */
  reqId: string
  resolve: (value: PipeMessage) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// ─── Request correlation (item 3) ────────────────────────────

// Sessão por processo + contador monótono: um reqId é legível no log
// (`getStatus-a1b2c3d4-2`) e nunca colide dentro da vida do processo. Entre
// processos a colisão é inócua: o engine desregistra os reqIds do cliente no
// disconnect (ClientResponseRouter.ForgetClient).
const REQ_SESSION = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
let _reqSeq = 0

function nextReqId(cmd: string): string {
  _reqSeq += 1
  return `${cmd}-${REQ_SESSION}-${_reqSeq}`
}

/**
 * Encontra e REMOVE o pendente que deve receber uma resposta.
 *
 * 1. Com `reqId` na resposta, só o pendente com esse reqId serve. Uma resposta
 *    atrasada de um pedido já expirado NÃO rouba o pendente vivo de outro pedido.
 * 2. Sem `reqId` — é o caso real: o C# não ecoa RequestId no ack "accepted" dos
 *    comandos long-running (NamedPipeServer.cs:428-434) e as respostas de clientes
 *    antigos também não trazem — resolve o pendente MAIS ANTIGO desse cmd. O pipe
 *    é FIFO, portanto a N-ésima resposta sem reqId corresponde ao N-ésimo pedido
 *    ainda pendente.
 */
function takePendingFor(
  map: Map<string, PendingRequest>,
  reqId: string | undefined,
  cmd: string | undefined,
): PendingRequest | null {
  if (reqId) {
    const hit = map.get(reqId)
    if (hit) map.delete(reqId)
    return hit ?? null
  }
  if (!cmd) return null
  for (const [key, pending] of map) {
    if (pending.cmd === cmd) {
      map.delete(key)
      return pending
    }
  }
  return null
}

// ─── State (owned by clips-engine-connection, accessed via getters/setters) ──

let _pipeSocket: Socket | null = null
let _pipeConnected = false
let _pipeBuffer = ''

export function getPipeSocket(): Socket | null {
  return _pipeSocket
}

export function isPipeConnected(): boolean {
  return _pipeConnected
}

// ─── Item 4: espera event-driven pela ligação ────────────────

type ConnectListener = () => void
const _connectListeners = new Set<ConnectListener>()

function notifyPipeConnected(): void {
  for (const listener of [..._connectListeners]) listener()
}

// ─── Request maps ────────────────────────────────────────────

export const pendingRequests = new Map<string, PendingRequest>()
export const longRunningPending = new Map<string, PendingRequest>()

let reconnectTimer: ReturnType<typeof setTimeout> | null = null

// ─── Status getters (called from handlePipeMessage) ──────────

// These are mutable references from clips-engine-connection
type StatusUpdater = (src: Record<string, unknown>) => void

let _statusUpdater: StatusUpdater | null = null
let _getCurrentStatus: (() => ClipsEngineStatus) | null = null

export function setStatusCallbacks(updater: StatusUpdater, getter: () => ClipsEngineStatus): void {
  _statusUpdater = updater
  _getCurrentStatus = getter
}

// ─── Pipe commands ───────────────────────────────────────────

function sendHandshake(): void {
  const reqId = nextReqId('handshake')
  const envelope: PipeEnvelope = { v: 1, cmd: 'handshake', reqId, payload: { protoVersion: PROTO_VERSION } }
  const line = `${JSON.stringify(envelope)}\n`
  getLogger().info('clips-pipe', `Sending: cmd=handshake reqId=${reqId} payload=${JSON.stringify(envelope.payload)}`)
  const timer = setTimeout(() => {
    pendingRequests.delete(reqId)
    getLogger().warning(
      'clips-pipe',
      'Handshake timed out — engine did not reply (old engine? commands proceed unverified)',
    )
  }, 5000)
  pendingRequests.set(reqId, { cmd: 'handshake', reqId, resolve: () => {}, reject: () => {}, timer })
  try {
    _pipeSocket?.write(line)
  } catch (err) {
    pendingRequests.delete(reqId)
    clearTimeout(timer)
    getLogger().warning('clips-pipe', `Handshake write failed: ${String(err)}`)
  }
}

function sendPipeCommandTracked(
  cmd: string,
  payload?: Record<string, unknown>,
): Promise<{ msg: PipeMessage; reqId: string }> {
  return new Promise((resolve, reject) => {
    if (!_pipeSocket || !_pipeConnected) {
      reject(new Error('Pipe not connected'))
      return
    }
    if (_handshakeError && cmd !== 'handshake') {
      reject(new Error(_handshakeError))
      return
    }

    // Item 3: cada pedido tem o SEU reqId — pedidos concorrentes do mesmo cmd
    // deixam de se "superseded" um ao outro e ambos resolvem com a sua resposta.
    const reqId = nextReqId(cmd)
    const envelope: PipeEnvelope = { v: 1, cmd, reqId, ...(payload !== undefined ? { payload } : {}) }
    const line = `${JSON.stringify(envelope)}\n`
    getLogger().info('clips-pipe', `Sending: cmd=${cmd} reqId=${reqId} payload=${JSON.stringify(payload ?? null)}`)

    const timer = setTimeout(() => {
      pendingRequests.delete(reqId)
      reject(new Error(`Command "${cmd}" timed out`))
    }, 5000)

    pendingRequests.set(reqId, { cmd, reqId, resolve: (msg) => resolve({ msg, reqId }), reject, timer })

    try {
      _pipeSocket.write(line)
    } catch (err) {
      pendingRequests.delete(reqId)
      clearTimeout(timer)
      reject(err instanceof Error ? err : new Error(String(err)))
    }
  })
}

export function sendPipeCommand(cmd: string, payload?: Record<string, unknown>): Promise<PipeMessage> {
  return sendPipeCommandTracked(cmd, payload).then((r) => r.msg)
}

export function sendPipeCommandLongRunning(
  cmd: string,
  payload?: Record<string, unknown>,
  timeoutMs = 120_000,
): Promise<PipeMessage> {
  return new Promise((resolve, reject) => {
    sendPipeCommandTracked(cmd, payload)
      .then(({ msg, reqId }) => {
        if (msg.payload?.status === 'accepted') {
          const timer = setTimeout(() => {
            longRunningPending.delete(reqId)
            reject(new Error(`Long-running command "${cmd}" timed out after ${timeoutMs}ms`))
          }, timeoutMs)
          // Chaveado pelo MESMO reqId do pedido inicial: o commandResult final traz
          // payload.requestId (NamedPipeServer.cs:566) e é para ele que se casa.
          longRunningPending.set(reqId, { cmd, reqId, resolve, reject, timer })
        } else {
          resolve(msg)
        }
      })
      .catch(reject)
  })
}

export async function sendWithFallback(
  cmd: string,
  payload?: Record<string, unknown>,
): Promise<{ success: boolean; error?: string }> {
  if (!_pipeConnected) {
    return { success: false, error: 'Engine pipe not connected' }
  }
  try {
    const resp = await sendPipeCommand(cmd, payload)
    const p = resp.payload as Record<string, unknown> | undefined
    if (p && typeof p === 'object' && 'Action' in p) {
      if (p.Action === 'error') {
        const val = p.Value as Record<string, unknown> | undefined
        const errMsg = typeof val?.error === 'string' ? val.error : 'Command failed'
        getLogger().warning('clips-pipe', `sendWithFallback cmd="${cmd}" engine error: ${errMsg}`)
        return { success: false, error: errMsg }
      }
      return { success: true }
    }
    if (p?.success === false || p?.error) {
      return { success: false, error: (p.error as string) || 'Command failed' }
    }
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ─── Data handling ───────────────────────────────────────────

export function onPipeData(chunk: Buffer): void {
  _pipeBuffer += chunk.toString('utf-8')
  if (_pipeBuffer.length > 2 * 1024 * 1024) {
    getLogger().warning('clips-pipe', 'Pipe buffer exceeded 2MB, discarding')
    _pipeBuffer = ''
    return
  }
  const lines = _pipeBuffer.split('\n')
  _pipeBuffer = lines.pop() || ''

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

// ─── Multi-window broadcast (item 12) ────────────────────────

function liveWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((w) => !w.isDestroyed())
}

/**
 * Envia a TODAS as janelas vivas. O `.find()` anterior pegava só na primeira
 * janela — com uma só (o caso real) o comportamento é idêntico; com N janelas,
 * todas recebem.
 */
function broadcastToWindows(channel: string, payload: unknown): void {
  for (const win of liveWindows()) {
    win.webContents.send(channel, payload)
  }
}

/**
 * WDA_EXCLUDEFROMCAPTURE só esconde janelas do PRÓPRIO processo. O engine C#
 * é outro processo e não pode excluir a UI do DiNho; o Electron, dono da
 * janela, é quem aplica a proteção (liga ao gravar, desliga ao parar).
 * Aplicada a todas as janelas vivas, não só à primeira.
 */
function applyContentProtection(recording: boolean): void {
  for (const win of liveWindows()) {
    win.setContentProtection(recording)
  }
}

function handlePipeMessage(msg: PipeMessage): void {
  if (msg.cmd === '_event' && msg.payload?.type === 'commandResult') {
    const p = msg.payload as Record<string, unknown>
    const originalCmd = String(p.originalCmd ?? '')
    // O engine corrêla o resultado por payload.requestId (NamedPipeServer.cs:566);
    // sem esse campo cai no pendente mais antigo de originalCmd (fila órfã/legacy).
    const resultReqId = typeof p.requestId === 'string' && p.requestId.length > 0 ? p.requestId : undefined
    const pending = takePendingFor(longRunningPending, resultReqId, originalCmd)
    if (pending) {
      clearTimeout(pending.timer)
      if (p.error) {
        getLogger().warning('clips-pipe', `Long-running command "${originalCmd}" failed: ${p.error}`)
        pending.reject(new Error(String(p.error)))
      } else {
        const value = p.value as Record<string, unknown> | undefined
        getLogger().info('clips-pipe', `Long-running command "${originalCmd}" done (reqId=${pending.reqId})`)
        pending.resolve({ cmd: originalCmd, ...(value !== undefined ? { payload: value } : {}) })
      }
    } else {
      getLogger().warning('clips-pipe', `No pending long-running request for cmd="${originalCmd}"`)
    }
    return
  }

  if (msg.cmd === '_event' && msg.payload?.type === 'engineStatus') {
    const p = msg.payload as Record<string, unknown>
    const d = p.data as Record<string, unknown> | undefined
    const src = d ?? p
    // Só campos que o EngineStatusValue envia mesmo (NamedPipeServer.cs:86). A linha
    // anterior imprimia `fps=${src.fps}` e o engine não tem campo `fps` — o log de
    // 2026-10-04 tem 4039 linhas `fps=undefined`, que lidas como "o fps não funciona"
    // quando o número certo estava no mesmo payload. `game=null` é JSON null, não um
    // jogo chamado "null".
    getLogger().info(
      'clips-pipe',
      `Engine status: game=${src.game ?? 'none'} recording=${src.recording} ` +
        `lastFrameMs=${src.lastFrameMs} pipelines=${src.activePipelines} backend=${src.captureBackend}`,
    )

    _statusUpdater?.(src)
    if (typeof src.recording === 'boolean') applyContentProtection(src.recording === true)
    if (_getCurrentStatus && liveWindows().length > 0) {
      broadcastToWindows(IPC.CLIPS_ENGINE_STATUS, _getCurrentStatus())
    }
    return
  }

  if (msg.cmd === '_event' && msg.payload?.type === 'clipSaved') {
    const p = msg.payload as Record<string, unknown>
    getLogger().info('clips-pipe', `Clip saved: ${String(p.path ?? 'unknown')}`)
    broadcastToWindows(IPC.CLIPS_CLIP_SAVED, { path: p.path })
    return
  }

  if (msg.cmd === '_event' && (msg.payload?.type === 'screenshotSaved' || msg.payload?.type === 'screenshotFailed')) {
    const p = msg.payload as Record<string, unknown>
    const success = p.type === 'screenshotSaved'
    getLogger().info(
      'clips-pipe',
      `Screenshot ${success ? 'saved' : 'failed'}: ${String(p.path ?? p.error ?? 'unknown')}`,
    )
    broadcastToWindows(IPC.CLIPS_SCREENSHOT, {
      success,
      path: p.path,
      error: p.error,
    })
    return
  }

  // ramPressure broadcasts from RamManager watchdog (raw JSON, no envelope)
  if (msg.event === 'ramPressure') {
    const p = msg as unknown as Record<string, unknown>
    const level = String(p.level ?? 'unknown')
    const usedPct = Number(p.usedPercent ?? 0)
    const reducedReplay = p.reducedReplay
    const baseMsg = `RAM pressure: level=${level} used=${(usedPct * 100).toFixed(1)}%`
    const detail = typeof reducedReplay === 'number' ? ` replayReducedTo=${reducedReplay}s` : ''
    if (level === 'critical') {
      getLogger().warning('clips-pipe', `${baseMsg}${detail}`)
    } else {
      getLogger().info('clips-pipe', `${baseMsg}${detail}`)
    }
    broadcastToWindows(IPC.CLIPS_RAM_PRESSURE, p)
    return
  }

  if (msg.cmd === 'handshake_ack') {
    // Cliente antigo / engine que envia o Action original: casa com o pendente
    // do handshake pelo reqId, ou pelo cmd 'handshake' se não houver reqId.
    const pending = takePendingFor(pendingRequests, msg.reqId, 'handshake')
    applyHandshakeAck(msg)
    if (pending) {
      clearTimeout(pending.timer)
      pending.resolve(msg)
    } else {
      getLogger().info('clips-pipe', 'Handshake ack with no pending request (late or duplicate)')
    }
    return
  }

  const pending = takePendingFor(pendingRequests, msg.reqId, msg.cmd)
  if (pending) {
    clearTimeout(pending.timer)
    getLogger().info(
      'clips-pipe',
      `Received response for cmd="${pending.cmd}" reqId=${pending.reqId} payload=${JSON.stringify(msg.payload ?? null)}`,
    )
    // O engine C# sobrescreve o cmd da resposta com o do pedido
    // (NamedPipeServer.cs:458), por isso um ack de handshake chega como
    // cmd="handshake" — é o ack, aplicar o gate da mesma forma.
    if (pending.cmd === 'handshake') applyHandshakeAck(msg)
    pending.resolve(msg)
  } else {
    getLogger().info(
      'clips-pipe',
      `No pending request for cmd="${msg.cmd}" (maybe late response; reqId=${msg.reqId ?? 'none'})`,
    )
  }
}

/** Regista o resultado do handshake_ack (gate de protocolo) — o pendente em si
 *  é resolvido pelo chamador. */
function applyHandshakeAck(msg: PipeMessage): void {
  const p = (msg.payload ?? {}) as Record<string, unknown>
  const status = String(p.status ?? 'ok')
  const engineProto = p.protoVersion === undefined ? undefined : Number(p.protoVersion)
  if (engineProto !== undefined && engineProto !== PROTO_VERSION) {
    _handshakeError = `Engine protocol mismatch: client=${PROTO_VERSION} engine=${engineProto}`
    getLogger().warning('clips-pipe', _handshakeError)
  } else if (status !== 'ok') {
    _handshakeError = `Engine handshake failed: ${String(p.error ?? status)}`
    getLogger().warning('clips-pipe', _handshakeError)
  } else {
    _handshakeError = null
    getLogger().info(
      'clips-pipe',
      `Handshake OK: engineVersion=${String(p.engineVersion ?? '?')} protoVersion=${String(engineProto ?? PROTO_VERSION)}`,
    )
  }
}

// ─── Connection management ───────────────────────────────────

let _onReconnect: (() => void) | null = null
let _isEngineRunning: (() => boolean) | null = null

export function setOnReconnect(cb: () => void): void {
  _onReconnect = cb
}

export function setOnEngineRunning(cb: () => boolean): void {
  _isEngineRunning = cb
}

export function connectPipe(): void {
  if (_pipeSocket) {
    // A superseded socket may still emit close/error/timeout events queued
    // before destroy(). Detach its handlers and destroy it so a stale event
    // cannot clobber the newly created socket below.
    _pipeSocket.removeAllListeners()
    _pipeSocket.destroy()
    _pipeSocket = null
  }
  _pipeConnected = false

  getLogger().info('clips-pipe', `Connecting to ${ENGINE_PIPE}...`)
  const sock = netConnect(ENGINE_PIPE)
  _pipeSocket = sock

  sock.setTimeout(PIPE_CONNECT_TIMEOUT)

  sock.on('connect', () => {
    if (_pipeSocket !== sock) return
    // setTimeout value only guards the *connect* phase — disable it so an idle
    // but healthy pipe does not churn with destroy/reconnect every ~10s.
    sock.setTimeout(0)
    _pipeConnected = true
    _handshakeError = null
    getLogger().info('clips-pipe', 'Connected to engine pipe')
    notifyPipeConnected()
    sendHandshake()
    _onReconnect?.()
  })

  sock.on('data', (chunk: Buffer) => {
    if (_pipeSocket === sock) onPipeData(chunk)
  })

  sock.on('error', (err) => {
    if (_pipeSocket !== sock) return
    getLogger().warning('clips-pipe', `Pipe error: ${err.message}`)
    _pipeConnected = false
  })

  sock.on('close', () => {
    if (_pipeSocket !== sock) return
    _pipeConnected = false
    _pipeSocket = null
    scheduleReconnect()
  })

  sock.on('timeout', () => {
    if (_pipeSocket !== sock) return
    getLogger().warning('clips-pipe', 'Pipe connect timeout')
    sock.destroy()
    _pipeConnected = false
    scheduleReconnect()
  })
}

function scheduleReconnect(): void {
  if (reconnectTimer) return
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    if (_isEngineRunning?.()) {
      connectPipe()
    }
  }, PIPE_RECONNECT_DELAY)
}

export function disconnectPipe(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  for (const [, pending] of pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Pipe disconnected'))
  }
  pendingRequests.clear()
  for (const [, pending] of longRunningPending) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Pipe disconnected'))
  }
  longRunningPending.clear()
  if (_pipeSocket) {
    _pipeSocket.destroy()
    _pipeSocket = null
  }
  _pipeConnected = false
}

export async function waitForPipeConnection(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  let attempts = 0
  while (Date.now() < deadline) {
    if (_pipeConnected) {
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
    `Pipe wait timeout after ${attempts * 200}ms (pipeSocket=${!!_pipeSocket}, pipeConnected=${_pipeConnected})`,
  )
  return _pipeConnected
}

/**
 * Item 4 — espera **event-driven** pela ligação do pipe (substitui o poll de
 * 200ms do `waitForPipeConnection` no caminho do `saveClip`).
 *
 * - `true` quando o pipe ligar (ou já estiver ligado no momento da chamada);
 * - `false` no timeout (`timeoutMs`);
 * - `false` se `opts.signal` abortar — **resolve**, não rejeita: o contrato é
 *   booleano igual ao de `waitForPipeConnection`, e o agente B trata o `false`
 *   como "não ligou".
 *
 * Sem polling interno: subscreve o evento `connect` do socket (a mesma fonte que
 * `_pipeConnected` usa) e o timeout é um único `setTimeout`.
 */
export function waitForPipeConnected(timeoutMs: number, opts?: { signal?: AbortSignal }): Promise<boolean> {
  if (_pipeConnected) return Promise.resolve(true)
  const signal = opts?.signal
  if (signal?.aborted) return Promise.resolve(false)

  return new Promise<boolean>((resolve) => {
    let done = false
    let timer: ReturnType<typeof setTimeout> | undefined

    function finish(value: boolean): void {
      if (done) return
      done = true
      if (timer !== undefined) clearTimeout(timer)
      _connectListeners.delete(onConnect)
      signal?.removeEventListener('abort', onAbort)
      resolve(value)
    }
    function onConnect(): void {
      finish(true)
    }
    function onAbort(): void {
      finish(false)
    }

    _connectListeners.add(onConnect)
    signal?.addEventListener('abort', onAbort, { once: true })
    timer = setTimeout(() => finish(false), timeoutMs)
  })
}
