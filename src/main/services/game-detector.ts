import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { execFileAsync } from './exec-utf8'
import { buildClassLookup, findGamesByWindowClass, getVisibleWindows, type VisibleWindow } from './game-window-probe'

// ── Well-known game executables (lowercase) ────────────────────
// This list covers popular PC titles.  Users can add their own
// via the customGameProcesses setting.

const KNOWN_GAME_PROCESSES = new Set([
  // Valve / Steam
  'cs2.exe',
  'csgo.exe',
  'dota2.exe',
  'tf_win64.exe',
  'left4dead2.exe',
  'portal2.exe',
  'hl2.exe',
  'rust.exe',
  'deadlock.exe',
  // Riot
  'valorant-win64-shipping.exe',
  'league of legends.exe',
  // Blizzard / Activision
  'overwatch.exe',
  'wow.exe',
  'wowclassic.exe',
  'diablo iv.exe',
  'hearthstone.exe',
  'starcraft ii.exe',
  // Epic / Fortnite
  'fortniteclient-win64-shipping.exe',
  'rocketleague.exe',
  // EA
  'apex_legends.exe',
  'bf2042.exe',
  // Ubisoft
  'rainbow six.exe',
  'acodyssey.exe',
  'acvalhalla.exe',
  'acmirage.exe',
  // Rockstar
  'gta5.exe',
  'gtav.exe',
  'rdr2.exe',
  // FromSoftware
  'eldenring.exe',
  'darksoulsiii.exe',
  'sekiro.exe',
  'armoredcore6.exe',
  // CD Projekt Red
  'cyberpunk2077.exe',
  'witcher3.exe',
  // Larian
  'bg3.exe',
  'bg3_dx11.exe',
  // Bungie
  'destiny2.exe',
  // Digital Extremes
  'warframe.x64.exe',
  'warframe.exe',
  // GGG
  'pathofexile_x64.exe',
  'pathofexile.exe',
  'pathofexile_x64steam.exe',
  // Battle royale / shooters
  'escapefromtarkov.exe',
  'pubg-win64-shipping.exe',
  'tslgame.exe',
  'callofduty.exe',
  'cod.exe',
  'modernwarfare.exe',
  // Recent / popular
  'palworld-win64-shipping.exe',
  'helldivers2.exe',
  'hogwartslegacy.exe',
  'starfield.exe',
  'satisfactory.exe',
  'lethalcompany.exe',
  'hades2.exe',
  'hades.exe',
  'hollowknight.exe',
  'fallguys_client.exe',
  'amongus.exe',
  'terraria.exe',
  'stardewvalley.exe',
  'factorio.exe',
  'noita.exe',
  'deeprockgalactic-win64-shipping.exe',
  'minecraft.windows.exe',
  'theforest.exe',
  'sonsoftheforest.exe',
])

// ── Game database (games.json from the clips engine) ───────────
// Same source of truth as the C# clips engine detection.  Loaded from
// the engine directory (packaged) or the repo (dev); falls back to
// KNOWN_GAME_PROCESSES when unavailable.  Entries have no `.exe`
// suffix, so matching normalizes both sides (lowercase + strip `.exe`).

export function normalizeGameName(name: string): string {
  return name.toLowerCase().replace(/\.exe$/i, '')
}

