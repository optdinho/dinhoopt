import { describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFile: vi.fn(),
  execFileSync: vi.fn(),
}))

const mockSocket = {
  on: vi.fn((_event: string, cb: () => void) => {
    if (_event === 'connect') cb()
    return mockSocket
  }),
  destroy: vi.fn(),
  write: vi.fn(),
  end: vi.fn(),
  setTimeout: vi.fn(),
  removeAllListeners: vi.fn(),
}
vi.mock('node:net', () => ({
  connect: vi.fn(() => mockSocket),
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  shell: { openPath: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: {
    getFocusedWindow: vi.fn(),
    getAllWindows: vi.fn(() => []),
  },
  app: {
    isPackaged: false,
    getPath: vi.fn(() => '/mock/user-data'),
  },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { connect } from 'node:net'
import { ipcMain, shell } from 'electron'
import { IPC } from '@shared/channels'
import { registerClipsIpc, stopEngineProcess } from './clips.ipc'

function captureHandlers(): Map<string, (...args: unknown[]) => unknown> {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  vi.mocked(ipcMain.handle).mockImplementation((channel: string, handler: (...args: unknown[]) => unknown) => {
    handlers.set(channel, handler)
    return undefined as never
  })
  registerClipsIpc()
  return handlers
}

function getSyncHandler<T>(handlers: Map<string, (...args: unknown[]) => unknown>, channel: string): () => T {
  const handler = handlers.get(channel)!
  return () => handler() as T
}

function getAsyncHandler(handlers: Map<string, (...args: unknown[]) => unknown>, channel: string) {
  return handlers.get(channel)!
}

describe('registerClipsIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 18 clip handlers', () => {
    const handlers = captureHandlers()
    const expectedChannels = [
      IPC.CLIPS_GET_STATUS,
      IPC.CLIPS_START_ENGINE,
      IPC.CLIPS_STOP_ENGINE,
      IPC.CLIPS_START_CAPTURE,
      IPC.CLIPS_STOP_CAPTURE,
      IPC.CLIPS_SAVE_CLIP,
      IPC.CLIPS_LIST_CLIPS,
      IPC.CLIPS_DELETE_CLIP,
      IPC.CLIPS_OPEN_CLIP,
      IPC.CLIPS_GET_CONFIG,
      IPC.CLIPS_SET_CONFIG,
      IPC.CLIPS_SELECT_OUTPUT_DIR,
      IPC.CLIPS_GET_AUDIO_SESSIONS,
      IPC.CLIPS_SET_AUDIO_SESSIONS,
      IPC.CLIPS_GET_THUMBNAIL,
      IPC.CLIPS_GET_RUNNING_PROCESSES,
      IPC.CLIPS_GET_MIC_DEVICES,
      IPC.CLIPS_SET_MIC_DEVICE,
      IPC.CLIPS_SET_FAVORITE,
      IPC.CLIPS_GET_GPUS,
      IPC.CLIPS_TRIM_CLIP,
      IPC.CLIPS_MERGE_CLIPS,
    ]
    for (const ch of expectedChannels) {
      expect(handlers.has(ch)).toBe(true)
    }
    expect(handlers.size).toBe(22)
  })
})

describe('CLIPS_GET_STATUS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns initial engine status (not running, not capturing)', () => {
    const handlers = captureHandlers()
    const status = getSyncHandler<Record<string, unknown>>(handlers, IPC.CLIPS_GET_STATUS)()
    expect(status.running).toBe(false)
    expect(status.capturing).toBe(false)
    expect(status.uptime).toBe(0)
    expect(status.fps).toBe(60)
    expect(status.replayTimeSeconds).toBe(300)
    expect(status.captureBackend).toBeUndefined()
    expect(status.encoder).toBeUndefined()
    expect(status.estimatedRamMB).toBeUndefined()
    expect(status.diskSpaceOk).toBe(true)
    expect(status.currentGame).toBe('FiveM_GTAProcess.exe')
    expect(status.lastCrashRecovered).toBeUndefined()
  })
})

