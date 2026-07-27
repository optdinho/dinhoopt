import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GameModeSnapshot } from '@shared/types'
import { app } from 'electron'

export const SERVICE_MAP: Record<string, string> = {
  'svc-wsearch': 'WSearch',
  'svc-sysmain': 'SysMain',
  'svc-wuauserv': 'wuauserv',
  'svc-spooler': 'Spooler',
  'svc-diagtrack': 'DiagTrack',
}

export const VALID_SERVICE_NAMES = new Set(Object.values(SERVICE_MAP))

export const ALLOWED_REGISTRY_TWEAK_PATHS = new Set([
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\GameDVR',
  'HKCU:\\System\\GameConfigStore',
  'HKCU:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
])

export const ALLOWED_REGISTRY_TWEAK_NAMES = new Set([
  'AppCaptureEnabled',
  'GameDVR_Enabled',
  'GameDVR_FSEBehaviorMode',
  'GameDVR_HonorUserFSEBehaviorMode',
  'GameDVR_DXGIHonorFSEWindowsCompatible',
  'GameDVR_EFSEFeatureFlags',
  'EnableTransparency',
])

function getSnapshotPath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'Kudu-Dev')
  return join(dir, 'game-mode-snapshot.json')
}

export function validateSnapshot(raw: unknown): GameModeSnapshot | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null
  const s = raw as Record<string, unknown>

  if (typeof s.activatedAt !== 'string' || s.activatedAt.length > 50) return null

  if ('active' in s && typeof s.active !== 'boolean') return null
  if (!('active' in s)) s.active = true

  if (!Array.isArray(s.services)) return null
  for (const svc of s.services) {
    if (typeof svc !== 'object' || svc === null) return null
    const sv = svc as Record<string, unknown>
    if (typeof sv.name !== 'string' || !VALID_SERVICE_NAMES.has(sv.name)) return null
    if (typeof sv.originalStartType !== 'string' || !/^[A-Za-z0-9]{1,20}$/.test(sv.originalStartType)) return null
    if (typeof sv.wasRunning !== 'boolean') return null
  }

  if (!Array.isArray(s.killedProcesses)) return null
  for (const p of s.killedProcesses) {
    if (typeof p !== 'object' || p === null) return null
    const pv = p as Record<string, unknown>
    if (typeof pv.pid !== 'number' || !Number.isInteger(pv.pid)) return null
    if (typeof pv.name !== 'string' || pv.name.length > 260) return null
  }

  if (s.originalPowerPlanGuid !== null) {
    if (typeof s.originalPowerPlanGuid !== 'string') return null
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s.originalPowerPlanGuid)) return null
  }

  if (s.originalFocusAssistState !== null) {
    if (typeof s.originalFocusAssistState !== 'number') return null
    if (
      !Number.isInteger(s.originalFocusAssistState) ||
      s.originalFocusAssistState < 0 ||
      s.originalFocusAssistState > 1
    )
      return null
  }

  if (s.powerSaveBlockerId !== null) {
    if (typeof s.powerSaveBlockerId !== 'number' || !Number.isInteger(s.powerSaveBlockerId)) return null
  }

  if (s.originalTimerResolution !== null) {
    if (
      typeof s.originalTimerResolution !== 'number' ||
      !Number.isInteger(s.originalTimerResolution) ||
      s.originalTimerResolution < 0
    )
      return null
  }

  if (!Array.isArray(s.nagleInterfaces)) return null
  const REGISTRY_PATH_RE =
    /^Microsoft\.PowerShell\.Core\\Registry::HKEY_LOCAL_MACHINE\\SYSTEM\\CurrentControlSet\\Services\\Tcpip\\Parameters\\Interfaces\\{[0-9A-Fa-f-]+}$/
  for (const iface of s.nagleInterfaces) {
    if (typeof iface !== 'object' || iface === null) return null
    const iv = iface as Record<string, unknown>
    if (typeof iv.path !== 'string' || !REGISTRY_PATH_RE.test(iv.path)) return null
    if (
      iv.originalTcpNoDelay !== null &&
      (typeof iv.originalTcpNoDelay !== 'number' ||
        !Number.isInteger(iv.originalTcpNoDelay) ||
        iv.originalTcpNoDelay < 0 ||
        iv.originalTcpNoDelay > 1)
    )
      return null
    if (
      iv.originalTcpAckFrequency !== null &&
      (typeof iv.originalTcpAckFrequency !== 'number' ||
        !Number.isInteger(iv.originalTcpAckFrequency) ||
        iv.originalTcpAckFrequency < 0 ||
        iv.originalTcpAckFrequency > 255)
    )
      return null
  }

  if (!Array.isArray(s.registryTweaks)) return null
  for (const tweak of s.registryTweaks) {
    if (typeof tweak !== 'object' || tweak === null) return null
    const tv = tweak as Record<string, unknown>
    if (typeof tv.path !== 'string' || !ALLOWED_REGISTRY_TWEAK_PATHS.has(tv.path)) return null
    if (typeof tv.name !== 'string' || !ALLOWED_REGISTRY_TWEAK_NAMES.has(tv.name)) return null
    if (tv.originalValue !== null && (typeof tv.originalValue !== 'number' || !Number.isInteger(tv.originalValue)))
      return null
  }

  if (!Array.isArray(s.gameProcessPriorities)) return null
  for (const gp of s.gameProcessPriorities) {
    if (typeof gp !== 'object' || gp === null) return null
    const gv = gp as Record<string, unknown>
    if (typeof gv.name !== 'string' || gv.name.length > 260) return null
    if (typeof gv.pid !== 'number' || !Number.isInteger(gv.pid) || gv.pid < 0) return null
    if (typeof gv.originalPriority !== 'string' || !/^[A-Za-z]{1,20}$/.test(gv.originalPriority)) return null
  }

  return s as unknown as GameModeSnapshot
}

export function readSnapshot(): GameModeSnapshot | null {
  try {
    const path = getSnapshotPath()
    if (!existsSync(path)) return null
    const raw = JSON.parse(readFileSync(path, 'utf-8'))
    return validateSnapshot(raw)
  } catch {
    return null
  }
}

export function writeSnapshot(snapshot: GameModeSnapshot): void {
  writeFileSync(getSnapshotPath(), JSON.stringify(snapshot, null, 2), 'utf-8')
}

export function deleteSnapshot(): void {
  try {
    unlinkSync(getSnapshotPath())
  } catch {
    /* already gone */
  }
}
