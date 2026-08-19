import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { activateLicense, checkLicense, getHwid } from '../services/remote-license'

const MAX_LICENSE_KEY_LENGTH = 49

export function registerLicenseIpc(): void {
  ipcMain.handle(IPC.LICENSE_ACTIVATE, async (_event, key: unknown) => {
    if (typeof key !== 'string' || !key.trim()) return { valid: false, reason: 'Chave inválida' }
    if (key.length > MAX_LICENSE_KEY_LENGTH) return { valid: false, reason: 'Chave muito longa' }
    return activateLicense(key)
  })

  ipcMain.handle(IPC.LICENSE_STATUS, async () => {
    return checkLicense()
  })

  ipcMain.handle(IPC.LICENSE_GET_HWID, async () => {
    return getHwid()
  })
}
