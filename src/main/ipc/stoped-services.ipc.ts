import { IPC } from '@shared/channels'
import { getStopedServiceDef, STOPED_SERVICES, type StopedServiceId } from '@shared/stoped-services'
import type {
  ServiceStartType,
  StopedChangeFailure,
  StopedChangeResult,
  StopedServiceState,
  StopedStatusResult,
} from '@shared/types'
import { ipcMain } from 'electron'
import { execFileAsync, psArgs } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'

const SCAN_OPTS = { timeout: 30_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }
const APPLY_OPTS = { timeout: 45_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }

// ── Parsing helpers ───────────────────────────────────────────

function normalizeStartType(raw: string): ServiceStartType {
  const lower = raw.toLowerCase().trim()
  if (lower === 'auto' || lower === 'automatic') return 'Automatic'
  if (lower === 'autodelayed' || lower === 'automaticdelayed') return 'AutomaticDelayed'
  if (lower === 'manual') return 'Manual'
  if (lower === 'disabled') return 'Disabled'
  if (lower === 'boot') return 'Boot'
  if (lower === 'system') return 'System'
  return 'Unknown'
}

/**
 * "PcaSvc|Running|Auto" -> { id, running: true, startType: 'Automatic' }
 * Returns null for malformed lines or ids outside the catalog.
 */
export function parseStatusLine(line: string): { id: string; running: boolean; startType: ServiceStartType } | null {
  const parts = line.trim().split('|')
  if (parts.length < 3) return null
  const id = parts[0]!
  if (!getStopedServiceDef(id)) return null
  return {
    id,
    running: parts[1]!.trim().toLowerCase() === 'running',
    startType: normalizeStartType(parts[2]!),
  }
}

/**
 * Build the per-service PowerShell block.
 *
 * Enabling does TWO things so the service survives a reboot:
 *   1. `Set-Service -StartupType Automatic` (persisted in the SCM registry)
 *   2. `Start-Service` (takes effect right now)
 *
 * Disabling stops the running process first, then flips the startup type —
 * a Disabled service can no longer be auto-started on the next boot.
 */
export function buildServiceScript(id: StopedServiceId, enabled: boolean): string {
  const name = getStopedServiceDef(id)?.id ?? id
  if (enabled) {
    return `try {
  Set-Service -Name '${name}' -StartupType Automatic -ErrorAction Stop
  if ((Get-Service -Name '${name}').Status -ne 'Running') {
    Start-Service -Name '${name}' -ErrorAction Stop
  }
  Write-Output 'OK|${name}'
} catch {
  Write-Output 'FAIL|${name}|' + ($_.Exception.Message -replace '\\|', ' ' -replace '\\r?\\n', ' ')
}`
  }
  return `try {
  $svc = Get-Service -Name '${name}' -ErrorAction Stop
  if ($svc.Status -ne 'Stopped') {
    Stop-Service -Name '${name}' -Force -ErrorAction Stop
  }
  Set-Service -Name '${name}' -StartupType Disabled -ErrorAction Stop
  Write-Output 'OK|${name}'
} catch {
  Write-Output 'FAIL|${name}|' + ($_.Exception.Message -replace '\\|', ' ' -replace '\\r?\\n', ' ')
}`
}

// ── Exported core logic ───────────────────────────────────────

/**
 * Read the live state of every service in the catalog.
 * Always returns one entry per catalog service; `found: false` marks the
 * ones this Windows edition does not ship.
 */
export async function scanStopedServices(): Promise<StopedStatusResult> {
  getLogger().info('stoped-services', 'Scanning curated service status...')

  if (process.platform !== 'win32') {
    const services: StopedServiceState[] = STOPED_SERVICES.map((s) => ({
      id: s.id,
      name: s.id,
      running: false,
      startType: 'Unknown' as ServiceStartType,
      found: false,
    }))
    return { services, runningCount: 0, stoppedCount: 0, missingCount: services.length }
  }

  const script = `
$ErrorActionPreference = 'SilentlyContinue'
foreach ($n in @('${STOPED_SERVICES.map((s) => s.id).join("','")}')) {
  try {
    $svc = Get-CimInstance -ClassName Win32_Service -Filter "Name='$n'" -ErrorAction Stop
    if ($null -ne $svc) {
      Write-Output "SVC|$n|$($svc.State)|$($svc.StartMode)"
    } else {
      Write-Output "MISS|$n"
    }
  } catch {
    Write-Output "MISS|$n"
  }
}
`

  const found = new Map<string, { running: boolean; startType: ServiceStartType }>()
  try {
    const { stdout } = await execFileAsync('powershell', psArgs(script), SCAN_OPTS)
    for (const line of String(stdout).split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('MISS|')) continue
      if (!trimmed.startsWith('SVC|')) continue
      // Strip the SVC| marker; parseStatusLine consumes "Name|State|StartMode".
      const parsed = parseStatusLine(trimmed.slice('SVC|'.length))
      if (parsed) found.set(parsed.id, { running: parsed.running, startType: parsed.startType })
    }
  } catch (err) {
    getLogger().error('stoped-services', `Status scan failed: ${String(err)}`)
  }

  const services: StopedServiceState[] = STOPED_SERVICES.map((def) => {
    const state = found.get(def.id)
    return {
      id: def.id,
      name: def.id,
      running: state?.running ?? false,
      startType: state?.startType ?? 'Unknown',
      found: state !== undefined,
    }
  })

  const runningCount = services.filter((s) => s.found && s.running).length
  const stoppedCount = services.filter((s) => s.found && !s.running).length
  const missingCount = services.filter((s) => !s.found).length

  getLogger().success(
    'stoped-services',
    `Scan complete: ${runningCount} running, ${stoppedCount} stopped, ${missingCount} missing`,
  )
  return { services, runningCount, stoppedCount, missingCount }
}

