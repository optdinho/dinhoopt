import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import type { StartupItem } from '@shared/types'

export function makeStableId(name: string, source: string): string {
  return createHash('sha256').update(`${name}::${source}`).digest('hex').slice(0, 16)
}

export function friendlyExeName(name: string): string {
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

export function deriveDisplayName(registryName: string, command: string): string {
  const quotedMatch = command.match(/^"([^"]+)"/)
  const exePathMatch = quotedMatch
    ? quotedMatch[1]
    : command.match(/^(.+?\.exe)\b/i)?.[1] || command.match(/^(\S+)/)?.[1] || ''
  const exePath = (exePathMatch ?? '').replace(/\\/g, '/')
  const exeName = basename(exePath, extname(exePath))

  const electronMatch = registryName.match(/^electron\.app\.(.+)$/i)
  if (electronMatch) return electronMatch[1] ?? registryName

  const hexSuffixMatch = registryName.match(/^(.+?)[_-][A-F0-9]{8,}$/i)
  if (hexSuffixMatch) {
    const prefix = (hexSuffixMatch[1] ?? '').replace(/[-_]/g, ' ')
    if (prefix.length > 20 && exeName) return friendlyExeName(exeName)
    return prefix
  }

  if (registryName.includes(' ') || (registryName.length <= 30 && /^[\p{L}\p{N} ._-]+$/u.test(registryName))) {
    return registryName
  }

  if (exeName) return friendlyExeName(exeName)

  return registryName
}

export function stripComment(cmd: string): string {
  let inQuotes = false
  for (let i = 0; i < cmd.length; i++) {
    if (cmd[i] === '"') inQuotes = !inQuotes
    if (!inQuotes && cmd[i] === ';') {
      return cmd.substring(0, i).trimEnd()
    }
  }
  return cmd
}

export function extractPublisher(command: string | undefined): string {
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

export function estimateImpact(name: string, command?: string): StartupItem['impact'] {
  const lc = `${name} ${command || ''}`.toLowerCase()
  const highImpact = ['chrome', 'discord', 'teams', 'ms-teams', 'slack', 'steam', 'edge', 'msedge', 'docker']
  const medImpact = ['spotify', 'onedrive', 'dropbox', 'adobe', 'notion', 'zoom', 'firefox']
  const noImpact = ['securityhealth', 'windowsdefender', 'securitycenter', 'windows defender']

  if (noImpact.some((k) => lc.includes(k))) return 'none'
  if (highImpact.some((k) => lc.includes(k))) return 'high'
  if (medImpact.some((k) => lc.includes(k))) return 'medium'
  return 'low'
}

export function isSafeTaskName(name: string): boolean {
  return typeof name === 'string' && name.length > 0 && name.length <= 260 && /^[\p{L}\p{N} \-._()]+$/u.test(name)
}

export const ALLOWED_STARTUP_LOCATIONS = new Set([
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Run',
])
