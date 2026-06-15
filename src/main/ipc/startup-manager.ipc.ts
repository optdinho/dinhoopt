import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { IPC } from '@shared/channels'
import type { StartupBootEntry, StartupBootTrace, StartupItem } from '@shared/types'
import { app, ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { execFileAsync, execNativeUtf8, psArgs } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'

interface DisabledEntry {
  name: string
  command: string
  location: string
  source: StartupItem['source']
}

function getDisabledFilePath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'Kudu-Dev')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'disabled-startups.json')
}

function readDisabledEntries(): DisabledEntry[] {
  try {
    const filePath = getDisabledFilePath()
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    }
  } catch {
    /* corrupt file, return empty */
  }
  return []
}

function writeDisabledEntries(entries: DisabledEntry[]): void {
  writeFileSync(getDisabledFilePath(), JSON.stringify(entries, null, 2), 'utf-8')
}

// Mutex to serialize disabled-startups.json read/mutate/write operations
let disabledFileLock: Promise<void> = Promise.resolve()
function withDisabledFileLock<T>(fn: () => T): Promise<T> {
  const prev = disabledFileLock
  let resolve: () => void
  disabledFileLock = new Promise<void>((r) => {
    resolve = r
  })
  return prev.then(fn).finally(() => resolve!())
}

function makeStableId(name: string, source: string): string {
  return createHash('sha256').update(`${name}::${source}`).digest('hex').slice(0, 16)
}

// Extract a user-friendly display name from the raw registry value name and command
function deriveDisplayName(registryName: string, command: string): string {
  // Extract exe path — handle both quoted and unquoted paths (including those with spaces ending in .exe)
  const quotedMatch = command.match(/^"([^"]+)"/)
  const exePathMatch = quotedMatch
    ? quotedMatch[1]
    : command.match(/^(.+?\.exe)\b/i)?.[1] || command.match(/^(\S+)/)?.[1] || ''
  const exePath = (exePathMatch ?? '').replace(/\\/g, '/')
  const exeName = basename(exePath, extname(exePath))

  // electron.app.X pattern -> "X"
  const electronMatch = registryName.match(/^electron\.app\.(.+)$/i)
  if (electronMatch) return electronMatch[1] ?? registryName

  // Names with long hex suffixes (auto-generated) -> derive from prefix or exe
  const hexSuffixMatch = registryName.match(/^(.+?)[_-][A-F0-9]{8,}$/i)
  if (hexSuffixMatch) {
    const prefix = (hexSuffixMatch[1] ?? '').replace(/[-_]/g, ' ')
    if (prefix.length > 20 && exeName) return friendlyExeName(exeName)
    return prefix
  }

  // If the registry name already looks readable, use it.
  // Allow Unicode letters (\p{L}) so accented names like "Système" or "Données" are kept.
  if (registryName.includes(' ') || (registryName.length <= 30 && /^[\p{L}\p{N} ._-]+$/u.test(registryName))) {
    return registryName
  }

  // Fallback to exe name
  if (exeName) return friendlyExeName(exeName)

  return registryName
}

