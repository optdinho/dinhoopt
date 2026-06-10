import { BrowserWindow, ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { WindowGetter } from './index'
import { validateStringArray } from '../services/ipc-validation'
import { PRIVACY_SETTINGS, scanPrivacy, applyPrivacySettings, revertPrivacySettings } from '../services/privacy-shield.service'

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
  ipcMain.handle(IPC.PRIVACY_SCAN, () => scanPrivacy((data) => {
    sendProgress(getWindow(), data)
  }))

  ipcMain.handle(IPC.PRIVACY_APPLY, async (_event, ids: string[]) => {
    const valid = validateStringArray(ids, 1_000)
    if (!valid) return { succeeded: 0, failed: 0, errors: [] }
    return applyPrivacySettings(valid)
  })

  ipcMain.handle(IPC.PRIVACY_REVERT, async (_event, ids: string[]) => {
    const valid = validateStringArray(ids, 1_000)
    if (!valid) return { succeeded: 0, failed: 0, errors: [] }
    return revertPrivacySettings(valid)
  })
}