// ── Non-game processes (lowercase, no `.exe`) ──────────────────
// Mirrors the clips engine's C# `NonGameProcesses` (EngineCoordinator.Game.cs),
// and is merged with the engine database's `nonGames` list (320 entries) when
// `games.json` loads, so the two detectors share one source of truth.  The
// database covers far more (browsers, editors, launchers, system hosts) than the
// hardcoded subset below.  The window-class fallback matches generic host
// classes — `games.json` maps `ApplicationFrameWindow` to "Minecraft (Bedrock)",
// but that class belongs to every UWP/system window, and browsers/media players
// host windows too — so a match must never win when the owning process is a
// browser, a media player or a UWP/system host.  Without this, opening a
// fullscreen video activated Game Mode and started clip capture as if a game
// had launched.
export const NON_GAME_PROCESSES = new Set<string>([
  // Browsers / webview hosts.  A browser window can carry a class the database
  // maps to a game (e.g. `ApplicationFrameWindow` → "Minecraft (Bedrock)"), so
  // the whole family must be listed here regardless of which engine it uses.
  // Chromium / Blink
  'chrome',
  'msedge',
  'brave',
  'opera',
  'opera_gx',
  'vivaldi',
  'chromium',
  'duckduckgo',
  'yandex',
  'browser', // Yandex/Coc Coc image name
  'avastbrowser',
  'avgbrowser',
  'dragon',
  'slimjet',
  'iron',
  'maxthon',
  '360se',
  '360chrome',
  'qqbrowser',
  'ucbrowser',
  'puffin',
  'sidekick',
  'arc',
  'wavebox',
  'ghost',
  'centbrowser',
  'whale',
  'thorium',
  'iridium',
  'comodo_dragon',
  'epic',
  'naver',
  'rambox',
  'station',
  'chrome_proxy',
  'brave_proxy',
  'msedge_proxy',
  'microsoftedge',
  // Gecko
  'firefox',
  'waterfox',
  'librewolf',
  'floorp',
  'palemoon',
  'basilisk',
  'seamonkey',
  'torbrowser',
  'tor',
  'kmeleon',
  'mercury',
  'mullvadbrowser',
  'firefox_proxy',
  'firefox-esr',
  'firefox-tor',
  // Other engines / legacy
  'iexplore',
  'safari',
  'falkon',
  'netscape',
  'baidubrowser',
  'sogouexplorer',
  '2345explorer',
  'liebao',
  'theworld',
  'greenbrowser',
  'sleipnir',
  'lunascape',
  'avant',
  'torch',
  'icedragon',
  'qupzilla',
  'midori',
  'epiphany',
  'konqueror',
  // WebView hosts
  'msedgewebview2',
  'webview2',
  'edgewebview2',
  'applicationframehost',
  // Media players / UWP media & video apps
  'video.ui',
  'microsoft.media.player',
  'zunevideo',
  'music.ui',
  'spotify',
  'netflix',
  'vlc',
  'wmplayer',
  'mpv',
  'mpc-hc64',
  // System shell / UWP hosts / settings
  'explorer',
  'searchhost',
  'shellexperiencehost',
  'startmenuexperiencehost',
  'runtimebroker',
  'sihost',
  'ctfmon',
  'lockapp',
  'systemsettings',
  'calculator',
  'photos',
  'widgets',
  'widgetservice',
  // Dev tools / terminals
  'code',
  'devenv',
  'notepad',
  'notepad++',
  'sublime_text',
  'windowsterminal',
  'powershell',
  'pwsh',
  'cmd',
  'conhost',
])

/** Non-game processes loaded from the engine database (`games.json` → `nonGames`).
 *  Empty until the database loads (or if it is unavailable), in which case the
 *  hardcoded set above is the only filter. */
let dbNonGames = new Set<string>()

/** True when `name` is a known non-game process (browser, media player, system host). */
export function isNonGameProcess(name: string): boolean {
  const normalized = normalizeGameName(name)
  return NON_GAME_PROCESSES.has(normalized) || dbNonGames.has(normalized)
}

/** Lowercase process names (no `.exe`) that count as games. */
let gameNames = new Set<string>([...KNOWN_GAME_PROCESSES].map(normalizeGameName))
/** The hardcoded subset, kept separate because `loadGameDatabase` replaces
 *  `gameNames` wholesale — this survives so the generic-class guard can still
 *  recognise a hardcoded title (e.g. `Minecraft.Windows`) after a DB load. */
const HARDCODED_GAME_NAMES = new Set<string>([...KNOWN_GAME_PROCESSES].map(normalizeGameName))
let databaseLoaded = false

