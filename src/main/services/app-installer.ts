import type {
  AppInstallerApp,
  AppInstallerCategory,
  AppInstallerListResult,
  AppInstallProgress,
  AppInstallResult,
} from '@shared/types'
import { isAdmin } from './elevation'
import { execFileAsync, psUtf8 } from './exec-utf8'
import { isWingetAvailable, parseWingetListOutput } from './software-updater/checkers/winget'
import { cleanOutput } from './software-updater/utils'

interface AppInstallerEntry {
  id: string
  name: string
  category: AppInstallerCategory
  description?: string
}

/**
 * Curated allowlist of well-known winget package IDs.
 * Only entries listed here can be installed — the renderer can never pass an
 * arbitrary winget ID to install (prevents supply-chain / script injection).
 */
export const APP_INSTALLER_ENTRIES: AppInstallerEntry[] = [
  // Browsers
  {
    id: 'Mozilla.Firefox',
    name: 'Mozilla Firefox',
    category: 'browser',
    description: 'Navegador de código aberto e focado em privacidade',
  },
  {
    id: 'Google.Chrome',
    name: 'Google Chrome',
    category: 'browser',
    description: 'Navegador rápido e integrado aos serviços Google',
  },
  {
    id: 'Brave.Brave',
    name: 'Brave Browser',
    category: 'browser',
    description: 'Navegador com bloqueio de anúncios integrado',
  },
  { id: 'Opera.Opera', name: 'Opera', category: 'browser', description: 'Navegador com VPN e bloqueador integrados' },
  { id: 'Vivaldi.Vivaldi', name: 'Vivaldi', category: 'browser', description: 'Navegador altamente personalizável' },
  {
    id: 'TorProject.TorBrowser',
    name: 'Tor Browser',
    category: 'browser',
    description: 'Navegador anónimo baseado na rede Tor',
  },

  // Communication
  {
    id: 'Discord.Discord',
    name: 'Discord',
    category: 'communication',
    description: 'Chat de voz e texto para comunidades',
  },
  { id: 'SlackTechnologies.Slack', name: 'Slack', category: 'communication', description: 'Comunicação para equipas' },
  { id: 'Zoom.Zoom', name: 'Zoom', category: 'communication', description: 'Videoconferência e reuniões online' },
  {
    id: 'Microsoft.Teams',
    name: 'Microsoft Teams',
    category: 'communication',
    description: 'Colaboração e reuniões da Microsoft',
  },
  { id: 'WhatsApp.WhatsApp', name: 'WhatsApp Desktop', category: 'communication', description: 'Mensagens e chamadas' },
  {
    id: 'Telegram.TelegramDesktop',
    name: 'Telegram Desktop',
    category: 'communication',
    description: 'Mensageiro multiplataforma',
  },
  {
    id: 'OpenWhisperSystems.Signal',
    name: 'Signal',
    category: 'communication',
    description: 'Mensagens encriptadas de ponta a ponta',
  },
  { id: 'Microsoft.Skype', name: 'Skype', category: 'communication', description: 'Chamadas e mensagens' },

  // Media
  { id: 'VideoLAN.VLC', name: 'VLC Media Player', category: 'media', description: 'Reprodutor multimédia universal' },
  { id: 'Spotify.Spotify', name: 'Spotify', category: 'media', description: 'Streaming de música' },
  { id: 'OBSProject.OBSStudio', name: 'OBS Studio', category: 'media', description: 'Gravação e transmissão de ecrã' },
  { id: 'Audacity.Audacity', name: 'Audacity', category: 'media', description: 'Editor de áudio de código aberto' },
  { id: 'GIMP.GIMP', name: 'GIMP', category: 'media', description: 'Editor de imagens de código aberto' },
  { id: 'KDE.Krita', name: 'Krita', category: 'media', description: 'Pintura digital e ilustração' },
  {
    id: 'HandBrake.HandBrake',
    name: 'HandBrake',
    category: 'media',
    description: 'Conversão e transcodificação de vídeo',
  },
  { id: 'Kodi.Kodi', name: 'Kodi', category: 'media', description: 'Centro multimédia para casa' },
  { id: 'foobar2000.foobar2000', name: 'foobar2000', category: 'media', description: 'Reprodutor de áudio avançado' },

  // Productivity
  { id: 'Notion.Notion', name: 'Notion', category: 'productivity', description: 'Notas, wikis e gestão de projetos' },
  {
    id: 'Obsidian.Obsidian',
    name: 'Obsidian',
    category: 'productivity',
    description: 'Notas em Markdown com ligações',
  },
  {
    id: 'TheDocumentFoundation.LibreOffice',
    name: 'LibreOffice',
    category: 'productivity',
    description: 'Suite de escritório de código aberto',
  },
  {
    id: 'ONLYOFFICE.DesktopEditors',
    name: 'ONLYOFFICE Desktop Editors',
    category: 'productivity',
    description: 'Editores de documentos, folhas e slides',
  },
  { id: 'SumatraPDF.SumatraPDF', name: 'SumatraPDF', category: 'productivity', description: 'Leitor leve de PDF' },
  {
    id: 'Foxit.FoxitReader',
    name: 'Foxit PDF Reader',
    category: 'productivity',
    description: 'Leitor e editor de PDF',
  },
  { id: 'Calibre.Calibre', name: 'Calibre', category: 'productivity', description: 'Gestor de livros eletrónicos' },
  { id: 'AgileBits.1Password', name: '1Password', category: 'productivity', description: 'Gestor de palavras-passe' },
  {
    id: 'Bitwarden.Bitwarden',
    name: 'Bitwarden',
    category: 'productivity',
    description: 'Gestor de palavras-passe de código aberto',
  },
  { id: 'NordVPN.NordVPN', name: 'NordVPN', category: 'productivity', description: 'VPN com milhares de servidores' },
  { id: 'ProtonVPN.ProtonVPN', name: 'Proton VPN', category: 'productivity', description: 'VPN focada em privacidade' },
  { id: 'Zotero.Zotero', name: 'Zotero', category: 'productivity', description: 'Gestor de referências e citações' },

  // Development
  {
    id: 'Microsoft.VisualStudioCode',
    name: 'Visual Studio Code',
    category: 'development',
    description: 'Editor de código da Microsoft',
  },
  { id: 'Git.Git', name: 'Git', category: 'development', description: 'Sistema de controlo de versões' },
  {
    id: 'OpenJS.NodeJS.LTS',
    name: 'Node.js LTS',
    category: 'development',
    description: 'Runtime JavaScript para servidor',
  },
  {
    id: 'Python.Python.3.12',
    name: 'Python 3.12',
    category: 'development',
    description: 'Linguagem de programação Python',
  },
  {
    id: 'Docker.DockerDesktop',
    name: 'Docker Desktop',
    category: 'development',
    description: 'Contentores e desenvolvimento de aplicações',
  },
  { id: 'Postman.Postman', name: 'Postman', category: 'development', description: 'Teste de APIs e coleções' },
  {
    id: 'JetBrains.Toolbox',
    name: 'JetBrains Toolbox',
    category: 'development',
    description: 'Gestor dos IDEs JetBrains',
  },
  { id: 'PuTTY.PuTTY', name: 'PuTTY', category: 'development', description: 'Cliente SSH e Telnet' },
  { id: 'FileZilla.FileZilla', name: 'FileZilla', category: 'development', description: 'Cliente FTP/SFTP' },
  {
    id: 'GitHub.GitHubDesktop',
    name: 'GitHub Desktop',
    category: 'development',
    description: 'Cliente Git gráfico da GitHub',
  },
  { id: 'Notepad++.Notepad++', name: 'Notepad++', category: 'development', description: 'Editor de texto e código' },
  {
    id: 'Microsoft.PowerShell',
    name: 'PowerShell 7',
    category: 'development',
    description: 'Shell e linguagem de scripting da Microsoft',
  },
  {
    id: 'Microsoft.WindowsTerminal',
    name: 'Windows Terminal',
    category: 'development',
    description: 'Terminal moderno do Windows',
  },
  { id: 'Oracle.JDK.21', name: 'Java JDK 21', category: 'development', description: 'Kit de desenvolvimento Java' },
  { id: 'GoLang.Go', name: 'Go', category: 'development', description: 'Linguagem de programação Go' },
  { id: 'Rustlang.Rustup', name: 'Rust (rustup)', category: 'development', description: 'Toolchain da linguagem Rust' },

  // System
  {
    id: 'Microsoft.PowerToys',
    name: 'PowerToys',
    category: 'system',
    description: 'Ferramentas de produtividade do Windows',
  },
  {
    id: 'voidtools.Everything',
    name: 'Everything',
    category: 'system',
    description: 'Pesquisa instantânea de ficheiros',
  },
  {
    id: 'Microsoft.Sysinternals.ProcessExplorer',
    name: 'Process Explorer',
    category: 'system',
    description: 'Gestor de processos avançado (Sysinternals)',
  },
  {
    id: 'Microsoft.Sysinternals.Autoruns',
    name: 'Autoruns',
    category: 'system',
    description: 'Gestão de programas de arranque (Sysinternals)',
  },
  {
    id: 'Microsoft.Sysinternals.ProcessMonitor',
    name: 'Process Monitor',
    category: 'system',
    description: 'Monitorização avançada do sistema (Sysinternals)',
  },
  {
    id: 'WinDirStat.WinDirStat',
    name: 'WinDirStat',
    category: 'system',
    description: 'Análise visual do uso de disco',
  },
  { id: 'RealVNC.VNCViewer', name: 'RealVNC Viewer', category: 'system', description: 'Acesso remoto ao ecrã' },
  { id: 'TeamViewer.TeamViewer', name: 'TeamViewer', category: 'system', description: 'Acesso e suporte remoto' },

  // Gaming
  { id: 'Valve.Steam', name: 'Steam', category: 'gaming', description: 'Plataforma de jogos da Valve' },
  {
    id: 'EpicGames.EpicGamesLauncher',
    name: 'Epic Games Launcher',
    category: 'gaming',
    description: 'Plataforma de jogos da Epic',
  },
  { id: 'Blizzard.BattleNet', name: 'Battle.net', category: 'gaming', description: 'Plataforma de jogos da Blizzard' },
  { id: 'GOG.Galaxy', name: 'GOG Galaxy', category: 'gaming', description: 'Plataforma de jogos da GOG' },
  { id: 'Ubisoft.Connect', name: 'Ubisoft Connect', category: 'gaming', description: 'Plataforma de jogos da Ubisoft' },
  {
    id: 'EAApp.ElectronicsArts',
    name: 'EA app',
    category: 'gaming',
    description: 'Plataforma de jogos da Electronic Arts',
  },
  { id: 'RiotGames.Valorant', name: 'Valorant', category: 'gaming', description: 'Jogo de tiro da Riot Games' },

  // Utilities
  { id: '7zip.7zip', name: '7-Zip', category: 'utilities', description: 'Compactador de ficheiros de código aberto' },
  { id: 'RARLab.WinRAR', name: 'WinRAR', category: 'utilities', description: 'Compactador de ficheiros' },
  { id: 'ShareX.ShareX', name: 'ShareX', category: 'utilities', description: 'Captura de ecrã e partilha' },
  { id: 'Greenshot.Greenshot', name: 'Greenshot', category: 'utilities', description: 'Captura de ecrã leve' },
  { id: 'Rufus.Rufus', name: 'Rufus', category: 'utilities', description: 'Criação de pen drives de arranque' },
  {
    id: 'balenaEtcher.Etcher',
    name: 'balenaEtcher',
    category: 'utilities',
    description: 'Gravação de imagens em cartões e pendrives',
  },
  {
    id: 'KeePassXCTeam.KeePassXC',
    name: 'KeePassXC',
    category: 'utilities',
    description: 'Gestor de palavras-passe local',
  },
  { id: 'WinMerge.WinMerge', name: 'WinMerge', category: 'utilities', description: 'Comparação e fusão de ficheiros' },
  {
    id: 'AutoHotkey.AutoHotkey',
    name: 'AutoHotkey',
    category: 'utilities',
    description: 'Automação de teclado e mouse',
  },
  {
    id: 'WizTree.WizTree',
    name: 'WizTree',
    category: 'utilities',
    description: 'Análise de uso de disco ultrarrápida',
  },
  {
    id: 'qBittorrent.qBittorrent',
    name: 'qBittorrent',
    category: 'utilities',
    description: 'Cliente BitTorrent de código aberto',
  },
  {
    id: 'Transmission.Transmission',
    name: 'Transmission',
    category: 'utilities',
    description: 'Cliente BitTorrent leve',
  },
]