function friendlyExeName(name: string): string {
  const knownExes: Record<string, string> = {
    msedge: 'Microsoft Edge',
    chrome: 'Google Chrome',
    firefox: 'Mozilla Firefox',
    steam: 'Steam',
    discord: 'Discord',
    spotify: 'Spotify',
    teams: 'Microsoft Teams',
    'ms-teams': 'Microsoft Teams',
    slack: 'Slack',
    notion: 'Notion',
    onedrive: 'OneDrive',
    googledrivefs: 'Google Drive',
    protondrive: 'Proton Drive',
    lghub_system_tray: 'Logitech G HUB',
    'docker desktop': 'Docker Desktop',
  }

  const lc = name.toLowerCase()
  if (knownExes[lc]) return knownExes[lc]

  return name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function stripComment(cmd: string): string {
  let inQuotes = false
  for (let i = 0; i < cmd.length; i++) {
    if (cmd[i] === '"') inQuotes = !inQuotes
    if (!inQuotes && cmd[i] === ';') {
      return cmd.substring(0, i).trimEnd()
    }
  }
  return cmd
}

function parseRegOutput(stdout: string, location: string, source: StartupItem['source']): StartupItem[] {
  const items: StartupItem[] = []
  const lines = stdout.split('\n')
  for (const line of lines) {
    const match = line.match(/^\s+(.+?)\s{4,}REG_SZ\s{4,}(.+)/i)
    if (match) {
      const name = (match[1] ?? '').trim()
      const command = stripComment((match[2] ?? '').trim())
      items.push({
        id: makeStableId(name, source),
        name,
        displayName: deriveDisplayName(name, command),
        command,
        location,
        source,
        enabled: true,
        publisher: extractPublisher(command),
        impact: estimateImpact(name, command),
      })
    }
  }
  return items
}

function getStartupFolderItems(): StartupItem[] {
  const items: StartupItem[] = []
  const startupDir = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')

  try {
    if (!existsSync(startupDir)) return items
    const files = readdirSync(startupDir)
    for (const file of files) {
      if (file === 'desktop.ini') continue
      const filePath = join(startupDir, file)
      const name = basename(file, extname(file))
      items.push({
        id: makeStableId(name, 'startup-folder'),
        name: file,
        displayName: name,
        command: filePath,
        location: startupDir,
        source: 'startup-folder',
        enabled: true,
        publisher: extractPublisher(filePath),
        impact: estimateImpact(name, filePath),
      })
    }
  } catch {
    /* skip */
  }

  return items
}

/**
 * Parse the StartupApproved\Run registry keys to detect items that were
 * disabled via Task Manager. These items have a REG_BINARY value where the
 * first byte indicates status: 02 = enabled, 03 = disabled by user,
 * 06 = disabled by OS/policy.
 */
async function mergeStartupApproved(items: StartupItem[]): Promise<void> {
  const approvedKeys = [
    {
      key: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
      source: 'registry-hkcu' as const,
    },
    {
      key: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\StartupFolder',
      source: 'startup-folder' as const,
    },
    {
      key: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run',
      source: 'registry-hklm' as const,
    },
  ]

  for (const { key, source: _source } of approvedKeys) {
    try {
      const { stdout } = await execNativeUtf8('reg', ['query', key], { timeout: 10000 })
      const lines = stdout.split('\n')
      for (const line of lines) {
        const match = line.match(/^\s+(.+?)\s{4,}REG_BINARY\s{4,}(\S+)/i)
        if (!match) continue
        const name = (match[1] ?? '').trim()
        const hexData = (match[2] ?? '').trim()
        // First byte: 02=enabled, 03=disabled by user, 06=disabled by policy
        const firstByte = Number.parseInt(hexData.substring(0, 2), 16)
        const isDisabledByUser = firstByte === 0x03 || firstByte === 0x06

        if (isDisabledByUser) {
          const existing = items.find((i) => i.name === name)
          if (existing) {
            existing.enabled = false
          }
          // Items disabled via Task Manager are removed from the Run key
          // but stay in StartupApproved — we don't add them as standalone
          // entries here since we can't recover their command path reliably
        }
      }
    } catch {
      /* key may not exist */
    }
  }
}

/**
 * Query Task Scheduler for logon-triggered tasks that represent user-facing
 * startup apps (e.g. Spotify, Zoom). Filters out OS/system tasks.
 */
async function getScheduledLogonTasks(): Promise<StartupItem[]> {
  const items: StartupItem[] = []

  try {
    const script = `
      Get-ScheduledTask | ForEach-Object {
        $task = $_
        $hasLogon = $false
        foreach ($t in $task.Triggers) {
          if ($t.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger') {
            $hasLogon = $true; break
          }
        }
        if ($hasLogon -and $task.TaskName -ne 'DiNhoStartup' -and $task.TaskPath -notmatch '^\\\\Microsoft\\\\' -and $task.TaskPath -notmatch '^\\\\ASUS\\\\') {
          $action = ($task.Actions | Where-Object { $_.CimClass.CimClassName -eq 'MSFT_TaskExecAction' } | Select-Object -First 1)
          if ($action) {
            $exe = $action.Execute
            $args = $action.Arguments
            $cmd = if ($args) { "$exe $args" } else { $exe }
            Write-Output "TASK|$($task.TaskName)|$cmd|$($task.State)"
          }
        }
      }
    `

    const { stdout } = await execFileAsync('powershell', psArgs(script), { timeout: 15000, windowsHide: true })

    const lines = stdout
      .trim()
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)
    for (const line of lines) {
      const parts = line.split('|')
      if (parts[0] !== 'TASK' || parts.length < 4) continue
      const name = parts[1] ?? ''
      const command = parts[2] ?? ''
      const state = parts[3] ?? ''

      items.push({
        id: makeStableId(name, 'task-scheduler'),
        name,
        displayName: deriveDisplayName(name, command),
        command,
        location: 'Task Scheduler',
        source: 'task-scheduler',
        enabled: state === 'Ready' || state === 'Running',
        publisher: extractPublisher(command),
        impact: estimateImpact(name, command),
      })
    }
  } catch {
    /* task scheduler unavailable */
  }

  return items
}

