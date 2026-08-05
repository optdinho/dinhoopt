import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * Result of a web favicon fetch. `bytes` is the raw body; the module validates
 * content-type, size and non-emptiness before treating it as a usable icon.
 */
export interface WebIconFetchResult {
  ok: boolean
  status: number
  contentType: string
  bytes: Uint8Array
}

export type WebIconFetcher = (url: string) => Promise<WebIconFetchResult | null>

const MAX_ICON_BYTES = 512 * 1024

/**
 * Primary domain per allowlisted winget id. Used to build the favicon URL for
 * apps that are NOT installed (no local executable to extract an icon from).
 */
export const APP_ICON_DOMAINS: Record<string, string> = {
  // Browsers
  'Mozilla.Firefox': 'firefox.com',
  'Google.Chrome': 'google.com',
  'Brave.Brave': 'brave.com',
  'Opera.Opera': 'opera.com',
  'Vivaldi.Vivaldi': 'vivaldi.com',
  'TorProject.TorBrowser': 'torproject.org',
  // Communication
  'Discord.Discord': 'discord.com',
  'SlackTechnologies.Slack': 'slack.com',
  'Zoom.Zoom': 'zoom.us',
  'Microsoft.Teams': 'microsoft.com',
  'WhatsApp.WhatsApp': 'whatsapp.com',
  'Telegram.TelegramDesktop': 'telegram.org',
  'OpenWhisperSystems.Signal': 'signal.org',
  'Microsoft.Skype': 'skype.com',
  // Media
  'VideoLAN.VLC': 'videolan.org',
  'Spotify.Spotify': 'spotify.com',
  'OBSProject.OBSStudio': 'obsproject.com',
  'Audacity.Audacity': 'audacityteam.org',
  'GIMP.GIMP': 'gimp.org',
  'KDE.Krita': 'krita.org',
  'HandBrake.HandBrake': 'handbrake.fr',
  'Kodi.Kodi': 'kodi.tv',
  'foobar2000.foobar2000': 'foobar2000.org',
  // Productivity
  'Notion.Notion': 'notion.so',
  'Obsidian.Obsidian': 'obsidian.md',
  'TheDocumentFoundation.LibreOffice': 'libreoffice.org',
  'ONLYOFFICE.DesktopEditors': 'onlyoffice.com',
  'SumatraPDF.SumatraPDF': 'sumatrapdfreader.org',
  'Foxit.FoxitReader': 'foxit.com',
  'Calibre.Calibre': 'calibre-ebook.com',
  'AgileBits.1Password': '1password.com',
  'Bitwarden.Bitwarden': 'bitwarden.com',
  'NordVPN.NordVPN': 'nordvpn.com',
  'ProtonVPN.ProtonVPN': 'protonvpn.com',
  'Zotero.Zotero': 'zotero.org',
  // Development
  'Microsoft.VisualStudioCode': 'code.visualstudio.com',
  'Git.Git': 'git-scm.com',
  'OpenJS.NodeJS.LTS': 'nodejs.org',
  'Python.Python.3.12': 'python.org',
  'Docker.DockerDesktop': 'docker.com',
  'Postman.Postman': 'postman.com',
  'JetBrains.Toolbox': 'jetbrains.com',
  'PuTTY.PuTTY': 'putty.org',
  'FileZilla.FileZilla': 'filezilla-project.org',
  'GitHub.GitHubDesktop': 'github.com',
  'Notepad++.Notepad++': 'notepad-plus-plus.org',
  'Microsoft.PowerShell': 'microsoft.com',
  'Microsoft.WindowsTerminal': 'microsoft.com',
  'Oracle.JDK.21': 'oracle.com',
  'GoLang.Go': 'golang.org',
  'Rustlang.Rustup': 'rust-lang.org',
  // System
  'Microsoft.PowerToys': 'microsoft.com',
  'voidtools.Everything': 'voidtools.com',
  'Microsoft.Sysinternals.ProcessExplorer': 'microsoft.com',
  'Microsoft.Sysinternals.Autoruns': 'microsoft.com',
  'Microsoft.Sysinternals.ProcessMonitor': 'microsoft.com',
  'WinDirStat.WinDirStat': 'windirstat.net',
  'RealVNC.VNCViewer': 'realvnc.com',
  'TeamViewer.TeamViewer': 'teamviewer.com',
  // Gaming
  'Valve.Steam': 'steampowered.com',
  'EpicGames.EpicGamesLauncher': 'epicgames.com',
  'Blizzard.BattleNet': 'blizzard.com',
  'GOG.Galaxy': 'gog.com',
  'Ubisoft.Connect': 'ubisoft.com',
  'EAApp.ElectronicsArts': 'ea.com',
  'RiotGames.Valorant': 'riotgames.com',
  // Utilities
  '7zip.7zip': '7-zip.org',
  'RARLab.WinRAR': 'rarlab.com',
  'ShareX.ShareX': 'getsharex.com',
  'Greenshot.Greenshot': 'getgreenshot.org',
  'Rufus.Rufus': 'rufus.ie',
  'balenaEtcher.Etcher': 'balena.io',
  'KeePassXCTeam.KeePassXC': 'keepassxc.org',
  'WinMerge.WinMerge': 'winmerge.org',
  'AutoHotkey.AutoHotkey': 'autohotkey.com',
  'WizTree.WizTree': 'wiztreefree.com',
  'qBittorrent.qBittorrent': 'qbittorrent.org',
  'Transmission.Transmission': 'transmissionbt.com',
}

