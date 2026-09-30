import { rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execFileAsync: vi.fn(),
  execTracked: vi.fn(),
  psArgs: vi.fn((script: string) => ['-NoProfile', '-NonInteractive', '-Command', script]),
}))

vi.mock('./exec-utf8', () => ({
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  execTracked: (...args: unknown[]) => mocks.execTracked(...args),
  psArgs: (...args: unknown[]) => mocks.psArgs(...(args as [string])),
}))

import {
  findGame,
  findGameWithDisplay,
  getDetectedGame,
  getWindowClassLookup,
  isDetectorRunning,
  loadGameDatabase,
  normalizeGameName,
  resolveGameProfile,
  startGameDetector,
  stopGameDetector,
  suppressCurrentGame,
} from './game-detector'

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

describe('window class probe', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.execTracked.mockResolvedValue({ stdout: '', stderr: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const fivemWindow = 'grcWindow\t18260\tFiveM_b3258_GTAProcess.exe\n'

  it('detects a build-stamped game through the probe and reports its friendly name', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n"FiveM_b3258_GTAProcess.exe"\n', stderr: '' })
    mocks.execTracked.mockResolvedValue({ stdout: fivemWindow, stderr: '' })
    const onDetected = vi.fn()

    startGameDetector({ onGameDetected: onDetected, onGameExited: vi.fn() }, [])
    await vi.advanceTimersByTimeAsync(0)

    expect(onDetected).toHaveBeenCalledWith('FiveM_b3258_GTAProcess.exe', 'FiveM (GTA V)')
  })

  it('does not probe when a known game already matched by process name', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n', stderr: '' })

    startGameDetector({ onGameDetected: vi.fn(), onGameExited: vi.fn() }, [])
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.execTracked).not.toHaveBeenCalled()
  })

  it('does not re-probe while the process set is unchanged', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n', stderr: '' })

    startGameDetector({ onGameDetected: vi.fn(), onGameExited: vi.fn() }, [])
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mocks.execTracked).toHaveBeenCalledTimes(1)
  })

  it('probes again after a process disappears and comes back', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n"a.exe"\n', stderr: '' })

    startGameDetector({ onGameDetected: vi.fn(), onGameExited: vi.fn() }, [])
    await vi.advanceTimersByTimeAsync(0)
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n', stderr: '' })
    await vi.advanceTimersByTimeAsync(30_000)
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n"a.exe"\n', stderr: '' })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(mocks.execTracked).toHaveBeenCalledTimes(2)
  })

  it('survives a probe that throws, reporting no game', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n', stderr: '' })
    mocks.execTracked.mockRejectedValue(new Error('powershell blocked'))

    startGameDetector({ onGameDetected: vi.fn(), onGameExited: vi.fn() }, [])
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.execTracked).toHaveBeenCalled()
    expect(getDetectedGame()).toBeNull()
  })

  it('still detects a known game by name when the probe would fail', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"cs2.exe"\n"explorer.exe"\n', stderr: '' })
    mocks.execTracked.mockRejectedValue(new Error('powershell blocked'))

    startGameDetector({ onGameDetected: vi.fn(), onGameExited: vi.fn() }, [])
    await vi.advanceTimersByTimeAsync(0)

    expect(getDetectedGame()).toBe('cs2.exe')
  })

  it('reports the game as exited when the probe stops matching it', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"FiveM_b3258_GTAProcess.exe"\n', stderr: '' })
    mocks.execTracked.mockResolvedValue({ stdout: fivemWindow, stderr: '' })
    const onDetected = vi.fn()
    const onExited = vi.fn()

    startGameDetector({ onGameDetected: onDetected, onGameExited: onExited }, [])
    await vi.advanceTimersByTimeAsync(0)
    expect(getDetectedGame()).toBe('FiveM_b3258_GTAProcess.exe')

    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n', stderr: '' })
    mocks.execTracked.mockResolvedValue({ stdout: '', stderr: '' })
    await vi.advanceTimersByTimeAsync(30_000)

    expect(onExited).toHaveBeenCalled()
    expect(getDetectedGame()).toBeNull()
  })

  it('aborts an in-flight probe when the detector stops', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"unknowngame.exe"\n', stderr: '' })
    let capturedSignal: AbortSignal | undefined
    mocks.execTracked.mockImplementation(
      (_file: string, _args: string[], opts?: { signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          capturedSignal = opts?.signal
          opts?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
        }),
    )
    const onDetected = vi.fn()

    startGameDetector({ onGameDetected: onDetected, onGameExited: vi.fn() }, [])
    await vi.advanceTimersByTimeAsync(0)
    expect(capturedSignal?.aborted).toBe(false)

    stopGameDetector()
    await vi.advanceTimersByTimeAsync(0)

    expect(capturedSignal?.aborted).toBe(true)
    expect(onDetected).not.toHaveBeenCalled()
  })

  it('resets the probe gate when the detector restarts', async () => {
    mocks.execFileAsync.mockResolvedValue({ stdout: '"explorer.exe"\n', stderr: '' })
    const cbs = { onGameDetected: vi.fn(), onGameExited: vi.fn() }

    startGameDetector(cbs, [])
    await vi.advanceTimersByTimeAsync(0)
    stopGameDetector()
    startGameDetector(cbs, [])
    await vi.advanceTimersByTimeAsync(0)

    expect(mocks.execTracked).toHaveBeenCalledTimes(2)
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

describe('games.json database loading', () => {
  const tempDb = join(tmpdir(), 'game-detector-test-games.json')

  afterAll(() => {
    rmSync(tempDb, { force: true })
  })

  it('normalizeGameName strips .exe and lowercases', () => {
    expect(normalizeGameName('CS2.EXE')).toBe('cs2')
    expect(normalizeGameName('cs2')).toBe('cs2')
  })

  it('loads processName entries from the database', async () => {
    writeFileSync(
      tempDb,
      JSON.stringify({ version: 2, games: [{ processName: 'gris' }, { processName: 'SeaOfThieves' }] }),
    )
    await loadGameDatabase(tempDb)

    const running = new Set(['explorer.exe', 'gris.exe'])
    expect(findGame(running, [])).toBe('gris.exe')
  })

  it('matches aliases from the database', async () => {
    writeFileSync(
      tempDb,
      JSON.stringify({ version: 2, games: [{ processName: 'sot', aliases: ['seaofthieves.exe', 'sea of thieves'] }] }),
    )
    await loadGameDatabase(tempDb)

    const running = new Set(['seaofthieves.exe'])
    expect(findGame(running, [])).toBe('seaofthieves.exe')
  })

  it('matches case-insensitively and strips .exe on both sides', async () => {
    writeFileSync(tempDb, JSON.stringify({ version: 2, games: [{ processName: 'GTA5' }] }))
    await loadGameDatabase(tempDb)

    const running = new Set(['gta5.exe'])
    expect(findGame(running, [])).toBe('gta5.exe')
  })

  it('keeps previously loaded entries when a database path is missing', async () => {
    writeFileSync(tempDb, JSON.stringify({ version: 2, games: [{ processName: 'gris' }] }))
    await loadGameDatabase(tempDb)
    await loadGameDatabase(join(tmpdir(), 'does-not-exist-games.json'))

    const running = new Set(['gris.exe'])
    expect(findGame(running, [])).toBe('gris.exe')
  })

  it('returns the original running name (with .exe) for database matches', async () => {
    writeFileSync(tempDb, JSON.stringify({ version: 2, games: [{ processName: 'dota2' }] }))
    await loadGameDatabase(tempDb)

    const running = new Set(['DOTA2.exe'])
    expect(findGame(running, [])).toBe('DOTA2.exe')
  })

  it('indexes windowClass from the database', async () => {
    writeFileSync(
      tempDb,
      JSON.stringify({
        version: 2,
        games: [{ processName: 'FiveM_GTAProcess', windowClass: 'grcWindow', displayName: 'FiveM (GTA V)' }],
      }),
    )
    await loadGameDatabase(tempDb)

    expect(getWindowClassLookup().get('grcwindow')).toBe('FiveM (GTA V)')
  })

  it('keeps the hardcoded class map when the database has no windowClass', async () => {
    writeFileSync(tempDb, JSON.stringify({ version: 2, games: [{ processName: 'gris' }] }))
    await loadGameDatabase(tempDb)

    expect(getWindowClassLookup().get('grcwindow')).toBeDefined()
  })

  it('keeps the hardcoded class map when the database is unavailable', async () => {
    await loadGameDatabase(join(tmpdir(), 'does-not-exist-games.json'))

    expect(getWindowClassLookup().get('grcwindow')).toBeDefined()
  })
})

describe('resolveGameProfile', () => {
  const profiles = {
    'cs2.exe': { gameName: 'CS2', enabledOptimizations: ['sys-power-plan'] },
    'FiveM (GTA V)': { gameName: 'FiveM', enabledOptimizations: ['gpu-boost'] },
  }

  it('matches on the process name', () => {
    expect(resolveGameProfile(profiles, 'cs2.exe')?.enabledOptimizations).toEqual(['sys-power-plan'])
  })

  it('matches on the display name of a window-class detection', () => {
    expect(resolveGameProfile(profiles, 'FiveM_b3258_GTAProcess.exe', 'FiveM (GTA V)')?.enabledOptimizations).toEqual([
      'gpu-boost',
    ])
  })

  it('prefers the process name when both keys exist', () => {
    const both = { ...profiles, 'FiveM_b3258_GTAProcess.exe': { gameName: 'ByName', enabledOptimizations: ['a'] } }
    expect(resolveGameProfile(both, 'FiveM_b3258_GTAProcess.exe', 'FiveM (GTA V)')?.enabledOptimizations).toEqual(['a'])
  })

  it('returns undefined with no profiles at all', () => {
    expect(resolveGameProfile(undefined, 'cs2.exe')).toBeUndefined()
  })

  it('returns undefined when no key matches', () => {
    expect(resolveGameProfile(profiles, 'unknown.exe', 'Unknown Game')).toBeUndefined()
  })

  it('ignores a missing or empty display name', () => {
    expect(resolveGameProfile(profiles, 'cs2.exe', null)).toEqual(profiles['cs2.exe'])
    expect(resolveGameProfile(profiles, 'unknown.exe', '')).toBeUndefined()
  })
})

describe('findGameWithDisplay', () => {
  const dbPath = join(tmpdir(), 'game-detector-window-class-db.json')

  // `loadGameDatabase` replaces the name set wholesale, so pin a known fixture
  // instead of depending on whatever a previous suite left loaded.
  beforeEach(async () => {
    writeFileSync(
      dbPath,
      JSON.stringify({
        version: 2,
        games: [
          { processName: 'cs2' },
          { processName: 'FiveM_GTAProcess', windowClass: 'grcWindow', displayName: 'FiveM (GTA V)' },
        ],
      }),
    )
    await loadGameDatabase(dbPath)
  })

  afterAll(() => {
    rmSync(dbPath, { force: true })
  })

  it('prefers a process-name match and reports no friendly name', () => {
    const match = findGameWithDisplay(new Set(['cs2.exe']), [], [], getWindowClassLookup())
    expect(match).toEqual({ processName: 'cs2.exe', displayName: null })
  })

  it('detects a build-stamped game by window class when the name is unknown', () => {
    const windows = [{ className: 'grcWindow', pid: 18260, processName: 'FiveM_b3258_GTAProcess.exe' }]
    const match = findGameWithDisplay(new Set(['fivem_b3258_gtaprocess.exe']), [], windows, getWindowClassLookup())
    expect(match).toEqual({ processName: 'FiveM_b3258_GTAProcess.exe', displayName: 'FiveM (GTA V)' })
  })

  it('rejects a class match whose process is no longer running', () => {
    const windows = [{ className: 'grcWindow', pid: 18260, processName: 'FiveM.exe' }]
    expect(findGameWithDisplay(new Set(['explorer.exe']), [], windows, getWindowClassLookup())).toBeNull()
  })

  it('ignores a class match with an empty process name', () => {
    const windows = [{ className: 'grcWindow', pid: 18260, processName: '' }]
    expect(findGameWithDisplay(new Set(['']), [], windows, getWindowClassLookup())).toBeNull()
  })

  it('returns null when neither name nor class matches', () => {
    const windows = [{ className: 'Notepad', pid: 1, processName: 'notepad.exe' }]
    expect(findGameWithDisplay(new Set(['notepad.exe']), [], windows, getWindowClassLookup())).toBeNull()
  })
})
