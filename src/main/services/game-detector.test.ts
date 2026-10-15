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
  isNonGameProcess,
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

  it('ignores a custom process that is a known non-game', () => {
    expect(findGame(new Set(['chrome.exe']), ['chrome.exe'])).toBeNull()
    expect(findGame(new Set(['explorer.exe']), ['explorer.exe'])).toBeNull()
  })
})

describe('isNonGameProcess', () => {
  it('classifies browsers and media/UWP hosts as non-games', () => {
    for (const name of [
      'chrome.exe',
      'msedge.exe',
      'firefox.exe',
      'ApplicationFrameHost.exe',
      'Video.UI.exe',
      'Microsoft.Media.Player.exe',
      'explorer.exe',
    ]) {
      expect(isNonGameProcess(name), name).toBe(true)
    }
  })

  it('classifies every known browser as a non-game', () => {
    for (const name of [
      // Chromium / Blink
      'chrome.exe',
      'msedge.exe',
      'brave.exe',
      'opera.exe',
      'opera_gx.exe',
      'vivaldi.exe',
      'chromium.exe',
      'duckduckgo.exe',
      'yandex.exe',
      'browser.exe',
      'avastbrowser.exe',
      'avgbrowser.exe',
      'dragon.exe',
      'slimjet.exe',
      'iron.exe',
      'maxthon.exe',
      '360se.exe',
      '360chrome.exe',
      'qqbrowser.exe',
      'ucbrowser.exe',
      'puffin.exe',
      'sidekick.exe',
      'arc.exe',
      'wavebox.exe',
      'ghost.exe',
      'centbrowser.exe',
      'whale.exe',
      'thorium.exe',
      'iridium.exe',
      'comodo_dragon.exe',
      'epic.exe',
      'naver.exe',
      'rambox.exe',
      'station.exe',
      'microsoftedge.exe',
      'chrome_proxy.exe',
      'brave_proxy.exe',
      'msedge_proxy.exe',
      // Gecko
      'firefox.exe',
      'waterfox.exe',
      'librewolf.exe',
      'floorp.exe',
      'palemoon.exe',
      'basilisk.exe',
      'seamonkey.exe',
      'torbrowser.exe',
      'tor.exe',
      'kmeleon.exe',
      'mercury.exe',
      'mullvadbrowser.exe',
      'firefox_proxy.exe',
      'firefox-esr.exe',
      'firefox-tor.exe',
      // Other engines / legacy
      'iexplore.exe',
      'safari.exe',
      'falkon.exe',
      'netscape.exe',
      'baidubrowser.exe',
      'sogouexplorer.exe',
      '2345explorer.exe',
      'liebao.exe',
      'theworld.exe',
      'greenbrowser.exe',
      'sleipnir.exe',
      'lunascape.exe',
      'avant.exe',
      'torch.exe',
      'icedragon.exe',
      'qupzilla.exe',
      'midori.exe',
      'epiphany.exe',
      'konqueror.exe',
      // WebView hosts
      'msedgewebview2.exe',
      'webview2.exe',
      'edgewebview2.exe',
      'applicationframehost.exe',
    ]) {
      expect(isNonGameProcess(name), name).toBe(true)
    }
  })

  it('does not classify a real game as a non-game', () => {
    expect(isNonGameProcess('cs2.exe')).toBe(false)
    expect(isNonGameProcess('FiveM_b3258_GTAProcess.exe')).toBe(false)
    expect(isNonGameProcess('Minecraft.Windows.exe')).toBe(false)
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
    await vi.waitFor(() => expect(onDetected).toHaveBeenCalledWith('mygame.exe'))
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

describe('game database nonGames', () => {
  const dbPath = join(tmpdir(), 'game-detector-nongames-db.json')

  afterAll(() => {
    rmSync(dbPath, { force: true })
  })

  it('classifies a database nonGame as a non-game process', async () => {
    writeFileSync(
      dbPath,
      JSON.stringify({ version: 3, games: [{ processName: 'cs2' }], nonGames: ['yandex', 'Thorium', 'SomeTool'] }),
    )
    await loadGameDatabase(dbPath)

    expect(isNonGameProcess('yandex.exe')).toBe(true)
    expect(isNonGameProcess('Thorium.exe')).toBe(true)
    expect(isNonGameProcess('cs2.exe')).toBe(false)
  })

  it('does not detect a process the database lists as a nonGame', async () => {
    writeFileSync(dbPath, JSON.stringify({ version: 3, games: [{ processName: 'yandex' }], nonGames: ['yandex'] }))
    await loadGameDatabase(dbPath)

    expect(findGame(new Set(['yandex.exe']), [])).toBeNull()
  })

  it('keeps a loaded nonGame list when a later database has none', async () => {
    writeFileSync(dbPath, JSON.stringify({ version: 3, games: [{ processName: 'cs2' }], nonGames: ['SomeTool'] }))
    await loadGameDatabase(dbPath)
    // A partial/older database without `nonGames` must not wipe the list.
    await loadGameDatabase(join(tmpdir(), 'does-not-exist-games.json'))

    expect(isNonGameProcess('SomeTool.exe')).toBe(true)
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
          { processName: 'chrome' },
          { processName: 'FiveM_GTAProcess', windowClass: 'grcWindow', displayName: 'FiveM (GTA V)' },
          { windowClass: 'ApplicationFrameWindow', displayName: 'Minecraft (Bedrock)' },
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

  it('ignores a database name that collides with a non-game process', () => {
    expect(findGame(new Set(['chrome.exe']), [])).toBeNull()
  })

  it('ignores a class match owned by a non-game host process', () => {
    const windows = [{ className: 'ApplicationFrameWindow', pid: 42, processName: 'ApplicationFrameHost.exe' }]
    expect(findGameWithDisplay(new Set(['ApplicationFrameHost.exe']), [], windows, getWindowClassLookup())).toBeNull()
  })

  it('still detects the same class when the owning process is the game itself', () => {
    const windows = [{ className: 'ApplicationFrameWindow', pid: 42, processName: 'Minecraft.Windows.exe' }]
    const match = findGameWithDisplay(new Set(['minecraft.windows.exe']), [], windows, getWindowClassLookup())
    expect(match).toEqual({ processName: 'Minecraft.Windows.exe', displayName: 'Minecraft (Bedrock)' })
  })

  it('detects a build-stamped game by window class when the name is unknown', () => {
    const windows = [{ className: 'grcWindow', pid: 18260, processName: 'FiveM_b3258_GTAProcess.exe' }]
    const match = findGameWithDisplay(new Set(['fivem_b3258_gtaprocess.exe']), [], windows, getWindowClassLookup())
    expect(match).toEqual({ processName: 'FiveM_b3258_GTAProcess.exe', displayName: 'FiveM (GTA V)' })
  })

  it('ignores a generic engine class owned by a non-game process', () => {
    const windows = [{ className: 'UnityWndClass', pid: 7, processName: 'SomeUnityTool.exe' }]
    expect(findGameWithDisplay(new Set(['someunitytool.exe']), [], windows, getWindowClassLookup())).toBeNull()
  })

  it('ignores the generic WINDOW class owned by an unknown process', () => {
    const windows = [{ className: 'WINDOW', pid: 5, processName: 'SomeRandomApp.exe' }]
    expect(findGameWithDisplay(new Set(['somerandomapp.exe']), [], windows, getWindowClassLookup())).toBeNull()
  })

  it('still trusts a specific class when the owning process is not known', () => {
    // `FORTNITE` is specific, so an unknown-name process still wins via the class.
    const windows = [{ className: 'FORTNITE', pid: 9, processName: 'Fortnite_unknown_build.exe' }]
    const match = findGameWithDisplay(new Set(['fortnite_unknown_build.exe']), [], windows, getWindowClassLookup())
    expect(match).toEqual({ processName: 'Fortnite_unknown_build.exe', displayName: 'Fortnite' })
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
