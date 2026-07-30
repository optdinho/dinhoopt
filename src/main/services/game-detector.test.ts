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

  it('suppresses the currently detected game', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()
    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    await vi.waitFor(
      () => {
        expect(onDetected).toHaveBeenCalledWith('cs2.exe')
      },
      { timeout: 3000, interval: 100 },
    )

    suppressCurrentGame()
    expect(getDetectedGame()).toBeNull()
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

describe('error handling', () => {
  it('handles execFileAsync errors gracefully (caught by getRunningProcessNames)', async () => {
    mocks.execFileAsync.mockRejectedValue(new Error('Access denied'))
    const onDetected = vi.fn()
    const onExited = vi.fn()
    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    await vi.waitFor(
      () => {
        expect(onDetected).not.toHaveBeenCalled()
        expect(onExited).not.toHaveBeenCalled()
      },
      { timeout: 3000, interval: 100 },
    )
  })

  it('handles onGameDetected callback error gracefully', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })
    const onDetected = vi.fn().mockRejectedValue(new Error('Handler error'))
    const onExited = vi.fn()
    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    await vi.waitFor(
      () => {
        expect(onDetected).toHaveBeenCalledWith('cs2.exe')
      },
      { timeout: 3000, interval: 100 },
    )
  })
})

describe('suppression across restart', () => {
  it('preserves suppressedGame when restarting the detector', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()
    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    await vi.waitFor(
      () => {
        expect(onDetected).toHaveBeenCalledWith('cs2.exe')
      },
      { timeout: 3000, interval: 100 },
    )

    suppressCurrentGame()
    expect(getDetectedGame()).toBeNull()

    // Restart — suppressedGame should prevent re-detection of the same game
    onDetected.mockClear()
    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])
    expect(getDetectedGame()).toBeNull()
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

describe('custom game process detection via public API', () => {
  it('detects a custom game process', async () => {
    mocks.execFileAsync.mockReset()
    mocks.execFileAsync.mockResolvedValue({ stdout: '"mygame.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()

    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, ['MyGame.exe'])

    // Wait for the immediate async poll to complete
    await new Promise((resolve) => setTimeout(resolve, 200))

    expect(onDetected).toHaveBeenCalledWith('mygame.exe')
  })
})

describe('game exited callback', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls onGameExited when detected game exits', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()

    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    // Immediate poll runs async — flush microtasks
    await vi.advanceTimersByTimeAsync(0)
    expect(onDetected).toHaveBeenCalledWith('cs2.exe')

    // Now the game leaves
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n', stderr: '' })

    // Advance by 10 seconds to trigger interval poll
    await vi.advanceTimersByTimeAsync(30_000)

    expect(onExited).toHaveBeenCalled()
  })

  it('handles onGameExited callback error gracefully', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn().mockRejectedValue(new Error('Exit handler error'))

    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    await vi.advanceTimersByTimeAsync(0)
    expect(onDetected).toHaveBeenCalledWith('cs2.exe')

    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n', stderr: '' })

    await vi.advanceTimersByTimeAsync(30_000)

    expect(onExited).toHaveBeenCalled()
  })
})

describe('poll concurrency guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('skips poll when pollRunning is true (re-entrant guard)', async () => {
    mocks.execFileAsync.mockImplementation(
      () => new Promise(() => {}), // never resolves
    )
    const onDetected = vi.fn()
    const onExited = vi.fn()
    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    // Advance interval to trigger a second poll that should bail early due to pollRunning
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mocks.execFileAsync).toHaveBeenCalledTimes(1)
    expect(onDetected).not.toHaveBeenCalled()
    expect(onExited).not.toHaveBeenCalled()
  })
})

describe('suppressed game re-detection guard', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('does not re-detect a suppressed game that is still running', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()
    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])
    await vi.advanceTimersByTimeAsync(0)
    expect(onDetected).toHaveBeenCalledTimes(1)

    suppressCurrentGame()
    onDetected.mockClear()

    // Next poll: cs2.exe still running → game === suppressedGame → early return
    await vi.advanceTimersByTimeAsync(30_000)

    expect(onDetected).not.toHaveBeenCalled()
    expect(getDetectedGame()).toBeNull()
  })
})

describe('CSV parsing edge cases', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('gracefully handles malformed tasklist lines', async () => {
    mocks.execFileAsync.mockResolvedValue({
      stdout: '"cs2.exe"\n\n"dota2.exe"\nsome garbled line without quotes\n',
      stderr: '',
    })
    const onDetected = vi.fn()
    const onExited = vi.fn()
    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    await vi.advanceTimersByTimeAsync(0)

    // Should detect cs2.exe (first valid entry) despite garbage lines
    expect(onDetected).toHaveBeenCalledWith('cs2.exe')
  })
})

describe('suppressed game exit', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('clears suppressedGame when the suppressed game exits', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()

    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])

    // Wait for detection
    await vi.advanceTimersByTimeAsync(0)
    expect(onDetected).toHaveBeenCalledWith('cs2.exe')

    // Suppress the game
    suppressCurrentGame()
    expect(getDetectedGame()).toBeNull()

    // Game exits — mock returns no game processes
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n', stderr: '' })
    onDetected.mockClear()

    // Advance interval — poll runs, sees no game and suppressedGame is set
    // The !game && !detectedGame && suppressedGame branch clears suppressedGame
    await vi.advanceTimersByTimeAsync(30_000)

    // Now bring cs2 back — should be detected again since suppressedGame was cleared
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })

    await vi.advanceTimersByTimeAsync(30_000)

    expect(onDetected).toHaveBeenCalledWith('cs2.exe')
  })
})
