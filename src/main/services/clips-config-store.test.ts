import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
    isPackaged: false,
  },
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { loadClipsConfig, resetClipsConfig, saveClipsConfig } from './clips-config-store'

describe('clips-config-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads defaults when no file exists', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const cfg = loadClipsConfig()
    expect(cfg.replayTimeSeconds).toBe(120)
    expect(cfg.micEnabled).toBe(true)
    expect(cfg.audioLoopback).toBe(false)
    expect(cfg.fps).toBe(30)
    expect(cfg.width).toBe(1920)
    expect(cfg.height).toBe(1080)
    expect(cfg.bitrateKbps).toBe(40000)
    expect(cfg.cq).toBe(22)
    expect(cfg.maxrateKbps).toBe(30000)
    expect(cfg.bufsizeKbps).toBe(60000)
    expect(cfg.bframes).toBe(3)
    expect(cfg.lookahead).toBe(32)
    expect(cfg.encoderPreset).toBe('p4')
    expect(cfg.forceSoftware).toBe(false)
    expect(cfg.pushToTalk).toBe('hold')
    expect(cfg.pushToTalkKeys).toEqual([5, 20])
    expect(cfg.gameDetection).toBe(true)
    expect(cfg.gameAudioOnly).toBe(true)
    expect(cfg.hotkeys).toHaveLength(3)
    expect(cfg.hotkeys[0].vk).toBe(123)
    expect(cfg.hotkeys[1].vk).toBe(122)
    expect(cfg.hotkeys[2].vk).toBe(49)
    expect(cfg.outputDirectory).toBe('')
    expect(cfg.useExcludeMode).toBe(false)
    expect(cfg.excludeProcessId).toBe(0)
  })

  it('loads saved config when file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        replayTimeSeconds: 300,
        micEnabled: false,
        audioLoopback: true,
        fps: 120,
        width: 2560,
        height: 1440,
        bitrateKbps: 50000,
        cq: 22,
        maxrateKbps: 30000,
        bufsizeKbps: 60000,
        bframes: 0,
        lookahead: 4,
        encoderPreset: 'p4',
        outputDirectory: 'D:\\Clips',
        forceSoftware: true,
        hotkeys: [],
        pushToTalk: 'hold',
        pushToTalkKeys: [0x7a, 0x7b],
        gameDetection: true,
        gameAudioOnly: true,
      }),
    )
    const cfg = loadClipsConfig()
    expect(cfg.replayTimeSeconds).toBe(300)
    expect(cfg.micEnabled).toBe(false)
    expect(cfg.audioLoopback).toBe(true)
    expect(cfg.fps).toBe(120)
    expect(cfg.width).toBe(2560)
    expect(cfg.height).toBe(1440)
    expect(cfg.bitrateKbps).toBe(50000)
    expect(cfg.cq).toBe(22)
    expect(cfg.maxrateKbps).toBe(30000)
    expect(cfg.bufsizeKbps).toBe(60000)
    expect(cfg.bframes).toBe(0)
    expect(cfg.lookahead).toBe(4)
    expect(cfg.encoderPreset).toBe('p4')
    expect(cfg.outputDirectory).toBe('D:\\Clips')
    expect(cfg.forceSoftware).toBe(true)
    expect(cfg.pushToTalk).toBe('hold')
    expect(cfg.pushToTalkKeys).toEqual([0x7a, 0x7b])
    expect(cfg.gameDetection).toBe(true)
    expect(cfg.gameAudioOnly).toBe(true)
  })

  it('falls back to defaults on corrupt JSON', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue('not-json')
    const cfg = loadClipsConfig()
    expect(cfg.replayTimeSeconds).toBe(120)
  })

  it('saves config with partial update', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const saved = saveClipsConfig({ fps: 120, gameAudioOnly: true })
    expect(saved.fps).toBe(120)
    expect(saved.gameAudioOnly).toBe(true)
    expect(saved.replayTimeSeconds).toBe(120)
    expect(writeFileSync).toHaveBeenCalledTimes(1)
  })

  it('resets to defaults', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    resetClipsConfig()
    expect(writeFileSync).toHaveBeenCalled()
    const callArg = JSON.parse(vi.mocked(writeFileSync).mock.calls[0][1] as string)
    expect(callArg.gameDetection).toBe(true)
    expect(callArg.gameAudioOnly).toBe(true)
  })
})
