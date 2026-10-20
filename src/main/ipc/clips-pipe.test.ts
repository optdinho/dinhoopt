import { connect } from 'node:net'
import { IPC } from '@shared/channels'
import { BrowserWindow } from 'electron'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLogger = { info: vi.fn(), error: vi.fn(), warning: vi.fn() }

vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: vi.fn(() => []) } }))
vi.mock('../services/logger.service', () => ({ getLogger: () => mockLogger }))
vi.mock('node:net', () => ({ connect: vi.fn() }))

import {
  connectPipe,
  disconnectPipe,
  isPipeConnected,
  longRunningPending,
  onPipeData,
  pendingRequests,
  sendPipeCommand,
  sendPipeCommandLongRunning,
  sendWithFallback,
  setOnEngineRunning,
  setStatusCallbacks,
  waitForPipeConnected,
} from './clips-pipe'

type SocketHandler = (...args: unknown[]) => void

function makeSocket() {
  const h: Record<string, SocketHandler[]> = {}
  const sock = {
    h,
    on: vi.fn(),
    write: vi.fn().mockReturnValue(true),
    destroy: vi.fn(),
    removeAllListeners: vi.fn(),
    setTimeout: vi.fn(),
  }
  sock.on.mockImplementation((event: string, cb: SocketHandler) => {
    ;(h[event] ??= []).push(cb)
    return sock
  })
  return sock
}

function emit(sock: ReturnType<typeof makeSocket>, event: string, ...args: unknown[]): void {
  for (const cb of sock.h[event] ?? []) cb(...args)
}

function connectFakeSocket() {
  const sock = makeSocket()
  vi.mocked(connect).mockReturnValue(sock as never)
  connectPipe()
  emit(sock, 'connect')
  return sock
}

function makeWindow() {
  return { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() }, setContentProtection: vi.fn() }
}

const line = (msg: unknown) => Buffer.from(`${JSON.stringify(msg)}\n`, 'utf-8')

/** Envelope (JSON) escrito na chamada `idx` ao socket fake — 0 = handshake. */
function writtenEnvelope(sock: ReturnType<typeof makeSocket>, idx: number): Record<string, unknown> {
  const call = sock.write.mock.calls[idx]
  if (!call) {
    throw new Error(`socket.write[${idx}] deve existir`)
  }
  return JSON.parse(String(call[0])) as Record<string, unknown>
}

/** Índice (dentro de write.mock.calls) do envelope enviado com o cmd dado. */
function writeIndexForCmd(sock: ReturnType<typeof makeSocket>, cmd: string): number {
  const idx = sock.write.mock.calls.findIndex((c) => (JSON.parse(String(c[0])) as { cmd?: string }).cmd === cmd)
  expect(idx, `socket.write com cmd="${cmd}" deve existir`).toBeGreaterThanOrEqual(0)
  return idx
}

/** Pendentes com esse cmd — o handshake (não respondido nos testes) também está no mapa. */
function pendingCmdCount(map: Map<string, { cmd: string }>, cmd: string): number {
  return [...map.values()].filter((p) => p.cmd === cmd).length
}

/** Anixa um handler para que uma asserção falhada não deixe rejeições por tratar. */
function track<T>(p: Promise<T>): Promise<T> {
  p.catch(() => {})
  return p
}

beforeEach(() => {
  vi.clearAllMocks()
  disconnectPipe()
  setOnEngineRunning(() => false)
  setStatusCallbacks(
    () => {},
    () => ({}) as never,
  )
  vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
  vi.mocked(connect).mockReturnValue(makeSocket() as never)
})

describe('clips-pipe buffer guard', () => {
  it('discards the buffer when it exceeds 2MB', () => {
    onPipeData(Buffer.alloc(2 * 1024 * 1024 + 16, 0x61))

    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', 'Pipe buffer exceeded 2MB, discarding')
  })
})

