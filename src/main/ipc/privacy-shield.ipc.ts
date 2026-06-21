import { IPC } from '@shared/channels'
import { type BrowserWindow, ipcMain } from 'electron'
import { isAdmin } from '../services/elevation'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import {
  PRIVACY_SETTINGS,
  applyPrivacySettings,
  revertPrivacySettings,
  scanPrivacy,
} from '../services/privacy-shield.service'
import type { WindowGetter } from './index'

export { PRIVACY_SETTINGS, scanPrivacy, applyPrivacySettings, revertPrivacySettings }

function sendProgress(win: BrowserWindow | null, data: object): void {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.PRIVACY_PROGRESS, data)
    }
  } catch {
    // Window may have been closed during scan
  }
}

export function registerPrivacyShieldIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.PRIVACY_SCAN, () => {
    getLogger().info('privacy-shield', 'Starting privacy scan...')
    return scanPrivacy((data) => {
      sendProgress(getWindow(), data)
    }).then((result) => {
      getLogger().success('privacy-shield', `Privacy scan completed — ${result.settings.length} setting(s) found`)
      return result
    })
  })

  ipcMain.handle(IPC.PRIVACY_APPLY, async (_event, ids: string[]) => {
    getLogger().info('privacy-shield', `Starting privacy apply for ${ids.length} setting(s)...`)
    if (!isAdmin()) {
      getLogger().warning('privacy-shield', 'Admin elevation required for privacy apply')
      return { succeeded: 0, failed: ids.length, errors: [] }
    }
    const valid = validateStringArray(ids, 1_000)
    if (!valid) {
      getLogger().warning('privacy-shield', 'Invalid IDs received for privacy apply')
      return { succeeded: 0, failed: 0, errors: [] }
    }
    return applyPrivacySettings(valid).then((result) => {
      if (result.failed > 0) {
        getLogger().error(
          'privacy-shield',
          `Privacy apply completed with ${result.failed} failure(s) — ${result.succeeded} succeeded`,
        )
      } else {
        getLogger().success('privacy-shield', `Privacy apply completed — ${result.succeeded} setting(s) applied`)
      }
      return result
    })
  })

  ipcMain.handle(IPC.PRIVACY_REVERT, async (_event, ids: string[]) => {
    getLogger().info('privacy-shield', `Starting privacy revert for ${ids.length} setting(s)...`)
    if (!isAdmin()) {
      getLogger().warning('privacy-shield', 'Admin elevation required for privacy revert')
      return { succeeded: 0, failed: ids.length, errors: [] }
    }
    const valid = validateStringArray(ids, 1_000)
    if (!valid) {
      getLogger().warning('privacy-shield', 'Invalid IDs received for privacy revert')
      return { succeeded: 0, failed: 0, errors: [] }
    }
    return revertPrivacySettings(valid).then((result) => {
      if (result.failed > 0) {
        getLogger().error(
          'privacy-shield',
          `Privacy revert completed with ${result.failed} failure(s) — ${result.succeeded} succeeded`,
        )
      } else {
        getLogger().success('privacy-shield', `Privacy revert completed — ${result.succeeded} setting(s) reverted`)
      }
      return result
    })
  })
}
