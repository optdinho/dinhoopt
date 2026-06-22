import type { StartupItem } from '@shared/types'
import { execNativeUtf8 } from '../../services/exec-utf8'
import { deriveDisplayName, estimateImpact, extractPublisher, makeStableId, stripComment } from './utils'

export function parseRegOutput(stdout: string, location: string, source: StartupItem['source']): StartupItem[] {
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

export async function mergeStartupApproved(items: StartupItem[]): Promise<void> {
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
        const firstByte = Number.parseInt(hexData.substring(0, 2), 16)
        const isDisabledByUser = firstByte === 0x03 || firstByte === 0x06

        if (isDisabledByUser) {
          const existing = items.find((i) => i.name === name)
          if (existing) {
            existing.enabled = false
          }
        }
      }
    } catch {
      /* key may not exist */
    }
  }
}