// Window class → friendly name.  `games.json` is the primary source, but these
// hardcoded entries mirror the C# `GameDatabase.HardcodedMap` so the fallback
// still works when the database is missing or has no `windowClass` column.
// These are engine classes, so they are specific enough to be safe even though
// the class alone is not proof of a game.
const HARDCODED_WINDOW_CLASSES: { windowClass: string; displayName: string }[] = [
  { windowClass: 'grcWindow', displayName: 'FiveM' },
  { windowClass: 'WINDOW', displayName: 'Roblox' },
  { windowClass: 'SDL_app', displayName: 'CS2/Source Engine' },
  { windowClass: 'CEF-OSC-WIDGET', displayName: 'Valorant' },
  { windowClass: 'UnrealWindow', displayName: 'Unreal Engine' },
  { windowClass: 'UnityWndClass', displayName: 'Unity' },
  { windowClass: 'FORTNITE', displayName: 'Fortnite' },
]

let windowClassLookup = buildClassLookup(HARDCODED_WINDOW_CLASSES)

/** The active window class index, for tests and the class-based match. */
export function getWindowClassLookup(): Map<string, string> {
  return windowClassLookup
}

// ── Generic window classes (lowercase) ─────────────────────────
// Classes that games AND non-game apps share, so a match on one is not proof of
// a game on its own.  `ApplicationFrameWindow` belongs to every UWP window and
// the engine classes (`UnityWndClass`, `UnrealWindow`, …) are used by countless
// non-game tools built on those engines — a Unity/Unreal tool with an unknown
// image name would otherwise activate Game Mode.  A match on one of these is
// only accepted when the owning process is itself a known game; specific classes
// (`grcWindow`, `FORTNITE`, `CEF-OSC-WIDGET`, …) stay trusted on their own,
// which is what keeps build-stamped titles like FiveM working.
const GENERIC_WINDOW_CLASSES = new Set<string>([
  // Host / shell
  'applicationframewindow',
  'window',
  // Engine names shared across unrelated titles
  'unitywndclass',
  'unrealwindow',
  'ue4window',
  'ue5window',
  'sdl_app',
  'valve001',
  'source',
  'frostbite',
  'creation engine',
  're engine',
  'id tech',
  'cryengine',
  'lumberyard',
  'essence',
  'glacier',
  'paradox',
  'void',
  'lucid',
  'katana engine',
  'gamebryo',
  'redengine',
  'redenginewindow',
])

function isGenericWindowClass(windowClass: string): boolean {
  return GENERIC_WINDOW_CLASSES.has(windowClass.trim().toLowerCase())
}

/** True when `name` is a game known either from the database or the hardcoded list. */
function isKnownGameName(name: string): boolean {
  const normalized = normalizeGameName(name)
  return gameNames.has(normalized) || HARDCODED_GAME_NAMES.has(normalized)
}

function gamesJsonCandidates(): string[] {
  const cwd = process.cwd()
  const candidates: string[] = []
  const resourcesPath = (process as { resourcesPath?: string }).resourcesPath
  if (resourcesPath) {
    candidates.push(join(resourcesPath, 'clips-engine', 'games.json'))
  }
  candidates.push(join(cwd, 'dinho-clips-poc', 'src', 'DiNho.Capture.Poc', 'games.json'))
  candidates.push(join(cwd, 'games.json'))
  return candidates
}

function isGameEntry(value: unknown): value is {
  processName?: unknown
  aliases?: unknown
  windowClass?: unknown
  displayName?: unknown
} {
  return typeof value === 'object' && value !== null
}

/** Loads the clips engine game database.  An explicit path bypasses the
 *  candidate search and forces a reload (used by tests). */