const INSTALL_ARGS = [
  '--accept-source-agreements',
  '--accept-package-agreements',
  '--disable-interactivity',
  '--silent',
  '--include-unknown',
]

const INSTALL_SUCCESS_PATTERNS = ['successfully installed', 'installer succeeded']
const INSTALL_FAILURE_PATTERNS = ['installer failed', 'no package found', 'no applicable', 'installer aborted']

const INSTALL_ELEVATION_HINTS = [
  'access is denied',
  'administrator',
  'elevation',
  'requires admin',
  'run as admin',
  '0x80070005',
  '0x80070422',
  'negado',
  'permiss',
  'acesso',
]

export function isValidAppInstallerId(id: string): boolean {
  return /^[\w][\w.-]{0,200}$/.test(id)
}

export function isAllowlisted(id: string): boolean {
  return APP_INSTALLER_ENTRIES.some((entry) => entry.id.toLowerCase() === id.toLowerCase())
}

export function findAllowlistEntry(id: string): AppInstallerEntry | undefined {
  return APP_INSTALLER_ENTRIES.find((entry) => entry.id.toLowerCase() === id.toLowerCase())
}

export function resolveAppId(id: string): string | null {
  if (!isValidAppInstallerId(id)) return null
  const entry = findAllowlistEntry(id)
  if (!entry) return null
  return entry.id
}

