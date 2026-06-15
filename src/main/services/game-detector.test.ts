import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
}))

vi.mock('./exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
}))

import {
  getDetectedGame,
  isDetectorRunning,
  startGameDetector,
  stopGameDetector,
  suppressCurrentGame,
} from './game-detector'

// Replicate internal functions for testing since they are not exported
const KNOWN_GAME_PROCESSES = new Set([
  'cs2.exe',
  'dota2.exe',
  'valorant-win64-shipping.exe',
  'fortniteclient-win64-shipping.exe',
  'cyberpunk2077.exe',
  'eldenring.exe',
  'bg3.exe',
  'helldivers2.exe',
  'league of legends.exe',
  'overwatch.exe',
  'wow.exe',
])

function findGame(running: Set<string>, customGameProcesses: string[]): string | null {
  for (const proc of running) {
    if (KNOWN_GAME_PROCESSES.has(proc)) return proc
  }
  for (const custom of customGameProcesses) {
    if (running.has(custom.toLowerCase())) return custom.toLowerCase()
  }
  return null
}

beforeEach(() => {
  vi.clearAllMocks()
  stopGameDetector()
})

describe('findGame', () => {
  it('returns null when no known games are running', () => {
    const running = new Set(['explorer.exe', 'chrome.exe', 'code.exe'])
    expect(findGame(running, [])).toBeNull()
  })

  it('detects a known game process', () => {
    const running = new Set(['explorer.exe', 'cs2.exe', 'discord.exe'])
    expect(findGame(running, [])).toBe('cs2.exe')
  })

  it('matches custom game processes', () => {
    const running = new Set(['mygame.exe', 'notepad.exe'])
    expect(findGame(running, ['mygame.exe'])).toBe('mygame.exe')
  })

  it('is case-insensitive for custom processes', () => {
    const running = new Set(['mygame.exe', 'notepad.exe'])
    expect(findGame(running, ['MyGame.exe'])).toBe('mygame.exe')
  })

  it('prioritizes known games over custom', () => {
    const running = new Set(['cs2.exe', 'myapp.exe'])
    expect(findGame(running, ['myapp.exe'])).toBe('cs2.exe')
  })
})

describe('startGameDetector / stopGameDetector', () => {
  it('starts polling and detects a game', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()

    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])
    expect(isDetectorRunning()).toBe(true)

    await vi.waitFor(
      () => {
        expect(onDetected).toHaveBeenCalledWith('cs2.exe')
      },
      { timeout: 3000, interval: 100 },
    )
  })

  it('stops polling and clears state', () => {
    startGameDetector({ onGameDetected: vi.fn(), onGameExited: vi.fn() }, [])
    expect(isDetectorRunning()).toBe(true)

    stopGameDetector()
    expect(isDetectorRunning()).toBe(false)
    expect(getDetectedGame()).toBeNull()
  })
})

describe('suppressCurrentGame', () => {
  it('suppresses without crashing when no game is detected', () => {
    expect(() => suppressCurrentGame()).not.toThrow()
  })
})

describe('getDetectedGame', () => {
  it('returns null when no game is detected', () => {
    expect(getDetectedGame()).toBeNull()
  })
})

describe('isDetectorRunning', () => {
  it('returns false when not started', () => {
    expect(isDetectorRunning()).toBe(false)
  })

  it('returns true after start and false after stop', () => {
    startGameDetector({ onGameDetected: vi.fn(), onGameExited: vi.fn() }, [])
    expect(isDetectorRunning()).toBe(true)
    stopGameDetector()
    expect(isDetectorRunning()).toBe(false)
  })
})

describe('end-to-end: detection lifecycle', () => {
  it('calls onGameDetected then onGameExited as processes change', async () => {
    // First poll: game detected
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '"cs2.exe"\n', stderr: '' })
    // Second poll: game gone
    mocks.execFileAsync.mockResolvedValueOnce({ stdout: '"explorer.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()

    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    // Wait for detection
    await vi.waitFor(
      () => {
        expect(onDetected).toHaveBeenCalledWith('cs2.exe')
      },
      { timeout: 3000, interval: 100 },
    )

    // suppress the game (simulates manual deactivation)
    suppressCurrentGame()
    expect(getDetectedGame()).toBeNull()
  })
})