export async function loadGameDatabase(path?: string): Promise<void> {
  if (!path && databaseLoaded) return
  const candidates = path ? [path] : gamesJsonCandidates()
  for (const candidate of candidates) {
    try {
      const raw = await readFile(candidate, 'utf8')
      const db = JSON.parse(raw) as { games?: unknown; nonGames?: unknown }
      const games = db?.games
      if (!Array.isArray(games) || games.length === 0) continue
      const names = new Set<string>()
      const classes: { windowClass: string; displayName: string }[] = []
      for (const entry of games) {
        if (!isGameEntry(entry)) continue
        if (typeof entry.processName === 'string' && entry.processName) {
          names.add(normalizeGameName(entry.processName))
        }
        if (Array.isArray(entry.aliases)) {
          for (const alias of entry.aliases) {
            if (typeof alias === 'string' && alias) names.add(normalizeGameName(alias))
          }
        }
        if (typeof entry.windowClass === 'string' && typeof entry.displayName === 'string') {
          classes.push({ windowClass: entry.windowClass, displayName: entry.displayName })
        }
      }
      if (names.size === 0) continue
      gameNames = names
      // Only replace the non-game set when the database actually carries one, so
      // a partial/older database never wipes a previously loaded list.
      if (Array.isArray(db.nonGames)) {
        const nonGames = new Set<string>()
        for (const entry of db.nonGames) {
          if (typeof entry === 'string' && entry) nonGames.add(normalizeGameName(entry))
        }
        dbNonGames = nonGames
      }
      // Database classes first, hardcoded last: `buildClassLookup` keeps the
      // first entry per class, so the database's richer display names win.
      windowClassLookup = buildClassLookup([...classes, ...HARDCODED_WINDOW_CLASSES])
      databaseLoaded = true
      return
    } catch {
      // try next candidate
    }
  }
}

// Kick off loading as soon as this module is imported (game-mode IPC
// imports it at startup), so the first poll usually sees the DB ready.
void loadGameDatabase()

// ── Types ──────────────────────────────────────────────────────

export interface GameAutoEvent {
  type: 'game-detected' | 'game-exited'
  processName: string | null
  /** Friendly game name; only set when the match came from a window class. */
  displayName?: string | null
}

export interface GameDetectorCallbacks {
  onGameDetected: (processName: string, displayName?: string | null) => void
  onGameExited: () => void
}

export interface GameMatch {
  processName: string
  displayName: string | null
}

// ── State ──────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setInterval> | null = null
let callbacks: GameDetectorCallbacks | null = null
let detectedGame: string | null = null
let detectedDisplayName: string | null = null
let pollRunning = false
/** Set when user manually deactivates while a game is detected — suppresses
 *  re-activation until that game exits. */
let suppressedGame: string | null = null

// ── Detection ──────────────────────────────────────────────────

async function getRunningProcessNames(): Promise<Set<string>> {
  try {
    const { stdout } = await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], {
      timeout: 10_000,
      windowsHide: true,
    })
    const names = new Set<string>()
    for (const line of String(stdout).split('\n')) {
      const match = line.match(/^"([^"]+)"/)
      if (match) names.add(match[1]!.toLowerCase())
    }
    return names
  } catch {
    return new Set()
  }
}

export function findGame(running: Set<string>, customGameProcesses: string[]): string | null {
  for (const proc of running) {
    const normalized = normalizeGameName(proc)
    if (isNonGameProcess(normalized)) continue
    if (gameNames.has(normalized)) return proc
  }
  for (const custom of customGameProcesses) {
    // A user-added process still cannot be a browser, media player or system
    // host — otherwise adding e.g. `chrome.exe` would re-open the exact
    // false-activation hole this filter exists to close.
    if (isNonGameProcess(custom)) continue
    if (running.has(custom.toLowerCase())) return custom.toLowerCase()
  }
  return null
}

/**
 * Same as `findGame`, but falls back to the window class of any open window
 * whose process is still in `running`.  That is the only way to catch games
 * whose image name carries a build stamp (`FiveM_b3258_GTAProcess.exe`), since
 * no process-name list can enumerate those.
 */
export function findGameWithDisplay(
  running: Set<string>,
  customGameProcesses: string[],
  windows: VisibleWindow[],
  classLookup: Map<string, string>,
): GameMatch | null {
  const byName = findGame(running, customGameProcesses)
  if (byName) return { processName: byName, displayName: null }
  for (const match of findGamesByWindowClass(windows, classLookup)) {
    if (!match.processName) continue
    if (isNonGameProcess(match.processName)) continue
    if (isGenericWindowClass(match.windowClass) && !isKnownGameName(match.processName)) continue
    if (!running.has(match.processName.toLowerCase())) continue
    return { processName: match.processName, displayName: match.displayName }
  }
  return null
}

/**
 * Resolves the optimization profile for a detected game.  A window-class match
 * reports a friendly name, so a profile keyed by either the real image name or
 * the friendly one is accepted; the image name wins when both exist.
 */