describe('CLIPS_LIST_CLIPS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when output directory does not exist', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const handlers = captureHandlers()
    const list = getSyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)()
    expect(list).toEqual([])
  })

  it('returns sorted clips from disk', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue(['clip2.mp4', 'clip1.mp4'])
    vi.mocked(execFileSync).mockReturnValue('150.0\n')

    const statMock = vi.mocked(statSync)
    statMock.mockReturnValueOnce({ size: 100, birthtime: new Date('2026-06-20T10:00:00Z') } as ReturnType<typeof statSync>)
    statMock.mockReturnValueOnce({ size: 200, birthtime: new Date('2026-06-21T10:00:00Z') } as ReturnType<typeof statSync>)

    const handlers = captureHandlers()
    const list = getSyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)() as Array<{ name: string; size: number; createdAt: string }>
    // Sorted descending by date → clip1 (June 21) first, clip2 (June 20) second
    expect(list).toHaveLength(2)
    expect(list[0]!.name).toBe('clip1.mp4')
    expect(list[0]!.size).toBe(200)
    expect(list[1]!.name).toBe('clip2.mp4')
    expect(list[1]!.size).toBe(100)
  })

  it('filters out non-mp4 files', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue(['clip.mp4', 'notes.txt', 'image.png'])
    vi.mocked(statSync).mockReturnValue({ size: 50, birthtime: new Date() } as ReturnType<typeof statSync>)
    vi.mocked(execFileSync).mockReturnValue('60.0\n')

    const handlers = captureHandlers()
    const list = getSyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)() as Array<{ name: string }>
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('clip.mp4')
  })

  it('skips files that fail to stat', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue(['good.mp4', 'bad.mp4'])
    vi.mocked(execFileSync).mockReturnValue('30.0\n')
    vi.mocked(statSync)
      .mockReturnValueOnce({ size: 50, birthtime: new Date() } as ReturnType<typeof statSync>)
      .mockImplementationOnce(() => { throw new Error('permission denied') })

    const handlers = captureHandlers()
    const list = getSyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)() as Array<{ name: string }>
    expect(list).toHaveLength(1)
    expect(list[0]!.name).toBe('good.mp4')
  })

  it('populates duration from ffprobe', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue(['clip.mp4'])
    vi.mocked(statSync).mockReturnValue({ size: 100, birthtime: new Date() } as ReturnType<typeof statSync>)
    vi.mocked(execFileSync).mockReturnValue('90.5\n')

    const handlers = captureHandlers()
    const list = getSyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)() as Array<{ name: string; duration: number }>
    expect(list).toHaveLength(1)
    expect(list[0]!.duration).toBe(91)
  })

  it('returns 0 duration when ffprobe fails', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readdirSync).mockReturnValue(['clip.mp4'])
    vi.mocked(statSync).mockReturnValue({ size: 100, birthtime: new Date() } as ReturnType<typeof statSync>)
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('ffprobe not found') })

    const handlers = captureHandlers()
    const list = getSyncHandler(handlers, IPC.CLIPS_LIST_CLIPS)() as Array<{ name: string; duration: number }>
    expect(list).toHaveLength(1)
    expect(list[0]!.duration).toBe(0)
  })
})

describe('CLIPS_DELETE_CLIP', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('deletes a clip with a valid name', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(unlinkSync).mockReturnValue(undefined)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)
    const result = await handler({}, 'myclip.mp4') as { success: boolean }
    expect(result.success).toBe(true)
    expect(unlinkSync).toHaveBeenCalled()
  })

  it('rejects non-string clipName', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)
    const result = await handler({}, 123) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Invalid clip name')
    expect(unlinkSync).not.toHaveBeenCalled()
  })

  it('catches unlink errors', async () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(unlinkSync).mockImplementation(() => { throw new Error('Access denied') })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_DELETE_CLIP)
    const result = await handler({}, 'myclip.mp4') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Access denied')
  })
})

describe('CLIPS_OPEN_CLIP', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a clip with a valid path', async () => {
    vi.mocked(shell.openPath).mockResolvedValue('')
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, 'C:\\clips\\clip.mp4')
    expect(shell.openPath).toHaveBeenCalledWith('C:\\clips\\clip.mp4')
  })

  it('ignores non-string path', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, null)
    expect(shell.openPath).not.toHaveBeenCalled()
  })

  it('handles shell error gracefully', async () => {
    vi.mocked(shell.openPath).mockRejectedValue(new Error('no app'))
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_OPEN_CLIP)
    await handler({}, 'C:\\clips\\clip.mp4')
    // Should not throw; error is logged internally
    expect(shell.openPath).toHaveBeenCalled()
  })
})

describe('CLIPS_GET_CONFIG', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns default config with all fields', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    const handlers = captureHandlers()
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.replayTimeSeconds).toBe(300)
    expect(cfg.micEnabled).toBe(true)
    expect(cfg.audioLoopback).toBe(false)
    expect(cfg.fps).toBe(60)
    expect(cfg.width).toBe(1920)
    expect(cfg.height).toBe(1080)
    expect(cfg.bitrateKbps).toBe(50000)
    expect(cfg.cq).toBe(18)
    expect(cfg.maxrateKbps).toBe(50000)
    expect(cfg.bufsizeKbps).toBe(100000)
    expect(cfg.bframes).toBe(0)
    expect(cfg.lookahead).toBe(4)
    expect(cfg.encoderPreset).toBe('p4')
    expect(cfg.outputDirectory).toContain('DiNhoClips')
    expect(cfg.forceSoftware).toBe(false)
    expect(cfg.pushToTalk).toBe('hold')
    expect(cfg.pushToTalkKeys).toEqual([5, 20])
    expect(cfg.gameDetection).toBe(true)
    expect(cfg.gameAudioOnly).toBe(true)
    const hk = cfg.hotkeys as Array<Record<string, unknown>>
    expect(hk).toHaveLength(3)
    expect(hk[0]).toMatchObject({ vk: 123, action: 'saveClip', modifiers: [], enabled: true, replayDurationSeconds: 300 })
    expect(hk[1]).toMatchObject({ vk: 122, action: 'saveClip', modifiers: [], enabled: true, replayDurationSeconds: 120 })
    expect(hk[2]).toMatchObject({ vk: 49, modifiers: ['Alt'], action: 'toggleCapture', enabled: true, replayDurationSeconds: 60 })
  })
})