/** Validate that a task name contains only safe characters (letters incl. accented, digits, spaces, dashes, dots, underscores) */
function isSafeTaskName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name.length <= 260 && /^[\p{L}\p{N} \-._()]+$/u.test(name)
}

// Whitelist of allowed registry locations for startup items
const ALLOWED_STARTUP_LOCATIONS = new Set([
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
])

// ── Exported core logic ──

export async function listStartupItems(): Promise<StartupItem[]> {
  // On non-Windows, delegate to platform abstraction
  if (process.platform !== 'win32') {
    return getPlatform().startup.listItems()
  }

  const items: StartupItem[] = []

  // Read HKCU Run
  try {
    const { stdout } = await execNativeUtf8(
      'reg',
      ['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'],
      { timeout: 10000 },
    )
    items.push(...parseRegOutput(stdout, 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', 'registry-hkcu'))
  } catch {
    // Skip
  }

  // Read HKLM Run
  try {
    const { stdout } = await execNativeUtf8(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run'],
      { timeout: 10000 },
    )
    items.push(...parseRegOutput(stdout, 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run', 'registry-hklm'))
  } catch {
    // Skip
  }

  // Read HKLM Wow6432Node Run (32-bit apps on 64-bit Windows)
  try {
    const { stdout } = await execNativeUtf8(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run'],
      { timeout: 10000 },
    )
    items.push(
      ...parseRegOutput(
        stdout,
        'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
        'registry-hklm',
      ),
    )
  } catch {
    // Skip
  }

  // Read Startup folder
  items.push(...getStartupFolderItems())

  // Check StartupApproved\Run — items disabled via Task Manager are removed
  // from Run but kept here with a 03 byte prefix. Merge their enabled state
  // and add any missing items that exist only in the approved list.
  await mergeStartupApproved(items)

  // Read Task Scheduler logon-trigger tasks (user-facing apps like Spotify)
  const scheduledItems = await getScheduledLogonTasks()
  for (const sItem of scheduledItems) {
    if (!items.some((i) => i.name === sItem.name)) {
      items.push(sItem)
    }
  }

  // Merge disabled state: mark items found in disabled file, add missing ones
  const disabled = readDisabledEntries()
  for (const entry of disabled) {
    const existing = items.find((i) => i.name === entry.name && i.source === entry.source)
    if (existing) {
      existing.enabled = false
    } else {
      items.push({
        id: makeStableId(entry.name, entry.source),
        name: entry.name,
        displayName: deriveDisplayName(entry.name, entry.command),
        command: entry.command,
        location: entry.location,
        source: entry.source,
        enabled: false,
        publisher: extractPublisher(entry.command),
        impact: estimateImpact(entry.name, entry.command),
      })
    }
  }

  return items
}

export async function toggleStartupItem(
  name: string,
  location: string,
  command: string,
  source: StartupItem['source'],
  enabled: boolean,
): Promise<boolean> {
  getLogger().info('startup-manager', `${enabled ? 'Enabling' : 'Disabling'} startup item: ${name} (${source})`)
  // On non-Windows, delegate to platform abstraction
  if (process.platform !== 'win32') {
    return getPlatform().startup.toggleItem(name, location, command, source, enabled)
  }

  if (source === 'task-scheduler') {
    if (!isSafeTaskName(name)) return false
    try {
      const action = enabled ? 'Enable-ScheduledTask' : 'Disable-ScheduledTask'
      await execFileAsync('powershell', psArgs(`${action} -TaskName '${name.replace(/'/g, "''")}' -ErrorAction Stop`), {
        timeout: 10000,
        windowsHide: true,
      })
    } catch {
      return false
    }
    return true
  }

  // startup-folder: toggle by renaming the shortcut
  if (source === 'startup-folder') {
    const startupDir = resolve(
      join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup'),
    )
    const resolvedPath = resolve(command)
    if (!resolvedPath.toLowerCase().startsWith(`${startupDir.toLowerCase()}\\`)) {
      return false
    }
    const disabledPath = `${resolvedPath}.disabled`
    try {
      if (enabled) {
        renameSync(disabledPath, resolvedPath)
      } else {
        renameSync(resolvedPath, disabledPath)
      }
      return true
    } catch {
      return false
    }
  }

  // Validate registry location against whitelist
  if (!ALLOWED_STARTUP_LOCATIONS.has(location)) return false

  // Use /reg:64 for HKLM operations so the 64-bit Windows boot process
  // sees the correct StartupApproved markers (critical on 64-bit OS).
  const isHklm = location.startsWith('HKLM\\')
  const regFlags: string[] = isHklm ? ['/reg:64'] : []

  const approvedKey =
    source === 'registry-hkcu'
      ? 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
      : 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
  const approvedRegFlags: string[] = approvedKey.startsWith('HKLM\\') ? ['/reg:64'] : []

  if (!enabled) {
    let approvedOk = false
    let deleteOk = false
    try {
      await execNativeUtf8(
        'reg',
        [
          'add',
          approvedKey,
          '/v',
          name,
          '/t',
          'REG_BINARY',
          '/d',
          '030000000000000000000000',
          '/f',
          ...approvedRegFlags,
        ],
        { timeout: 10000 },
      )
      approvedOk = true
    } catch {
      /* may not exist yet */
    }

    try {
      await execNativeUtf8('reg', ['delete', location, '/v', name, '/f', ...regFlags], { timeout: 10000 })
      deleteOk = true
    } catch {
      /* permissions */
    }

    if (!approvedOk && !deleteOk) return false

    await withDisabledFileLock(() => {
      const disabled = readDisabledEntries()
      if (!disabled.some((e) => e.name === name && e.source === source)) {
        disabled.push({ name, command, location, source })
      }
      writeDisabledEntries(disabled)
    })
  } else {
    const disabled = readDisabledEntries()
    const stored = disabled.find((e) => e.name === name && e.source === source)
    if (!stored) {
      // Item was disabled outside the app (Task Manager, Windows Settings).
      // The Run key entry still exists — just flip StartupApproved marker to 02.
      getLogger().info('startup-manager', `No stored entry for ${name} — enabling via StartupApproved only`)
      try {
        await execNativeUtf8(
          'reg',
          [
            'add',
            approvedKey,
            '/v',
            name,
            '/t',
            'REG_BINARY',
            '/d',
            '020000000000000000000000',
            '/f',
            ...approvedRegFlags,
          ],
          { timeout: 10000 },
        )
        return true
      } catch {
        return false
      }
    }
    const safeCommand = stored.command

    let addOk = false
    try {
      await execNativeUtf8('reg', ['add', location, '/v', name, '/t', 'REG_SZ', '/d', safeCommand, '/f', ...regFlags], {
        timeout: 10000,
      })
      addOk = true
    } catch {
      /* permissions */
    }

    try {
      await execNativeUtf8(
        'reg',
        [
          'add',
          approvedKey,
          '/v',
          name,
          '/t',
          'REG_BINARY',
          '/d',
          '020000000000000000000000',
          '/f',
          ...approvedRegFlags,
        ],
        { timeout: 10000 },
      )
    } catch {
      /* non-critical */
    }

    if (!addOk) return false

    await withDisabledFileLock(() => {
      const current = readDisabledEntries()
      writeDisabledEntries(current.filter((e) => !(e.name === name && e.source === source)))
    })
  }
  getLogger().success('startup-manager', `Toggle complete for: ${name}`)
  return true
}

export async function deleteStartupItem(
  name: string,
  location: string,
  source: StartupItem['source'],
): Promise<boolean> {
  getLogger().info('startup-manager', `Deleting startup item: ${name} (${source})`)
  // On non-Windows, delegate to platform abstraction
  if (process.platform !== 'win32') {
    return getPlatform().startup.deleteItem?.(name, location, source) ?? false
  }

  let deletedSource = false

  try {
    if (source === 'task-scheduler') {
      if (!isSafeTaskName(name)) return false
      await execFileAsync(
        'powershell',
        psArgs(`Unregister-ScheduledTask -TaskName '${name.replace(/'/g, "''")}' -Confirm:$false -ErrorAction Stop`),
        { timeout: 10000, windowsHide: true },
      )
      deletedSource = true
    } else if (source === 'startup-folder') {
      // Validate that the path is actually within the Startup folder to prevent arbitrary file deletion
      const startupDir = join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
      const resolvedLocation = resolve(location)
      const resolvedStartupDir = resolve(startupDir)
      if (!resolvedLocation.toLowerCase().startsWith(`${resolvedStartupDir.toLowerCase()}\\`)) {
        return false
      }
      try {
        unlinkSync(resolvedLocation)
        deletedSource = true
      } catch (err: unknown) {
        // File already gone — treat as success
        const nodeErr = err as { code?: string }
        if (nodeErr.code === 'ENOENT') deletedSource = true
      }
    } else {
      // Registry-based items: validate location against whitelist
      if (!ALLOWED_STARTUP_LOCATIONS.has(location)) return false
      // Delete from Run key and StartupApproved
      try {
        await execNativeUtf8('reg', ['delete', location, '/v', name, '/f'], { timeout: 10000 })
        deletedSource = true
      } catch {
        // Entry may already be deleted (e.g. disabled via toggle) — that's fine
        deletedSource = true
      }
      // Also clean up StartupApproved entry if it exists
      const approvedKey =
        source === 'registry-hkcu'
          ? 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
          : 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
      try {
        await execNativeUtf8('reg', ['delete', approvedKey, '/v', name, '/f'], { timeout: 5000 })
      } catch {
        /* may not exist */
      }
    }
  } catch {
    // Task scheduler unregister failed — real error
    return false
  }

  // Always clean up disabled entries file
  try {
    await withDisabledFileLock(() => {
      const disabled = readDisabledEntries()
      writeDisabledEntries(disabled.filter((e) => !(e.name === name && e.source === source)))
    })
  } catch {
    /* ignore */
  }

  getLogger().info('startup-manager', `Delete ${deletedSource ? 'succeeded' : 'failed'} for: ${name}`)
  return deletedSource
}

export function registerStartupManagerIpc(): void {
  ipcMain.handle(IPC.STARTUP_LIST, () => listStartupItems())

  ipcMain.handle(IPC.STARTUP_BOOT_TRACE, () => getBootTrace())

  ipcMain.handle(
    IPC.STARTUP_TOGGLE,
    async (
      _event,
      name: string,
      location: string,
      command: string,
      source: StartupItem['source'],
      enabled: boolean,
    ) => {
      return toggleStartupItem(name, location, command, source, enabled)
    },
  )

  ipcMain.handle(IPC.STARTUP_DELETE, async (_event, name: string, location: string, source: StartupItem['source']) => {
    return deleteStartupItem(name, location, source)
  })
}

function extractPublisher(command: string | undefined): string {
  if (!command) return 'Unknown'
  const lc = command.toLowerCase()
  if (lc.includes('google')) return 'Google LLC'
  if (
    lc.includes('\\microsoft\\') ||
    lc.includes('microsoft edge') ||
    lc.includes('\\msteams') ||
    lc.includes('onedrive')
  )
    return 'Microsoft Corporation'
  if (lc.includes('discord')) return 'Discord Inc.'
  if (lc.includes('spotify')) return 'Spotify AB'
  if (lc.includes('steam')) return 'Valve Corporation'
  if (lc.includes('nvidia')) return 'NVIDIA Corporation'
  if (lc.includes('amd') || lc.includes('radeon')) return 'AMD'
  if (lc.includes('intel')) return 'Intel Corporation'
  if (lc.includes('mozilla') || lc.includes('firefox')) return 'Mozilla Foundation'
  if (lc.includes('notion')) return 'Notion Labs'
  if (lc.includes('slack')) return 'Salesforce'
  if (lc.includes('zoom')) return 'Zoom Video Communications'
  if (lc.includes('adobe')) return 'Adobe Inc.'
  if (lc.includes('logitech') || lc.includes('lghub')) return 'Logitech'
  if (lc.includes('corsair') || lc.includes('icue')) return 'Corsair'
  if (lc.includes('razer')) return 'Razer Inc.'
  if (lc.includes('docker')) return 'Docker Inc.'
  if (lc.includes('proton')) return 'Proton AG'
  if (lc.includes('dropbox')) return 'Dropbox Inc.'
  if (lc.includes('1password')) return 'AgileBits Inc.'
  if (lc.includes('realtek')) return 'Realtek'
  if (lc.includes('hp') || lc.includes('hewlett')) return 'HP Inc.'
  if (lc.includes('dell')) return 'Dell Technologies'
  if (lc.includes('lenovo')) return 'Lenovo'
  if (lc.includes('asus')) return 'ASUS'
  if (lc.includes('clair')) return 'Clair'
  return 'Unknown'
}

export async function getBootTrace(): Promise<StartupBootTrace> {
  const empty: StartupBootTrace = {
    totalBootMs: 0,
    lastBootDate: null,
    mainPathMs: 0,
    startupAppsMs: 0,
    entries: [],
    available: false,
    needsAdmin: false,
  }

  // On non-Windows, delegate to platform abstraction (or return unavailable)
  if (process.platform !== 'win32') {
    const platformTrace = await getPlatform().startup.getBootTrace?.()
    return platformTrace ?? empty
  }

  try {
    // Query the Diagnostics-Performance event log for boot trace data.
    // This log requires admin or Event Log Readers group membership.
    // The script outputs STATUS|DENIED if access is denied so the UI can
    // show a helpful message instead of "unavailable".
    const bootScript = `
      $log = 'Microsoft-Windows-Diagnostics-Performance/Operational'
      try {
        $boot = Get-WinEvent -LogName $log -FilterXPath '*[System[EventID=100]]' -MaxEvents 1 -ErrorAction Stop
        $xml = [xml]$boot.ToXml()
        $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
        $ns.AddNamespace('e','http://schemas.microsoft.com/win/2004/08/events/event')
        $totalMs = $xml.SelectSingleNode('//e:EventData/e:Data[@Name="BootTime"]', $ns).'#text'
        $mainMs = $xml.SelectSingleNode('//e:EventData/e:Data[@Name="MainPathBootTime"]', $ns).'#text'
        Write-Output "BOOT|$totalMs|$mainMs|$($boot.TimeCreated.ToString('o'))"
      } catch {
        if ($_.Exception -is [System.UnauthorizedAccessException] -or
            ($_.Exception.InnerException -and $_.Exception.InnerException -is [System.UnauthorizedAccessException])) {
          Write-Output 'STATUS|DENIED'
          return
        }
        Write-Output 'BOOT|0|0|'
      }

      try {
        $apps = Get-WinEvent -LogName $log -FilterXPath '*[System[EventID=101 or EventID=102 or EventID=103 or EventID=106 or EventID=109]]' -MaxEvents 50 -ErrorAction Stop
        foreach ($evt in $apps) {
          $xm = [xml]$evt.ToXml()
          $ns2 = New-Object Xml.XmlNamespaceManager($xm.NameTable)
          $ns2.AddNamespace('e','http://schemas.microsoft.com/win/2004/08/events/event')
          $appName = $xm.SelectSingleNode('//e:EventData/e:Data[@Name="Name"]', $ns2).'#text'
          $degradMs = $xm.SelectSingleNode('//e:EventData/e:Data[@Name="TotalTime"]', $ns2).'#text'
          if (-not $degradMs) { $degradMs = $xm.SelectSingleNode('//e:EventData/e:Data[@Name="DegradationTime"]', $ns2).'#text' }
          $filePath = $xm.SelectSingleNode('//e:EventData/e:Data[@Name="FriendlyName"]', $ns2).'#text'
          if (-not $filePath) { $filePath = $appName }
          if ($appName -and $degradMs) {
            Write-Output "APP|$appName|$degradMs|$filePath"
          }
        }
      } catch {}
    `

    const { stdout } = await execFileAsync('powershell', psArgs(bootScript), { timeout: 15000, windowsHide: true })

    const lines = stdout
      .trim()
      .split('\n')
      .map((l: string) => l.trim())
      .filter(Boolean)

    // Check for access denied
    if (lines.some((l) => l === 'STATUS|DENIED')) {
      return { ...empty, needsAdmin: true }
    }

    let totalBootMs = 0
    let mainPathMs = 0
    let lastBootDate: string | null = null
    const entries: StartupBootEntry[] = []

    for (const line of lines) {
      const parts = line.split('|')
      if (parts[0] === 'BOOT') {
        totalBootMs = Number.parseInt(parts[1] ?? '', 10) || 0
        mainPathMs = Number.parseInt(parts[2] ?? '', 10) || 0
        lastBootDate = parts[3] ?? null
      } else if (parts[0] === 'APP') {
        const appName = parts[1] ?? ''
        const delayMs = Number.parseInt(parts[2] ?? '', 10) || 0
        const filePath = parts[3] ?? appName
        if (delayMs > 0) {
          entries.push({
            name: appName,
            displayName: deriveDisplayName(appName, filePath),
            delayMs,
            source: 'registry-hkcu',
            impact: delayMs > 3000 ? 'high' : delayMs > 1000 ? 'medium' : 'low',
          })
        }
      }
    }

    // Deduplicate by app name — the event log contains entries from multiple
    // boot sessions, so the same app appears many times. Keep the most recent
    // entry (first occurrence, since events are returned newest-first).
    const seen = new Map<string, StartupBootEntry>()
    for (const entry of entries) {
      const key = entry.name.toLowerCase()
      if (!seen.has(key)) {
        seen.set(key, entry)
      }
    }
    const deduped = Array.from(seen.values())

    // Sort by delay descending
    deduped.sort((a, b) => b.delayMs - a.delayMs)

    const startupAppsMs = deduped.reduce((sum, e) => sum + e.delayMs, 0)

    return {
      totalBootMs,
      lastBootDate,
      mainPathMs,
      startupAppsMs,
      entries: deduped,
      available: totalBootMs > 0 || deduped.length > 0,
      needsAdmin: false,
    }
  } catch {
    return empty
  }
}

function estimateImpact(name: string, command?: string): StartupItem['impact'] {
  const lc = `${name} ${command || ''}`.toLowerCase()
  const highImpact = ['chrome', 'discord', 'teams', 'ms-teams', 'slack', 'steam', 'edge', 'msedge', 'docker']
  const medImpact = ['spotify', 'onedrive', 'dropbox', 'adobe', 'notion', 'zoom', 'firefox']
  const noImpact = ['securityhealth', 'windowsdefender', 'securitycenter', 'windows defender']

  if (noImpact.some((k) => lc.includes(k))) return 'none'
  if (highImpact.some((k) => lc.includes(k))) return 'high'
  if (medImpact.some((k) => lc.includes(k))) return 'medium'
  return 'low'
}
