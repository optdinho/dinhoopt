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
  4444,
  5555,
  6666,
  31337,
  1234,
  9999,
  8888,
  7777,
  27374,
  12345,
  54321,
  1080,
  3128,
  8080,
  9050,
  9051, // common proxy ports
])

const _KNOWN_SYSTEM_PROCESSES = new Set([
  'system',
  'svchost.exe',
  'lsass.exe',
  'csrss.exe',
  'wininit.exe',
  'services.exe',
  'smss.exe',
  'winlogon.exe',
  'dwm.exe',
  'fontdrvhost.exe',
  'searchhost.exe',
  'startmenuexperiencehost.exe',
  'shellexperiencehost.exe',
  'taskhostw.exe',
  'conhost.exe',
  'dllhost.exe',
  'runtimebroker.exe',
  'spoolsv.exe',
  'sihost.exe',
  'ctfmon.exe',
  'explorer.exe',
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

async function getProcessNamesBatch(pids: number[]): Promise<Map<number, string>> {
  const result = new Map<number, string>()
  const unknownPids: number[] = []
  for (const pid of pids) {
    if (pid === 0) { result.set(pid, 'System Idle'); continue }
    if (pid === 4) { result.set(pid, 'System'); continue }
    unknownPids.push(pid)
  }
  if (unknownPids.length === 0) return result

  try {
    const pidList = unknownPids.map(p => `Get-Process -Id ${p} -ErrorAction SilentlyContinue`).join('; ')
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-Command', `${pidList} | Select-Object Id,ProcessName | ConvertTo-Json -Compress`],
      { timeout: 5000, windowsHide: true, encoding: 'utf-8' },
    )
    let parsed: unknown
    try { parsed = JSON.parse(stdout) } catch { return result }
    const rows = Array.isArray(parsed) ? parsed : [parsed]
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const id = Number(r.Id)
      const name = String(r.ProcessName || '').trim()
      if (id && name) result.set(id, name)
    }
  } catch {
    /* partial result acceptable */
  }
  return result
}

export async function getActiveConnections(): Promise<NetworkConnection[]> {
  try {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        'Get-NetTCPConnection | Select-Object LocalAddress,LocalPort,RemoteAddress,RemotePort,OwningProcess,State | ConvertTo-Json -Compress',
      ],
      { timeout: 10000, windowsHide: true, encoding: 'utf-8' },
    )

    let parsed: unknown
    try {
      parsed = JSON.parse(stdout)
    } catch {
      getLogger().warning('network-monitor', 'Failed to parse PowerShell output')
      return []
    }
    const rows = Array.isArray(parsed) ? parsed : [parsed]

    const pids = new Set<number>()
    const rawRows: Array<{ localAddr: string; localPort: number; remoteAddr: string; remotePort: number; state: string; pid: number }> = []
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const pid = Number(r.OwningProcess) || 0
      pids.add(pid)
      rawRows.push({
        localAddr: String(r.LocalAddress || ''),
        localPort: Number(r.LocalPort) || 0,
        remoteAddr: String(r.RemoteAddress || ''),
        remotePort: Number(r.RemotePort) || 0,
        state: String(r.State || ''),
        pid,
      })
    }

    const nameMap = await getProcessNamesBatch([...pids])

    return rawRows.map(r => ({
      localAddress: r.localAddr,
      localPort: r.localPort,
      remoteAddress: r.remoteAddr,
      remotePort: r.remotePort,
      state: r.state,
      pid: r.pid,
      processName: nameMap.get(r.pid) || 'Unknown',
    }))
  } catch (err) {
    getLogger().error('network-monitor', `Failed to get connections: ${err}`)
    return []
  }
}

export function registerNetworkMonitorIpc(_getWindow: WindowGetter): void {
  ipcMain.handle(
    IPC.NETWORK_GET_CONNECTIONS,
    async (): Promise<{
      connections: NetworkConnection[]
      suspicious: NetworkConnection[]
    }> => {
      getLogger().info('network-monitor', 'Fetching active network connections')
      const connections = await getActiveConnections()
      const suspicious = connections.filter(isSuspicious)
      getLogger().info('network-monitor', `Found ${connections.length} connections, ${suspicious.length} suspicious`)
      return { connections, suspicious }
    },
  )
}