describe('CLIPS_START_ENGINE', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when engine executable not found', async () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_START_ENGINE)
    const result = await handler() as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })
})

describe('CLIPS_START_ENGINE success + stopEngineProcess', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function startEngine() {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_START_ENGINE)
    return { handlers, handler }
  }

  function makeMockChild() {
    return {
      pid: 42,
      kill: vi.fn(),
      killed: false,
      removeAllListeners: vi.fn(),
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      on: vi.fn(),
    }
  }

  function startEngineAndVerifySuccess() {
    vi.mocked(existsSync).mockReturnValue(true)
    const child = makeMockChild()
    vi.mocked(spawn).mockReturnValue(child as never)
    return child
  }

  it('starts engine successfully', async () => {
    const child = startEngineAndVerifySuccess()
    const { handler } = startEngine()
    const result = await handler() as { success: boolean }
    expect(result.success).toBe(true)
    expect(spawn).toHaveBeenCalled()
    // cleanup so next test has fresh state
    stopEngineProcess()
    expect(child.kill).toHaveBeenCalled()
  })

  it('stopEngineProcess kills the engine process', async () => {
    const child = startEngineAndVerifySuccess()
    const { handler } = startEngine()
    await handler()

    stopEngineProcess()

    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('stopEngineProcess is no-op when engine not running', () => {
    expect(() => stopEngineProcess()).not.toThrow()
  })

  it('CLIPS_STOP_ENGINE handler delegates to stopEngineProcess', async () => {
    const child = startEngineAndVerifySuccess()
    const { handlers, handler } = startEngine()
    await handler()

    const stopHandler = getAsyncHandler(handlers, IPC.CLIPS_STOP_ENGINE)
    const result = await stopHandler() as { success: boolean }
    expect(result.success).toBe(true)
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })
})

describe('CLIPS_SET_CONFIG', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns success when pipe is not connected', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    const result = await handler({}, { fps: 120 }) as { success: boolean; error?: string }
    expect(result.success).toBe(true)
  })

  it('updates outputDirectory when set via config', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { outputDirectory: 'D:\\MeusClipes' })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.outputDirectory).toBe('D:\\MeusClipes')
  })

  it('accepts pushToTalkKeys array', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { pushToTalkKeys: [0x7a, 0x7b] })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.pushToTalkKeys).toEqual([0x7a, 0x7b])
  })

  it('accepts backward-compat pushToTalkKey number', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { pushToTalkKey: 0x78 })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.pushToTalkKeys).toEqual([0x78])
  })

  it('updates gameAudioOnly', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_CONFIG)
    await handler({}, { gameAudioOnly: true })
    const cfg = getSyncHandler(handlers, IPC.CLIPS_GET_CONFIG)() as Record<string, unknown>
    expect(cfg.gameAudioOnly).toBe(true)
  })
})

describe('CLIPS_SELECT_OUTPUT_DIR', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns selected path when dialog is not canceled', async () => {
    const { dialog } = await import('electron')
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: ['D:\\Clipes'], bookmarks: undefined })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SELECT_OUTPUT_DIR)
    const result = await handler() as string | null
    expect(result).toBe('D:\\Clipes')
  })

  it('returns null when dialog is canceled', async () => {
    const { dialog } = await import('electron')
    vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [], bookmarks: undefined })
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SELECT_OUTPUT_DIR)
    const result = await handler() as string | null
    expect(result).toBeNull()
  })
})

describe('CLIPS_GET_AUDIO_SESSIONS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns empty array when pipe is not connected', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_GET_AUDIO_SESSIONS)
    const result = await handler() as unknown[]
    expect(result).toEqual([])
  })
})

describe('CLIPS_SET_AUDIO_SESSIONS', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects non-array sessionPids', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)
    const result = await handler({}, 'not-an-array') as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('sessionPids must be an array')
  })

  it('returns pipe-not-connected error when pipe is not connected', async () => {
    const handlers = captureHandlers()
    const handler = getAsyncHandler(handlers, IPC.CLIPS_SET_AUDIO_SESSIONS)
    const result = await handler({}, [1234]) as { success: boolean; error?: string }
    expect(result.success).toBe(false)
    expect(result.error).toBe('Engine pipe not connected')
  })
})