const GOOGLE_FAVICON_URL = (domain: string): string =>
  `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`
const CLEARBIT_LOGO_URL = (domain: string): string => `https://logo.clearbit.com/${encodeURIComponent(domain)}`

async function defaultFetcher(url: string): Promise<WebIconFetchResult | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000), redirect: 'follow' })
    const contentType = res.headers.get('content-type') ?? ''
    const bytes = new Uint8Array(await res.arrayBuffer())
    return { ok: res.ok, status: res.status, contentType, bytes }
  } catch {
    return null
  }
}

let webIconFetcher: WebIconFetcher | null = defaultFetcher
let iconsCacheDir: string | null = null

/** Test seam — override or disable (null) the network fetcher. */
export function setWebIconFetcher(fetcher: WebIconFetcher | null): void {
  webIconFetcher = fetcher
}

/** Test seam — override the disk cache directory (defaults to userData/app-icons). */
export function setAppIconsCacheDir(dir: string | null): void {
  iconsCacheDir = dir
}

async function getCacheDir(): Promise<string | null> {
  if (iconsCacheDir) return iconsCacheDir
  try {
    const { app } = await import('electron')
    if (!app?.getPath) return null
    return join(app.getPath('userData'), 'app-icons')
  } catch {
    return null
  }
}

/** Removes all cached icon files so the next resolve refetches from the web. */
export async function clearWebIconCache(): Promise<void> {
  const dir = await getCacheDir()
  if (!dir) return
  try {
    await rm(dir, { recursive: true, force: true })
    await mkdir(dir, { recursive: true })
  } catch {
    // Cache cleanup is best-effort.
  }
}

function toDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${Buffer.from(bytes).toString('base64')}`
}

function isUsableIcon(result: WebIconFetchResult): result is WebIconFetchResult & { ok: true } {
  return (
    result.ok &&
    result.bytes.length > 0 &&
    result.bytes.length <= MAX_ICON_BYTES &&
    result.contentType.toLowerCase().startsWith('image/')
  )
}

/**
 * Resolves a PNG data URL for an app that has no local executable icon. Uses
 * the Google favicon service with Clearbit as fallback, and caches the PNG on
 * disk so repeated listings are served without network I/O. Best-effort: any
 * failure yields `null` (the UI falls back to a letter tile).
 */
export async function resolveWebAppIcon(appId: string): Promise<string | null> {
  if (!webIconFetcher) return null
  const domain = APP_ICON_DOMAINS[appId]
  if (!domain) return null

  const dir = await getCacheDir()
  const cacheFile = dir ? join(dir, `${appId}.png`) : null
  if (cacheFile) {
    try {
      const cached = await readFile(cacheFile)
      if (cached.length > 0 && cached.length <= MAX_ICON_BYTES) return toDataUrl(cached)
    } catch {
      // Missing/corrupt cache file — fall through to a fresh fetch.
    }
  }

  const urls = [GOOGLE_FAVICON_URL(domain), CLEARBIT_LOGO_URL(domain)]
  for (const url of urls) {
    let result: WebIconFetchResult | null = null
    try {
      result = await webIconFetcher(url)
    } catch {
      result = null
    }
    if (result && isUsableIcon(result)) {
      if (cacheFile) {
        try {
          await mkdir(dir!, { recursive: true })
          await writeFile(cacheFile, Buffer.from(result.bytes))
        } catch {
          // Cache write failure is not fatal.
        }
      }
      return toDataUrl(result.bytes)
    }
  }

  return null
}