describe('clips-pipe broadcast events', () => {
  it('forwards clipSaved to the renderer', () => {
    const win = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as never])

    onPipeData(line({ cmd: '_event', payload: { type: 'clipSaved', path: 'C:\\Clips\\a.mp4' } }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'Clip saved: C:\\Clips\\a.mp4')
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_CLIP_SAVED, { path: 'C:\\Clips\\a.mp4' })
  })

  it('logs an unknown path and skips the send when there is no window', () => {
    onPipeData(line({ cmd: '_event', payload: { type: 'clipSaved' } }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'Clip saved: unknown')
  })

  it('forwards screenshotSaved to the renderer with success=true', () => {
    const win = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as never])

    onPipeData(line({ cmd: '_event', payload: { type: 'screenshotSaved', path: 'C:\\Clips\\shot.png' } }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'Screenshot saved: C:\\Clips\\shot.png')
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_SCREENSHOT, {
      success: true,
      path: 'C:\\Clips\\shot.png',
      error: undefined,
    })
  })

  it('forwards screenshotFailed to the renderer with success=false', () => {
    const win = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as never])

    onPipeData(line({ cmd: '_event', payload: { type: 'screenshotFailed', error: 'ffmpeg exit 1' } }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'Screenshot failed: ffmpeg exit 1')
    expect(win.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_SCREENSHOT, {
      success: false,
      path: undefined,
      error: 'ffmpeg exit 1',
    })
  })

  it('forwards ramPressure with the reduced replay detail', () => {
    const win = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as never])

    onPipeData(line({ event: 'ramPressure', level: 'critical', usedPercent: 0.9, reducedReplay: 30 }))

    expect(mockLogger.warning).toHaveBeenCalledWith(
      'clips-pipe',
      'RAM pressure: level=critical used=90.0% replayReducedTo=30s',
    )
    expect(win.webContents.send).toHaveBeenCalledWith(
      IPC.CLIPS_RAM_PRESSURE,
      expect.objectContaining({ level: 'critical' }),
    )
  })

  it('logs non-critical ramPressure at info level without the replay detail', () => {
    onPipeData(line({ event: 'ramPressure', level: 'normal' }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'RAM pressure: level=normal used=0.0%')
    expect(mockLogger.warning).not.toHaveBeenCalled()
  })

  it('defaults a missing ramPressure level to unknown', () => {
    onPipeData(line({ event: 'ramPressure' }))

    expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', 'RAM pressure: level=unknown used=0.0%')
  })

  it('logs the engineStatus fields the engine actually sends, never undefined', () => {
    // Payload real do EngineStatusValue (NamedPipeServer.cs:86). Medido no log de
    // 2026-10-04: 4039 de 4039 broadcasts de estado sairam com `fps=undefined`, porque
    // EngineStatusValue nao tem campo `fps`. O que tem e' lastFrameMs.
    onPipeData(
      line({
        cmd: '_event',
        payload: {
          type: 'engineStatus',
          data: {
            game: null,
            recording: true,
            captureBackend: 'WGC',
            lastFrameMs: 16.7,
            activePipelines: 1,
          },
        },
      }),
    )

    const logged = mockLogger.info.mock.calls.map((call) => String(call[1])).join('\n')
    expect(logged).toContain('lastFrameMs=16.7')
    expect(logged).toContain('pipelines=1')
    expect(logged).toContain('recording=true')
    expect(logged).toContain('backend=WGC')
    // `game=null` e' JSON null, nao um jogo chamado "null".
    expect(logged).toContain('game=none')
    expect(logged).not.toContain('undefined')
  })

  it('warns when a long-running command result has no pending request', () => {
    onPipeData(line({ cmd: '_event', payload: { type: 'commandResult', originalCmd: 'trim', error: 'boom' } }))

    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', 'No pending long-running request for cmd="trim"')
  })
})

describe('clips-pipe handshake and commands', () => {
  it('warns when the handshake write fails', () => {
    const sock = makeSocket()
    sock.write.mockImplementationOnce(() => {
      throw new Error('EPIPE')
    })
    vi.mocked(connect).mockReturnValue(sock as never)

    connectPipe()
    emit(sock, 'connect')

    expect(mockLogger.warning).toHaveBeenCalledWith('clips-pipe', expect.stringContaining('Handshake write failed'))
  })

  it('rejects a command that is never answered', async () => {
    const sock = makeSocket()
    vi.mocked(connect).mockReturnValue(sock as never)

    vi.useFakeTimers()
    try {
      connectPipe()
      emit(sock, 'connect')

      const promise = sendPipeCommand('slow')
      const assertion = expect(promise).rejects.toThrow('Command "slow" timed out')
      vi.advanceTimersByTime(5000)
      await assertion
    } finally {
      vi.useRealTimers()
    }
  })

  it('maps engine Action envelopes to results', async () => {
    connectFakeSocket()

    const failed = sendWithFallback('doIt')
    onPipeData(line({ cmd: 'doIt', payload: { Action: 'error', Value: { error: 'denied' } } }))
    expect(await failed).toEqual({ success: false, error: 'denied' })

    const genericFailure = sendWithFallback('doIt')
    onPipeData(line({ cmd: 'doIt', payload: { Action: 'error' } }))
    expect(await genericFailure).toEqual({ success: false, error: 'Command failed' })

    const accepted = sendWithFallback('doIt')
    onPipeData(line({ cmd: 'doIt', payload: { Action: 'ok' } }))
    expect(await accepted).toEqual({ success: true })
  })
})

