import { randomUUID } from 'node:crypto'
import type { RegistryEntry } from '@shared/types'
import { execReg } from './utils'

export async function scanNetwork(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = []

  try {
    const llmnrKey = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient'
    const { stdout } = await execReg(['query', llmnrKey, '/v', 'EnableMulticast'], {
      timeout: 5000,
      ...(signal ? { signal } : {}),
    })
    const match = stdout.match(/EnableMulticast\s+REG_DWORD\s+0x(\d+)/i)
    if (!match || match[1]! !== '0') {
      entries.push({
        id: randomUUID(),
        type: 'network',
        keyPath: llmnrKey,
        valueName: 'EnableMulticast',
        issue: 'LLMNR is enabled — vulnerable to name resolution poisoning attacks on local networks',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' },
      })
    }
  } catch {
    entries.push({
      id: randomUUID(),
      type: 'network',
      keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient',
      valueName: 'EnableMulticast',
      issue: 'LLMNR is enabled by default — vulnerable to name resolution poisoning attacks',
      risk: 'medium',
      selected: true,
      fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' },
    })
  }

  try {
    const wpadKey = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Wpad'
    const { stdout } = await execReg(['query', wpadKey, '/v', 'WpadOverride'], {
      timeout: 5000,
      ...(signal ? { signal } : {}),
    })
    const match = stdout.match(/WpadOverride\s+REG_DWORD\s+0x(\d+)/i)
    if (!match || match[1]! !== '1') {
      entries.push({
        id: randomUUID(),
        type: 'network',
        keyPath: wpadKey,
        valueName: 'WpadOverride',
        issue: 'WPAD auto-proxy discovery is enabled — can be exploited for man-in-the-middle attacks',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
      })
    }
  } catch {
    entries.push({
      id: randomUUID(),
      type: 'network',
      keyPath: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Wpad',
      valueName: 'WpadOverride',
      issue: 'WPAD auto-proxy discovery is enabled — can be exploited for man-in-the-middle attacks',
      risk: 'medium',
      selected: true,
      fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
    })
  }

  return entries
}
