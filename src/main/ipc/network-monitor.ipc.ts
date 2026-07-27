import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

const execFileAsync = promisify(execFile)

export interface NetworkConnection {
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
  processName: string
}

const SUSPICIOUS_PORTS = new Set([
  4444, 5555, 6666, 31337, 1234, 9999, 8888, 7777, 27374, 12345, 54321,
  1080, 3128, 8080, 9050, 9051, // common proxy ports
])

const KNOWN_SYSTEM_PROCESSES = new Set([
  'system', 'svchost.exe', 'lsass.exe', 'csrss.exe', 'wininit.exe',
  'services.exe', 'smss.exe', 'winlogon.exe', 'dwm.exe', 'fontdrvhost.exe',
  'searchhost.exe', 'startmenuexperiencehost.exe', 'shellexperiencehost.exe',
  'taskhostw.exe', 'conhost.exe', 'dllhost.exe', 'runtimebroker.exe',
  'spoolsv.exe', 'sihost.exe', 'ctfmon.exe', 'explorer.exe',
])

export function isSuspicious(conn: NetworkConnection): boolean {
  if (conn.remoteAddress === '0.0.0.0' || conn.remoteAddress === '::' || conn.remoteAddress === '') return false
  if (conn.remoteAddress === '127.0.0.1' || conn.remoteAddress === '::1') return false

  if (SUSPICIOUS_PORTS.has(conn.remotePort)) return true

  const parts = conn.remoteAddress.split('.')
  if (parts.length === 4) {
    const first = Number.parseInt(parts[0]!, 10)
    if (first === 0 || first === 10 || first === 127) return false
    if (first >= 224 && first <= 239) return true
  }

  if (!conn.processName || conn.processName === 'Unknown') return true

  return false
}

async function getProcessName(pid: number): Promise<string> {
  if (pid === 0) return 'System Idle'
  if (pid === 4) return 'System'
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', `Get-Process -Id ${pid} -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName`],
      { timeout: 3000, windowsHide: true, encoding: 'utf-8' },
    )
    return stdout.trim() || 'Unknown'
  } catch {
    return 'Unknown'
  }
}

export async function getActiveConnections(): Promise<NetworkConnection[]> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', 'Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess,State | ConvertTo-Json -Compress'],
      { timeout: 10000, windowsHide: true, encoding: 'utf-8' },
    )

    const parsed: unknown = JSON.parse(stdout)
    const rows = Array.isArray(parsed) ? parsed : [parsed]

    const connections: NetworkConnection[] = []
    const pidCache = new Map<number, string>()

    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const localAddr = String(r.LocalAddress || '')
      const localPort = Number(r.LocalPort) || 0
      const remoteAddr = String(r.RemoteAddress || '')
      const remotePort = Number(r.RemotePort) || 0
      const state = String(r.State || '')
      const pid = Number(r.OwningProcess) || 0

      let processName: string
      if (pidCache.has(pid)) {
        processName = pidCache.get(pid)!
      } else {
        processName = await getProcessName(pid)
        pidCache.set(pid, processName)
      }

      connections.push({
        localAddress: localAddr,
        localPort,
        remoteAddress: remoteAddr,
        remotePort,
        state,
        pid,
        processName,
      })
    }

    return connections
  } catch (err) {
    getLogger().error('network-monitor', `Failed to get connections: ${err}`)
    return []
  }
}

export function registerNetworkMonitorIpc(_getWindow: WindowGetter): void {
  ipcMain.handle(IPC.NETWORK_GET_CONNECTIONS, async (): Promise<{
    connections: NetworkConnection[]
    suspicious: NetworkConnection[]
  }> => {
    getLogger().info('network-monitor', 'Fetching active network connections')
    const connections = await getActiveConnections()
    const suspicious = connections.filter(isSuspicious)
    getLogger().info('network-monitor', `Found ${connections.length} connections, ${suspicious.length} suspicious`)
    return { connections, suspicious }
  })
}
