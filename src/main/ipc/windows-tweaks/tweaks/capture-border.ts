import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { execFileAsync } from '../../../services/exec-utf8'
import { getLogger } from '../../../services/logger.service'
import type { WindowGetter } from '../../index'
import { validateSender } from '../../sender-validation'

type ConsentValue = 'Allow' | 'Deny'

export interface CaptureBorderStatus {
  enabled: boolean
  global: boolean
  desktopApps: boolean
}

const ROOT_PATH =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\graphicsCaptureWithoutBorder'
const DESKTOP_PATH = `${ROOT_PATH}\\NonPackaged`
const TARGETS = [
  { label: 'global', path: ROOT_PATH },
  { label: 'desktopApps', path: DESKTOP_PATH },
] as const

const REG_OPTIONS = { timeout: 10000, windowsHide: true }

export function parseConsentValue(stdout: string): ConsentValue | null {
  const match = String(stdout).match(/^\s*Value\s+REG_SZ\s+(Allow|Deny)\s*$/im)
  const value = match?.[1]
  return value === 'Allow' || value === 'Deny' ? value : null
}

async function queryConsent(path: string): Promise<ConsentValue | null> {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', path, '/v', 'Value'], REG_OPTIONS)
    return parseConsentValue(String(stdout))
  } catch {
    return null
  }
}

export async function getCaptureBorderStatus(): Promise<CaptureBorderStatus> {
  const [globalValue, desktopValue] = await Promise.all([queryConsent(ROOT_PATH), queryConsent(DESKTOP_PATH)])
  return {
    enabled: globalValue === 'Allow' && desktopValue === 'Allow',
    global: globalValue === 'Allow',
    desktopApps: desktopValue === 'Allow',
  }
}

async function writeConsent(path: string, value: ConsentValue): Promise<void> {
  await execFileAsync('reg.exe', ['add', path, '/v', 'Value', '/t', 'REG_SZ', '/d', value, '/f'], REG_OPTIONS)
}

async function restoreConsent(path: string, previous: ConsentValue | null): Promise<void> {
  if (previous === null) {
    await execFileAsync('reg.exe', ['delete', path, '/v', 'Value', '/f'], REG_OPTIONS)
    return
  }
  await writeConsent(path, previous)
}

export async function setCaptureBorderAllowed(enabled: boolean): Promise<{ success: boolean; error?: string }> {
  const value: ConsentValue = enabled ? 'Allow' : 'Deny'
  const initial = await Promise.all(TARGETS.map((target) => queryConsent(target.path)))
  const applied: number[] = []

  try {
    for (const [index, target] of TARGETS.entries()) {
      await writeConsent(target.path, value)
      applied.push(index)
    }
    return { success: true }
  } catch (err) {
    for (const index of applied) {
      const target = TARGETS[index]
      if (!target) continue
      try {
        await restoreConsent(target.path, initial[index] ?? null)
      } catch (rollbackErr) {
        getLogger().warning('windows-tweaks', `Capture border rollback failed for ${target.label}: ${rollbackErr}`)
      }
    }
    getLogger().error('windows-tweaks', `Capture border set failed: ${err}`)
    return { success: false, error: String(err) }
  }
}

export function registerCaptureBorderTweaks(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.WINDOWS_TWEAKS_CAPTURE_BORDER_GET, async (event): Promise<CaptureBorderStatus> => {
    if (!validateSender(event, getWindow())) return { enabled: false, global: false, desktopApps: false }
    getLogger().info('windows-tweaks', 'Capture border status requested')
    return getCaptureBorderStatus()
  })

  ipcMain.handle(
    IPC.WINDOWS_TWEAKS_CAPTURE_BORDER_SET,
    async (event, enabled: unknown): Promise<{ success: boolean; error?: string }> => {
      if (!validateSender(event, getWindow())) return { success: false, error: 'Invalid sender' }
      if (typeof enabled !== 'boolean') return { success: false, error: 'Invalid boolean argument' }
      getLogger().info('windows-tweaks', `Capture border set: ${enabled}`)
      return setCaptureBorderAllowed(enabled)
    },
  )
}
