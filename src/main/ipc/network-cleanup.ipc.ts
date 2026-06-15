import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/channels'
import type { NetworkCleanResult, NetworkItem } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { execFileAsync, execNativeUtf8, psUtf8 } from '../services/exec-utf8'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'

async function getDnsCacheCount(): Promise<number> {
  const platform = getPlatform()
  const entries = await platform.network.getDnsCacheEntries()
  if (entries.length > 0) return entries.length
  // On Windows, use PowerShell for an accurate count since getDnsCacheEntries may be slow
  if (process.platform === 'win32') {
    try {
      const { stdout } = await execFileAsync(
        'powershell',
        ['-NoProfile', '-Command', psUtf8('(Get-DnsClientCache | Measure-Object).Count')],
        { timeout: 10000, windowsHide: true },
      )
      return Number.parseInt(stdout.trim(), 10) || 0
    } catch {
      return 0
    }
  }
  // On Linux/macOS, DNS cache is not queryable but we can still offer to flush it
  return 1 // Always show the flush option
}

async function getArpEntryCount(): Promise<number> {
  try {
    const cmd = process.platform === 'win32' ? 'arp' : '/usr/sbin/arp'
    const { stdout } = await execFileAsync(cmd, ['-a'], { timeout: 10000 })
    const lines = stdout.split('\n').filter((l) => /\d+\.\d+\.\d+\.\d+/.test(l))
    return lines.length
  } catch {
    return 0
  }
}

async function getNetworkHistory(): Promise<{ name: string; guid: string }[]> {
  // Network history is Windows-only (registry-based)
  if (process.platform !== 'win32') return []
  try {
    const { stdout } = await execNativeUtf8(
      'reg',
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles', '/s'],
      { timeout: 10000, windowsHide: true },
    )
    const entries: { name: string; guid: string }[] = []
    let currentGuid = ''
    for (const line of stdout.split('\n')) {
      const guidMatch = line.match(/\\(\{[0-9A-F-]+\})$/i)
      if (guidMatch) {
        currentGuid = guidMatch[1]!
      }
      const nameMatch = line.match(/ProfileName\s+REG_SZ\s+(.+)/i)
      if (nameMatch && currentGuid) {
        entries.push({ name: nameMatch[1]!.trim(), guid: currentGuid })
      }
    }
    return entries
  } catch {
    return []
  }
}

// ── Exported core logic (used by both IPC handlers and CLI) ──

export async function scanNetwork(): Promise<NetworkItem[]> {
  getLogger().info('network-cleanup', 'Starting network scan...')
  const platform = getPlatform()
  const items: NetworkItem[] = []

  const dnsCount = await getDnsCacheCount()
  if (dnsCount > 0) {
    items.push({
      id: randomUUID(),
      type: 'dns-cache',
      label: 'DNS Resolver Cache',
      detail:
        process.platform === 'win32'
          ? `${dnsCount} cached entries — flushing forces fresh DNS lookups`
          : 'Flush DNS resolver cache to force fresh lookups',
      selected: true,
    })
  }

  const wifiProfiles = await (platform.network.getWifiProfiles?.() ?? Promise.resolve([]))
  for (const profile of wifiProfiles) {
    items.push({
      id: randomUUID(),
      type: 'wifi-profile',
      label: profile.name,
      detail: `Wi-Fi profile · ${profile.security}`,
      selected: false,
    })
  }

  const arpCount = await getArpEntryCount()
  if (arpCount > 0) {
    items.push({
      id: randomUUID(),
      type: 'arp-cache',
      label: 'ARP Cache',
      detail: `${arpCount} entries — maps IP addresses to hardware addresses`,
      selected: true,
    })
  }

  const history = await getNetworkHistory()
  if (history.length > 0) {
    items.push({
      id: randomUUID(),
      type: 'network-history',
      label: 'Network History',
      detail: `${history.length} saved network profile${history.length === 1 ? '' : 's'}`,
      selected: false,
    })
  }

  getLogger().success('network-cleanup', `Network scan completed — ${items.length} item(s) found`)
  return items
}

