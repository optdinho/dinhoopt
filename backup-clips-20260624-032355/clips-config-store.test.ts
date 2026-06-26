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
import { loadClipsConfig, saveClipsConfig, resetClipsConfig } from './clips-config-store'

describe('clips-config-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads defaults when no file exists', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const cfg = loadClipsConfig()
    expect(cfg.replayTimeSeconds).toBe(60)
    expect(cfg.micEnabled).toBe(true)
    expect(cfg.audioLoopback).toBe(false)
    expect(cfg.fps).toBe(60)
    expect(cfg.width).toBe(1920)
    expect(cfg.height).toBe(1080)
    expect(cfg.bitrateKbps).toBe(20000)
    expect(cfg.forceSoftware).toBe(false)
    expect(cfg.pushToTalk).toBe('off')
    expect(cfg.pushToTalkKeys).toEqual([0x7a])
    expect(cfg.gameDetection).toBe(false)
    expect(cfg.gameAudioOnly).toBe(false)
    expect(cfg.hotkeys).toEqual([])
    expect(cfg.outputDirectory).toBe('')
    expect(cfg.useExcludeMode).toBe(false)
    expect(cfg.excludeProcessId).toBe(0)
  })

  it('loads saved config when file exists', () => {
    vi.mocked(existsSync).mockReturnValue(true)
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({
      replayTimeSeconds: 300,
      micEnabled: false,
      audioLoopback: true,
      fps: 120,
      width: 2560,
      height: 1440,
      bitrateKbps: 50000,
      outputDirectory: 'D:\\Clips',
      forceSoftware: true,
      hotkeys: [],
      pushToTalk: 'hold',
      pushToTalkKeys: [0x7a, 0x7b],
      gameDetection: true,
      gameAudioOnly: true,
    }))
    const cfg = loadClipsConfig()
    expect(cfg.replayTimeSeconds).toBe(300)
    expect(cfg.micEnabled).toBe(false)
    expect(cfg.audioLoopback).toBe(true)
    expect(cfg.fps).toBe(120)
    expect(cfg.width).toBe(2560)
    expect(cfg.height).toBe(1440)
    expect(cfg.bitrateKbps).toBe(50000)
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
    expect(cfg.replayTimeSeconds).toBe(60)
  })

  it('saves config with partial update', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    const saved = saveClipsConfig({ fps: 120, gameAudioOnly: true })
    expect(saved.fps).toBe(120)
    expect(saved.gameAudioOnly).toBe(true)
    expect(saved.replayTimeSeconds).toBe(60)
    expect(writeFileSync).toHaveBeenCalledTimes(1)
  })

  it('resets to defaults', () => {
    vi.mocked(existsSync).mockReturnValue(false)
    resetClipsConfig()
    expect(writeFileSync).toHaveBeenCalled()
    const callArg = JSON.parse((vi.mocked(writeFileSync).mock.calls[0][1] as string))
    expect(callArg.gameDetection).toBe(false)
    expect(callArg.gameAudioOnly).toBe(false)
  })
})