describe('clips-pipe reconnect', () => {
  it('reconnects after close while the engine is running', () => {
    const sock = makeSocket()
    vi.mocked(connect)
      .mockReturnValueOnce(sock as never)
      .mockReturnValueOnce(makeSocket() as never)
    setOnEngineRunning(() => true)

    vi.useFakeTimers()
    try {
      connectPipe()
      emit(sock, 'connect')
      emit(sock, 'close')

      vi.advanceTimersByTime(3000)
      expect(connect).toHaveBeenCalledTimes(2)
      expect(mockLogger.info).toHaveBeenCalledWith('clips-pipe', expect.stringContaining('Connecting to'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not reconnect after close while the engine is stopped', () => {
    const sock = makeSocket()
    vi.mocked(connect).mockReturnValue(sock as never)
    setOnEngineRunning(() => false)

    vi.useFakeTimers()
    try {
      connectPipe()
      emit(sock, 'connect')
      emit(sock, 'close')

      vi.advanceTimersByTime(3000)
      expect(connect).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─── Item 3: correlação de pedidos por reqId ────────────────
describe('clips-pipe reqId correlation (item 3)', () => {
  it('includes a unique reqId in every outgoing envelope', async () => {
    const sock = connectFakeSocket()

    const first = sendPipeCommand('getStatus')
    const second = sendPipeCommand('getStatus')

    const hs = writtenEnvelope(sock, 0)
    const e1 = writtenEnvelope(sock, 1)
    const e2 = writtenEnvelope(sock, 2)
    expect(hs.cmd).toBe('handshake')
    expect(e1.cmd).toBe('getStatus')
    expect(e2.cmd).toBe('getStatus')
    expect(typeof hs.reqId).toBe('string')
    expect(String(hs.reqId).length).toBeGreaterThan(0)
    expect(e1.reqId).toBeTruthy()
    expect(e2.reqId).toBeTruthy()
    expect(e1.reqId).not.toBe(e2.reqId)

    // Respostas fora de ordem: cada uma resolve o SEU pedido pelo reqId.
    onPipeData(line({ cmd: 'getStatus', reqId: e2.reqId, payload: { n: 2 } }))
    onPipeData(line({ cmd: 'getStatus', reqId: e1.reqId, payload: { n: 1 } }))
    await expect(first).resolves.toMatchObject({ payload: { n: 1 } })
    await expect(second).resolves.toMatchObject({ payload: { n: 2 } })
  })

  it('lets two concurrent requests of the same cmd both resolve (no "superseded")', async () => {
    const sock = connectFakeSocket()

    const first = track(sendPipeCommand('getStatus'))
    const second = track(sendPipeCommand('getStatus'))

    // Comportamento antigo (o bug): o 2.º pedido rejeitava o 1.º como "superseded".
    let firstRejected = false
    first.catch(() => {
      firstRejected = true
    })
    await Promise.resolve()
    expect(firstRejected).toBe(false)
    expect(pendingCmdCount(pendingRequests, 'getStatus')).toBe(2)

    const e2 = writtenEnvelope(sock, 2)
    onPipeData(line({ cmd: 'getStatus', reqId: e2.reqId, payload: { who: 'second' } }))
    await expect(second).resolves.toMatchObject({ payload: { who: 'second' } })

    const e1 = writtenEnvelope(sock, 1)
    onPipeData(line({ cmd: 'getStatus', reqId: e1.reqId, payload: { who: 'first' } }))
    await expect(first).resolves.toMatchObject({ payload: { who: 'first' } })
    expect(firstRejected).toBe(false)
    // Só resta o pendente do handshake (que ninguém acusa neste teste).
    expect(pendingCmdCount(pendingRequests, 'getStatus')).toBe(0)
  })

  it('falls back to the OLDEST pending of that cmd when the response has no reqId', async () => {
    const sock = connectFakeSocket()

    const oldest = track(sendPipeCommand('getStatus'))
    const newest = track(sendPipeCommand('getStatus'))

    // Resposta legada (sem reqId) — chega no FIFO do pipe, logo corresponde ao pedido antigo.
    onPipeData(line({ cmd: 'getStatus', payload: { legacy: true } }))
    await expect(oldest).resolves.toMatchObject({ payload: { legacy: true } })
    expect(pendingCmdCount(pendingRequests, 'getStatus')).toBe(1)

    // O pendente restante continua a ser resolvível pelo seu reqId.
    const ids = sock.write.mock.calls
      .map((c) => JSON.parse(String(c[0])) as { cmd?: string; reqId?: string })
      .filter((e) => e.cmd === 'getStatus')
      .map((e) => e.reqId)
    expect(ids).toHaveLength(2)
    onPipeData(line({ cmd: 'getStatus', reqId: ids[1], payload: { byId: true } }))
    await expect(newest).resolves.toMatchObject({ payload: { byId: true } })
  })

  it('never steals a live pending when the response carries an unknown reqId', async () => {
    connectFakeSocket()

    const pending = track(sendPipeCommand('getStatus'))
    let settled = false
    pending.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    onPipeData(line({ cmd: 'getStatus', reqId: 'someone-elses-reqId', payload: { n: 1 } }))
    await Promise.resolve()
    await Promise.resolve()

    expect(settled).toBe(false)
    expect(pendingCmdCount(pendingRequests, 'getStatus')).toBe(1)
    expect(mockLogger.info).toHaveBeenCalledWith(
      'clips-pipe',
      expect.stringContaining('No pending request for cmd="getStatus"'),
    )
  })

  it('broadcasts without reqId (engineStatus / clipSaved / ramPressure) never consume a pending request', async () => {
    const win = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as never])
    const sock = connectFakeSocket()

    const pending = sendPipeCommand('getStatus')

    onPipeData(line({ cmd: '_event', payload: { type: 'engineStatus', data: { recording: true, lastFrameMs: 16.7 } } }))
    onPipeData(line({ cmd: '_event', payload: { type: 'clipSaved', path: 'C:\\Clips\\a.mp4' } }))
    onPipeData(line({ event: 'ramPressure', level: 'normal', usedPercent: 0.5 }))

    // Os broadcasts não consomem pendentes — o getStatus segue vivo (o pendente
    // do handshake também, por isso conta-se só por cmd).
    expect(pendingCmdCount(pendingRequests, 'getStatus')).toBe(1)

    const e = writtenEnvelope(sock, writeIndexForCmd(sock, 'getStatus'))
    onPipeData(line({ cmd: 'getStatus', reqId: e.reqId, payload: { ok: true } }))
    await expect(pending).resolves.toMatchObject({ payload: { ok: true } })
  })

  it('handshake carries a reqId and the ack matching that reqId opens the gate', async () => {
    const sock = connectFakeSocket()

    const hs = writtenEnvelope(sock, 0)
    onPipeData(
      line({
        cmd: 'handshake',
        reqId: hs.reqId,
        payload: { status: 'ok', protoVersion: 1, engineVersion: '1.0.0' },
      }),
    )
    expect(pendingRequests.size).toBe(0)

    const p = sendPipeCommand('hello')
    const e = writtenEnvelope(sock, writeIndexForCmd(sock, 'hello'))
    onPipeData(line({ cmd: 'hello', reqId: e.reqId, payload: { ok: true } }))
    await expect(p).resolves.toMatchObject({ payload: { ok: true } })
  })

  it('an ack echoing cmd=handshake (real engine shape) still applies the protocol gate', async () => {
    // O engine C# sobrescreve o cmd da resposta com o do pedido
    // (NamedPipeServer.cs:458) — o ack chega como cmd="handshake", não "handshake_ack".
    const sock = connectFakeSocket()

    const hs = writtenEnvelope(sock, 0)
    onPipeData(
      line({
        cmd: 'handshake',
        reqId: hs.reqId,
        payload: { status: 'ok', protoVersion: 99, engineVersion: '1.0.0' },
      }),
    )

    await expect(sendPipeCommand('hello')).rejects.toThrow(/protocol mismatch/)
  })

  it('a handshake_ack without reqId falls back to the pending handshake cmd', async () => {
    connectFakeSocket()

    onPipeData(line({ cmd: 'handshake_ack', payload: { status: 'ok', protoVersion: 99 } }))

    await expect(sendPipeCommand('hello')).rejects.toThrow(/protocol mismatch/)
  })

  it('accepts the long-running ack that the engine sends WITHOUT reqId', async () => {
    const sock = connectFakeSocket()

    const p = sendPipeCommandLongRunning('saveClip', undefined, 5000)
    // NamedPipeServer.cs:428-434 — o envelope "accepted" não ecoa RequestId.
    onPipeData(line({ cmd: 'saveClip', payload: { status: 'accepted' } }))
    await Promise.resolve()
    await Promise.resolve()

    const reqId = writtenEnvelope(sock, writeIndexForCmd(sock, 'saveClip')).reqId
    expect(longRunningPending.size).toBe(1)
    expect([...longRunningPending.keys()][0]).toBe(reqId)

    onPipeData(
      line({
        cmd: '_event',
        payload: { type: 'commandResult', originalCmd: 'saveClip', requestId: reqId, value: { path: 'a.mp4' } },
      }),
    )
    await expect(p).resolves.toMatchObject({ payload: { path: 'a.mp4' } })
    expect(longRunningPending.size).toBe(0)
  })

  it('routes concurrent long-running results to their own request via payload.requestId', async () => {
    const sock = connectFakeSocket()

    const first = track(sendPipeCommandLongRunning('saveClip', undefined, 5000))
    const second = track(sendPipeCommandLongRunning('saveClip', undefined, 5000))
    let firstRejected = false
    first.catch(() => {
      firstRejected = true
    })

    onPipeData(line({ cmd: 'saveClip', payload: { status: 'accepted' } }))
    onPipeData(line({ cmd: 'saveClip', payload: { status: 'accepted' } }))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    // The unanswered handshake pending also lives in pendingRequests, so count
    // only saveClip entries rather than the raw map size.
    expect(pendingCmdCount(pendingRequests, 'saveClip')).toBe(0)
    expect(longRunningPending.size).toBe(2)
    expect(firstRejected).toBe(false)

    const ids = sock.write.mock.calls
      .map((c) => JSON.parse(String(c[0])) as { cmd?: string; reqId?: string })
      .filter((e) => e.cmd === 'saveClip')
      .map((e) => e.reqId)
    expect(ids).toHaveLength(2)

    onPipeData(
      line({
        cmd: '_event',
        payload: { type: 'commandResult', originalCmd: 'saveClip', requestId: ids[1], value: { which: 'second' } },
      }),
    )
    onPipeData(
      line({
        cmd: '_event',
        payload: { type: 'commandResult', originalCmd: 'saveClip', requestId: ids[0], value: { which: 'first' } },
      }),
    )

    await expect(second).resolves.toMatchObject({ payload: { which: 'second' } })
    await expect(first).resolves.toMatchObject({ payload: { which: 'first' } })
    expect(firstRejected).toBe(false)
  })

  it('falls back to the oldest long-running pending when commandResult has no requestId', async () => {
    connectFakeSocket()

    const p = sendPipeCommandLongRunning('mergeClips', undefined, 5000)
    onPipeData(line({ cmd: 'mergeClips', payload: { status: 'accepted' } }))
    await Promise.resolve()
    await Promise.resolve()

    onPipeData(
      line({ cmd: '_event', payload: { type: 'commandResult', originalCmd: 'mergeClips', value: { path: 'm.mp4' } } }),
    )
    await expect(p).resolves.toMatchObject({ payload: { path: 'm.mp4' } })
  })
})

// ─── Item 12: broadcast para todas as janelas ───────────────
describe('clips-pipe multi-window broadcast (item 12)', () => {
  it('forwards clipSaved to every non-destroyed window', () => {
    const aliveA = makeWindow()
    const aliveB = makeWindow()
    const destroyed = { ...makeWindow(), isDestroyed: vi.fn(() => true) }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([aliveA as never, destroyed as never, aliveB as never])

    onPipeData(line({ cmd: '_event', payload: { type: 'clipSaved', path: 'C:\\Clips\\a.mp4' } }))

    expect(aliveA.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_CLIP_SAVED, { path: 'C:\\Clips\\a.mp4' })
    expect(aliveB.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_CLIP_SAVED, { path: 'C:\\Clips\\a.mp4' })
    expect(destroyed.webContents.send).not.toHaveBeenCalled()
  })

  it('forwards screenshotSaved to every non-destroyed window', () => {
    const aliveA = makeWindow()
    const aliveB = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([aliveA as never, aliveB as never])

    onPipeData(line({ cmd: '_event', payload: { type: 'screenshotSaved', path: 'C:\\Clips\\shot.png' } }))

    for (const win of [aliveA, aliveB]) {
      expect(win.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_SCREENSHOT, {
        success: true,
        path: 'C:\\Clips\\shot.png',
        error: undefined,
      })
    }
  })

  it('forwards ramPressure to every non-destroyed window', () => {
    const aliveA = makeWindow()
    const aliveB = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([aliveA as never, aliveB as never])

    onPipeData(line({ event: 'ramPressure', level: 'warning', usedPercent: 0.8 }))

    for (const win of [aliveA, aliveB]) {
      expect(win.webContents.send).toHaveBeenCalledWith(
        IPC.CLIPS_RAM_PRESSURE,
        expect.objectContaining({ level: 'warning' }),
      )
    }
  })

  it('applies content protection to every non-destroyed window while recording', () => {
    const aliveA = makeWindow()
    const aliveB = makeWindow()
    const destroyed = { ...makeWindow(), isDestroyed: vi.fn(() => true) }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([aliveA as never, destroyed as never, aliveB as never])

    onPipeData(line({ cmd: '_event', payload: { type: 'engineStatus', data: { recording: true } } }))

    expect(aliveA.setContentProtection).toHaveBeenCalledWith(true)
    expect(aliveB.setContentProtection).toHaveBeenCalledWith(true)
    expect(destroyed.setContentProtection).not.toHaveBeenCalled()
    expect(aliveA.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_ENGINE_STATUS, expect.anything())
    expect(aliveB.webContents.send).toHaveBeenCalledWith(IPC.CLIPS_ENGINE_STATUS, expect.anything())
  })

  it('clears content protection on every window when recording stops', () => {
    const aliveA = makeWindow()
    const aliveB = makeWindow()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([aliveA as never, aliveB as never])

    onPipeData(line({ cmd: '_event', payload: { type: 'engineStatus', data: { recording: false } } }))

    expect(aliveA.setContentProtection).toHaveBeenCalledWith(false)
    expect(aliveB.setContentProtection).toHaveBeenCalledWith(false)
  })
})

// ─── Item 4: waitForPipeConnected (event-driven) ────────────
describe('waitForPipeConnected (item 4)', () => {
  it('resolves true immediately when the pipe is already connected', async () => {
    connectFakeSocket()

    await expect(waitForPipeConnected(5000)).resolves.toBe(true)
  })

  it('resolves true when the pipe connects (no polling)', async () => {
    const sock = makeSocket()
    vi.mocked(connect).mockReturnValue(sock as never)
    connectPipe()

    const promise = waitForPipeConnected(5000)
    emit(sock, 'connect')

    await expect(promise).resolves.toBe(true)
  })

  it('resolves false on timeout', async () => {
    const sock = makeSocket()
    vi.mocked(connect).mockReturnValue(sock as never)

    vi.useFakeTimers()
    try {
      connectPipe()
      const promise = waitForPipeConnected(1000)
      vi.advanceTimersByTime(1000)
      await expect(promise).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('resolves false when the signal aborts, and stops listening', async () => {
    const sock = makeSocket()
    vi.mocked(connect).mockReturnValue(sock as never)
    connectPipe()

    const controller = new AbortController()
    const promise = waitForPipeConnected(60_000, { signal: controller.signal })
    controller.abort()
    await expect(promise).resolves.toBe(false)

    // O aborto não pode resolver de novo nem o connect seguinte pode "reviver" a promise.
    emit(sock, 'connect')
    await expect(promise).resolves.toBe(false)
    expect(isPipeConnected()).toBe(true)
  })

  it('resolves false immediately when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    await expect(waitForPipeConnected(60_000, { signal: controller.signal })).resolves.toBe(false)
  })
})
