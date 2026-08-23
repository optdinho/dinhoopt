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

export interface NetstatRow {
  localAddress: string
  localPort: number
  remoteAddress: string
  remotePort: number
  state: string
  pid: number
}

function splitAddress(field: string): { address: string; port: number } {
  if (field.startsWith('[')) {
    const close = field.indexOf(']')
    if (close === -1) return { address: field, port: 0 }
    const address = field.slice(1, close)
    const rest = field.slice(close + 1)
    if (!rest.startsWith(':')) return { address, port: 0 }
    const port = Number.parseInt(rest.slice(1), 10)
    return { address, port: Number.isNaN(port) ? 0 : port }
  }
  const colon = field.lastIndexOf(':')
  if (colon === -1) return { address: field, port: 0 }
  const address = field.slice(0, colon)
  const port = Number.parseInt(field.slice(colon + 1), 10)
  return { address, port: Number.isNaN(port) ? 0 : port }
}

export function parseNetstatOutput(stdout: string): NetstatRow[] {
  const rows: NetstatRow[] = []
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/)
    if (parts.length < 4 || parts[0]?.toUpperCase() !== 'TCP') continue
    const pid = Number.parseInt(parts[parts.length - 1]!, 10)
    if (Number.isNaN(pid)) continue
    const local = splitAddress(parts[1] ?? '')
    const remote = splitAddress(parts[2] ?? '')
    const hasState = parts.length >= 5
    rows.push({
      localAddress: local.address,
      localPort: local.port,
      remoteAddress: remote.address,
      remotePort: remote.port,
      state: hasState ? (parts[3] ?? '') : '',
      pid,
    })
  }
  return rows
}

export function parseTasklistOutput(stdout: string): Map<number, string> {
  const map = new Map<number, string>()
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const cells = trimmed.split('","')
    if (cells.length < 2) continue
    const name = cells[0]!.replace(/^"/, '').trim()
    const pid = Number.parseInt(cells[1]!.replace(/"$/, '').trim(), 10)
    if (!name || Number.isNaN(pid)) continue
    map.set(pid, name)
  }
  return map
}

function resolveNames(pids: Set<number>): Map<number, string> {
  const names = new Map<number, string>()
  for (const pid of pids) {
    if (pid === 0) names.set(pid, 'System Idle')
    else if (pid === 4) names.set(pid, 'System')
  }
  return names
}

export async function fetchProcessNameMap(): Promise<Map<number, string>> {
  try {
    const { stdout } = await execFileAsync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
      timeout: 10000,
      windowsHide: true,
      encoding: 'utf-8',
    })
    return parseTasklistOutput(stdout)
  } catch {
    /* partial result acceptable */
    return new Map()
  }
}

const CACHE_TTL_MS = 3000

let cachedResult: { data: NetworkConnection[]; expires: number } | null = null

export function clearConnectionsCache(): void {
  cachedResult = null
}

export async function getActiveConnections(): Promise<NetworkConnection[]> {
  if (cachedResult && Date.now() < cachedResult.expires) return cachedResult.data

  let connections: NetworkConnection[]
  try {
    const [{ stdout }, nameMap] = await Promise.all([
      execFileAsync('netstat.exe', ['-ano'], { timeout: 10000, windowsHide: true, encoding: 'utf-8' }),
      fetchProcessNameMap(),
    ])
    const rows = parseNetstatOutput(stdout)
    const pids = new Set(rows.map((r) => r.pid))
    const names = resolveNames(pids)
    for (const [pid, name] of nameMap) {
      if (pids.has(pid)) names.set(pid, name)
    }
    connections = rows.map((r) => ({
      ...r,
      processName: names.get(r.pid) || 'Unknown',
    }))
  } catch (err) {
    getLogger().error('network-monitor', `Failed to get connections: ${err}`)
    return []
  }

  cachedResult = { data: connections, expires: Date.now() + CACHE_TTL_MS }
  return connections
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