export function resolveGameProfile<T>(
  gameProfiles: Record<string, { enabledOptimizations: T[] }> | undefined,
  processName: string,
  displayName?: string | null,
): { enabledOptimizations: T[] } | undefined {
  if (!gameProfiles) return undefined
  return gameProfiles[processName] ?? (displayName ? gameProfiles[displayName] : undefined)
}

/**
 * Process names seen on the previous poll.  The window probe costs ~1.9s, so it
 * only runs when something actually appeared since the last poll; this set is
 * replaced each poll, which is what lets a re-launched game be probed again.
 */
let seenProcesses = new Set<string>()

/** Aborts the in-flight window probe, so stopping the detector does not leave a
 *  ~1.9s PowerShell child running. */
let probeAbort: AbortController | null = null

async function probeGame(running: Set<string>): Promise<GameMatch | null> {
  const controller = new AbortController()
  probeAbort = controller
  try {
    const windows = await getVisibleWindows(controller.signal)
    return findGameWithDisplay(running, [], windows, windowClassLookup)
  } finally {
    if (probeAbort === controller) probeAbort = null
  }
}

async function poll(customGameProcesses: string[]): Promise<void> {
  if (pollRunning || !callbacks) return
  pollRunning = true

  try {
    const running = await getRunningProcessNames()
    const knownByName = findGame(running, customGameProcesses)
    let match: GameMatch | null = knownByName ? { processName: knownByName, displayName: null } : null

    if (!match) {
      // Only pay for the probe when a process appeared since the last poll.
      let hasNewProcess = false
      for (const proc of running) {
        if (!seenProcesses.has(proc)) {
          hasNewProcess = true
          break
        }
      }
      if (hasNewProcess) match = await probeGame(running)
    }
    seenProcesses = running

    const game = match?.processName ?? null

    if (game && !detectedGame) {
      // Game just appeared
      if (game === suppressedGame) return // user manually deactivated this session
      detectedGame = game
      detectedDisplayName = match?.displayName ?? null
      suppressedGame = null
      try {
        // Only pass a display name when the class lookup actually supplied
        // one, so process-name matches keep the original single-argument
        // callback contract.
        if (detectedDisplayName) {
          await callbacks.onGameDetected(game, detectedDisplayName)
        } else {
          await callbacks.onGameDetected(game)
        }
      } catch {
        /* logged by caller */
      }
    } else if (!game && detectedGame) {
      // Game just exited
      detectedGame = null
      detectedDisplayName = null
      suppressedGame = null
      try {
        await callbacks.onGameExited()
      } catch {
        /* logged by caller */
      }
    } else if (!game && !detectedGame && suppressedGame) {
      // Suppressed game has exited — clear so a future launch can trigger again
      suppressedGame = null
    }
  } finally {
    pollRunning = false
  }
}

// ── Public API ─────────────────────────────────────────────────

export function startGameDetector(cbs: GameDetectorCallbacks, customGameProcesses: string[]): void {
  // Preserve suppression across restarts so a settings change during a
  // suppressed session doesn't re-activate the still-running game.
  const prevSuppressed = suppressedGame
  stopGameDetector()
  callbacks = cbs
  detectedGame = null
  detectedDisplayName = null
  suppressedGame = prevSuppressed
  pollTimer = setInterval(() => poll(customGameProcesses), 30_000)
  poll(customGameProcesses)
}

export function stopGameDetector(): void {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  callbacks = null
  detectedGame = null
  detectedDisplayName = null
  suppressedGame = null
  seenProcesses = new Set()
  probeAbort?.abort()
  probeAbort = null
  pollRunning = false
}

/** Call when the user manually deactivates Game Mode while auto-detect is on.
 *  Prevents re-activation until the current game exits. */
export function suppressCurrentGame(): void {
  if (detectedGame) {
    suppressedGame = detectedGame
    detectedGame = null
    detectedDisplayName = null
  }
}

/** Returns the name of the currently detected game, or null. */
export function getDetectedGame(): string | null {
  return detectedGame
}

export function isDetectorRunning(): boolean {
  return pollTimer !== null
}