export async function cleanNetworkItems(items: NetworkItem[]): Promise<NetworkCleanResult> {
  getLogger().info('network-cleanup', `Starting network clean for ${items.length} item(s)...`)
  const platform = getPlatform()
  let cleaned = 0
  let failed = 0
  const details: string[] = []

  // Separate Wi-Fi profiles for parallel deletion
  const wifiItems: NetworkItem[] = []
  const otherItems: NetworkItem[] = []

  for (const item of items) {
    if (item.type === 'wifi-profile') wifiItems.push(item)
    else otherItems.push(item)
  }

  // Process non-WiFi items sequentially (each is a single bulk operation)
  for (const item of otherItems) {
    try {
      switch (item.type) {
        case 'dns-cache': {
          const success = await (platform.network.flushDnsCache?.() ?? Promise.resolve(false))
          if (success) {
            details.push('Flushed DNS resolver cache')
            cleaned++
          } else {
            failed++
            details.push('Failed to flush DNS cache')
          }
          break
        }

        case 'arp-cache': {
          const success = await (platform.network.clearArpCache?.() ?? Promise.resolve(false))
          if (success) {
            details.push('Cleared ARP cache')
            cleaned++
          } else {
            failed++
            details.push('Failed to clear ARP cache')
          }
          break
        }

        case 'network-history': {
          if (process.platform !== 'win32') break
          const histories = await getNetworkHistory()
          if (histories.length === 0) break
          const histResults = await Promise.allSettled(
            histories.map((entry) =>
              execNativeUtf8(
                'reg',
                [
                  'delete',
                  `HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\NetworkList\\Profiles\\${entry.guid}`,
                  '/f',
                ],
                { timeout: 10000, windowsHide: true },
              ),
            ),
          )
          const histCleaned = histResults.filter((r) => r.status === 'fulfilled').length
          if (histCleaned > 0) {
            details.push(`Removed ${histCleaned} network histor${histCleaned === 1 ? 'y' : 'ies'}`)
            cleaned += histCleaned
          }
          if (histories.length - histCleaned > 0) {
            failed += histories.length - histCleaned
          }
          break
        }
      }
    } catch {
      failed++
      details.push(`Failed to clean: ${item.label}`)
    }
  }

  // Process Wi-Fi profiles in parallel
  if (wifiItems.length > 0) {
    const wifiResults = await Promise.allSettled(
      wifiItems.map(async (item) => {
        // biome-ignore lint/suspicious/noControlCharactersInRegex: security-critical — intentionally blocks control chars
        if (!item.label || /["\x00-\x1F]/.test(item.label)) {
          return { success: false as const, label: item.label ?? '(empty)' }
        }
        const ok = await (platform.network.deleteWifiProfile?.(item.label) ?? Promise.resolve(false))
        return { success: ok, label: item.label }
      }),
    )
    for (const result of wifiResults) {
      if (result.status === 'fulfilled') {
        if (result.value.success) {
          details.push(`Removed Wi-Fi profile: ${result.value.label}`)
          cleaned++
        } else {
          failed++
          details.push(`Failed to remove Wi-Fi profile: ${result.value.label}`)
        }
      } else {
        failed++
      }
    }
  }

  const result = { cleaned, failed, details }
  if (result.failed > 0) {
    getLogger().error(
      'network-cleanup',
      `Network clean completed with ${result.failed} failure(s) — ${result.cleaned} cleaned`,
    )
  } else {
    getLogger().success('network-cleanup', `Network clean completed — ${result.cleaned} cleaned`)
  }
  return result
}

// ── IPC registration ──

const scanSessions = new Map<string, Map<string, NetworkItem>>()

export function registerNetworkCleanupIpc(): void {
  ipcMain.handle(IPC.NETWORK_SCAN, async (): Promise<NetworkItem[]> => {
    getLogger().info('network-cleanup', 'IPC network scan requested')
    const items = await scanNetwork()

    const scanId = randomUUID()
    const sessionMap = new Map<string, NetworkItem>()
    for (const item of items) sessionMap.set(item.id, item)
    scanSessions.set(scanId, sessionMap)
    const sessionKeys = [...scanSessions.keys()]
    while (sessionKeys.length > 3) scanSessions.delete(sessionKeys.shift()!)

    return items
  })

  ipcMain.handle(IPC.NETWORK_CLEAN, async (_event, itemIds: string[]): Promise<NetworkCleanResult> => {
    getLogger().info('network-cleanup', 'IPC network clean requested')
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('network-cleanup', 'Invalid item IDs received for network clean')
      return { cleaned: 0, failed: 0, details: [] }
    }
    // Search all sessions for the requested items (avoids race if a new scan started)
    const items: NetworkItem[] = []
    for (const id of valid) {
      for (const session of scanSessions.values()) {
        const item = session.get(id)
        if (item) {
          items.push(item)
          break
        }
      }
    }
    return cleanNetworkItems(items).then((result) => {
      getLogger().success(
        'network-cleanup',
        `IPC network clean completed — ${result.cleaned} cleaned, ${result.failed} failed`,
      )
      return result
    })
  })
}