/**
 * Enable or disable a single curated service.
 *
 * The id is validated against the catalog before anything is executed, so
 * no caller-supplied string ever reaches the PowerShell script.
 */
export async function setStopedService(id: unknown, enabled: unknown): Promise<StopedChangeResult> {
  const def = typeof id === 'string' ? getStopedServiceDef(id) : undefined
  if (!def) {
    getLogger().warning('stoped-services', `Rejected unknown service id: ${String(id)}`)
    return {
      success: false,
      error: 'Unknown service',
      changed: [],
      failed: [],
      rebootRequired: false,
    }
  }
  if (typeof enabled !== 'boolean') {
    return { success: false, error: 'Invalid enabled flag', changed: [], failed: [], rebootRequired: false }
  }
  if (process.platform !== 'win32') {
    return { success: false, error: 'Not supported on this platform', changed: [], failed: [], rebootRequired: false }
  }

  const script = buildServiceScript(def.id, enabled)

  try {
    const { stdout } = await execFileAsync('powershell', psArgs(script), APPLY_OPTS)
    for (const line of String(stdout).split('\n')) {
      const trimmed = line.trim()
      if (trimmed.startsWith('OK|')) {
        getLogger().success('stoped-services', `${def.id} -> ${enabled ? 'enabled' : 'disabled'}`)
        return { success: true, changed: [def.id], failed: [], rebootRequired: true }
      }
      if (trimmed.startsWith('FAIL|')) {
        const parts = trimmed.split('|')
        const reason = parts[2]?.trim() || 'Unknown error'
        getLogger().error('stoped-services', `${def.id} failed: ${reason}`)
        return {
          success: false,
          error: reason,
          changed: [],
          failed: [{ id: def.id, error: reason }],
          rebootRequired: false,
        }
      }
    }
    const reason = 'No response from Service Control Manager'
    getLogger().error('stoped-services', `${def.id}: ${reason}`)
    return {
      success: false,
      error: reason,
      changed: [],
      failed: [{ id: def.id, error: reason }],
      rebootRequired: false,
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Failed to change service'
    getLogger().error('stoped-services', `${def.id} threw: ${reason}`)
    return {
      success: false,
      error: reason,
      changed: [],
      failed: [{ id: def.id, error: reason }],
      rebootRequired: false,
    }
  }
}

/**
 * Apply the same target state to every service in the catalog.
 * Each service is handled independently so one failure does not abort the rest.
 */
export async function setAllStopedServices(enabled: unknown): Promise<StopedChangeResult> {
  if (typeof enabled !== 'boolean') {
    return { success: false, error: 'Invalid enabled flag', changed: [], failed: [], rebootRequired: false }
  }
  if (process.platform !== 'win32') {
    return { success: false, error: 'Not supported on this platform', changed: [], failed: [], rebootRequired: false }
  }

  getLogger().info('stoped-services', `Applying "${enabled ? 'enable' : 'disable'}" to all curated services`)

  const changed: StopedServiceId[] = []
  const failed: StopedChangeFailure[] = []

  for (const def of STOPED_SERVICES) {
    const result = await setStopedService(def.id, enabled)
    if (result.success) changed.push(def.id)
    else failed.push({ id: def.id, error: result.error ?? 'Unknown error' })
  }

  const success = changed.length > 0
  getLogger().success('stoped-services', `Bulk apply: ${changed.length} changed, ${failed.length} failed`)

  return {
    success,
    ...(success ? {} : { error: failed[0]?.error ?? 'No service could be changed' }),
    changed,
    failed,
    rebootRequired: success,
  }
}

// ── Registration ──────────────────────────────────────────────

export function registerStopedServicesIpc(): void {
  ipcMain.handle(IPC.STOPED_SERVICES_STATUS, () => {
    getLogger().info('stoped-services', 'IPC: status requested')
    return scanStopedServices()
  })

  ipcMain.handle(IPC.STOPED_SERVICES_SET, (_event, id: unknown, enabled: unknown) => {
    getLogger().info('stoped-services', `IPC: set ${String(id)} -> ${String(enabled)}`)
    return setStopedService(id, enabled)
  })

  ipcMain.handle(IPC.STOPED_SERVICES_SET_ALL, (_event, enabled: unknown) => {
    getLogger().info('stoped-services', `IPC: set-all -> ${String(enabled)}`)
    return setAllStopedServices(enabled)
  })
}
