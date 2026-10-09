import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import { logAudit } from './audit-log'
import { isAdmin } from './elevation'
import { execNativeUtf8, execTracked } from './exec-utf8'
import { getLogger } from './logger.service'

/**
 * Bumped whenever the enable-set changes, so an install that already ran an
 * older revision runs again on the next update.
 */
export const CAPTURE_ENABLE_VERSION = 1

export interface CaptureEnableKey {
  hive: 'HKCU' | 'HKLM'
  path: string
  key: string
}

/**
 * Capture-related values that DiNho's former "gaming" tweaks used to force to 0.
 * The Windows.Graphics.Capture service refuses to start while any of these is
 * disabled (0x80070422), so we restore them to the Windows default (`=1`).
 */
export const CAPTURE_ENABLE_KEYS: readonly CaptureEnableKey[] = [
  { hive: 'HKCU', path: 'System\\GameConfigStore', key: 'GameDVR_Enabled' },
  { hive: 'HKCU', path: 'Software\\Microsoft\\Windows\\CurrentVersion\\GameDVR', key: 'AppCaptureEnabled' },
  { hive: 'HKLM', path: 'SOFTWARE\\Policies\\Microsoft\\Windows\\GameDVR', key: 'AllowGameDVR' },
  {
    hive: 'HKLM',
    path: 'SOFTWARE\\Microsoft\\PolicyManager\\default\\ApplicationManagement\\AllowGameDVR',
    key: 'value',
  },
  {
    hive: 'HKLM',
    path: 'SOFTWARE\\Microsoft\\PolicyManager\\current\\ApplicationManagement\\AllowGameDVR',
    key: 'value',
  },
]

export interface CaptureEnableResult {
  applied: boolean
  version: number
  reason?: 'already-applied' | 'not-win32' | 'not-admin' | 'failed'
}

interface CaptureEnableMarker {
  version: number
}

export function getCaptureEnableMarkerPath(): string {
  return join(app.getPath('userData'), 'capture-enable.json')
}

function readMarker(): number {
  try {
    const filePath = getCaptureEnableMarkerPath()
    if (!existsSync(filePath)) return 0
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as CaptureEnableMarker
    const version = raw?.version
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return 0
    return version
  } catch {
    return 0
  }
}

function writeMarker(version: number): void {
  const filePath = getCaptureEnableMarkerPath()
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify({ version }, null, 2), 'utf-8')
}

/**
 * Restores the capture-related registry values to their enabled state exactly
 * once per `CAPTURE_ENABLE_VERSION`.
 *
 * Why this exists: installs that applied DiNho's former "gaming" tweaks have
 * `GameDVR_Enabled`/`AppCaptureEnabled`/`AllowGameDVR` pinned to 0, which makes
 * the Windows.Graphics.Capture service refuse to start (`0x80070422`) and
 * breaks the clips engine. The tweaks were removed from the catalog, but that
 * alone does not undo them on existing installs — so we re-enable the keys at
 * boot. Idempotent: once the marker is stamped, the user's later changes are
 * never touched again.
 */
export async function applyCaptureEnableMigration(): Promise<CaptureEnableResult> {
  const version = readMarker()
  if (version >= CAPTURE_ENABLE_VERSION) {
    return { applied: false, version, reason: 'already-applied' }
  }

  if (process.platform !== 'win32') {
    return { applied: false, version, reason: 'not-win32' }
  }

  // HKLM writes need elevation. In production the app auto-elevates, so this
  // only short-circuits a non-elevated dev/E2E boot — and deliberately without
  // stamping, so the next elevated boot retries.
  if (!isAdmin()) {
    return { applied: false, version, reason: 'not-admin' }
  }

  for (const { hive, path, key } of CAPTURE_ENABLE_KEYS) {
    try {
      await execNativeUtf8('reg', ['add', `${hive}\\${path}`, '/v', key, '/t', 'REG_DWORD', '/d', '1', '/f'])
    } catch (err) {
      getLogger().error(
        'capture-enable',
        `Failed to enable ${hive}\\${path}\\${key}: ${err instanceof Error ? err.message : String(err)}`,
      )
      return { applied: false, version, reason: 'failed' }
    }
  }

  // Best-effort: refresh policy so the PolicyManager values take effect now.
  // A failure here does not roll back the (already written) registry values.
  try {
    await execTracked('gpupdate', ['/target:computer', '/force'])
  } catch (err) {
    getLogger().warning(
      'capture-enable',
      `gpupdate failed (ignored): ${err instanceof Error ? err.message : String(err)}`,
    )
  }

  writeMarker(CAPTURE_ENABLE_VERSION)
  logAudit('capture-enable-applied', 'system', { version: CAPTURE_ENABLE_VERSION, keys: CAPTURE_ENABLE_KEYS.length })
  getLogger().info('capture-enable', `Re-enabled capture registry values (v${CAPTURE_ENABLE_VERSION})`)

  return { applied: true, version: CAPTURE_ENABLE_VERSION }
}