export async function listAvailableApps(): Promise<AppInstallerListResult> {
  const wingetAvailable = await isWingetAvailable()
  const apps: AppInstallerApp[] = APP_INSTALLER_ENTRIES.map((entry) => ({
    id: entry.id,
    name: entry.name,
    category: entry.category,
    ...(entry.description !== undefined ? { description: entry.description } : {}),
    isInstalled: false,
  }))

  if (!wingetAvailable) {
    return { apps, wingetAvailable: false }
  }

  try {
    const { stdout } = await execFileAsync(
      'winget',
      ['list', '--accept-source-agreements', '--disable-interactivity'],
      { timeout: 30_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    const installed = parseWingetListOutput(String(stdout))
    const installedById = new Map(installed.map((a) => [a.id.toLowerCase(), a]))
    for (const app of apps) {
      const found = installedById.get(app.id.toLowerCase())
      if (found) {
        app.isInstalled = true
        app.installedVersion = found.currentVersion
      }
    }
  } catch {
    // Detection is best-effort — apps simply show as not installed.
  }

  return { apps, wingetAvailable: true }
}

let installCancelled = false

export function cancelAppInstall(): void {
  installCancelled = true
}

export function resetAppInstallCancel(): void {
  installCancelled = false
}

async function attemptInstall(appId: string): Promise<{ success: boolean; output: string }> {
  let stdout = ''
  let exitCode = 0
  try {
    const result = await execFileAsync('winget', ['install', appId, ...INSTALL_ARGS], {
      timeout: 10 * 60 * 1000,
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
    })
    stdout = String(result.stdout)
    exitCode = 0
  } catch (err: unknown) {
    const e = err as { stdout?: string | Buffer; message?: string; code?: string }
    if (e?.stdout) {
      stdout = String(e.stdout)
    } else {
      return { success: false, output: e?.message || 'Unknown error' }
    }
    exitCode = Number(e?.code ?? -1)
  }

  const output = cleanOutput(stdout).toLowerCase()
  if (exitCode === 0) {
    if (INSTALL_FAILURE_PATTERNS.some((p) => output.includes(p))) {
      return { success: false, output: stdout }
    }
    return { success: true, output: stdout }
  }
  if (exitCode === 1 && INSTALL_SUCCESS_PATTERNS.some((p) => output.includes(p))) {
    return { success: true, output: stdout }
  }
  return { success: false, output: stdout }
}

async function attemptElevatedInstall(appId: string): Promise<{ success: boolean; output: string }> {
  try {
    const args = ['install', appId, ...INSTALL_ARGS].join(' ')
    const safeArgs = args.replace(/'/g, "''")
    const result = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        psUtf8(
          `$p = Start-Process winget -ArgumentList '${safeArgs}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode`,
        ),
      ],
      { timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024, windowsHide: true },
    )
    return { success: true, output: String(result.stdout) }
  } catch (err: unknown) {
    const e = err as { message?: string }
    return { success: false, output: e?.message || 'Elevated install failed' }
  }
}

/**
 * Install apps serially. Each app is validated against the allowlist before any
 * command is spawned. Progress is reported via onProgress.
 */
export async function installApps(
  appIds: string[],
  onProgress: (progress: AppInstallProgress) => void,
): Promise<AppInstallResult> {
  installCancelled = false
  let succeeded = 0
  let failed = 0
  let completed = 0
  const errors: AppInstallResult['errors'] = []
  const alreadyAdmin = isAdmin()

  const safeIds = appIds
    .filter((id) => typeof id === 'string')
    .map(resolveAppId)
    .filter((id): id is string => id !== null)
  const total = safeIds.length

  for (const appId of safeIds) {
    if (installCancelled) break
    const entry = findAllowlistEntry(appId)
    const displayName = entry?.name ?? appId

    onProgress({
      phase: 'installing',
      current: completed + 1,
      total,
      currentApp: appId,
      percent: total === 0 ? 100 : Math.round((completed / total) * 100),
      status: 'in-progress',
    })

    let result = await attemptInstall(appId)
    if (!result.success && !alreadyAdmin) {
      const lowerOutput = cleanOutput(result.output).toLowerCase()
      if (INSTALL_ELEVATION_HINTS.some((h) => lowerOutput.includes(h))) {
        result = await attemptElevatedInstall(appId)
      }
    }

    completed++
    if (result.success) {
      succeeded++
      onProgress({
        phase: 'done',
        current: completed,
        total,
        currentApp: appId,
        percent: total === 0 ? 100 : Math.round((completed / total) * 100),
        status: 'done',
      })
    } else {
      failed++
      const lastLine = cleanOutput(result.output).trim().split('\n').pop() || 'Install failed'
      const reason = lastLine.length > 200 ? `${lastLine.slice(0, 200)}...` : lastLine
      errors.push({ appId, name: displayName, reason })
      onProgress({
        phase: 'failed',
        current: completed,
        total,
        currentApp: appId,
        percent: total === 0 ? 100 : Math.round((completed / total) * 100),
        status: 'failed',
        error: reason,
      })
    }
  }

  return { succeeded, failed, errors }
}
