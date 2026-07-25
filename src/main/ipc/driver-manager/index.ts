import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { validateStringArray } from '../../services/ipc-validation'
import { getLogger } from '../../services/logger.service'
import type { WindowGetter } from '../index'
import { cleanDrivers, scanDrivers } from './scan'
import { installDriverUpdates, scanDriverUpdates } from './updates'

export { cleanDrivers, scanDrivers } from './scan'
export { installDriverUpdates, scanDriverUpdates } from './updates'

export function registerDriverManagerIpc(getWindow: WindowGetter): void {
  const sendProgress = (data: import('@shared/types').DriverScanProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.DRIVER_PROGRESS, data)
  }

  const sendUpdateProgress = (data: import('@shared/types').DriverUpdateProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.DRIVER_UPDATE_PROGRESS, data)
  }

  ipcMain.handle(IPC.DRIVER_SCAN, () => scanDrivers(sendProgress))

  ipcMain.handle(IPC.DRIVER_CLEAN, async (_event, publishedNames: string[]) => {
    const valid = validateStringArray(publishedNames, 500)
    if (!valid) {
      getLogger().warning('driver-manager', 'Invalid published names received for driver clean')
      return { removed: 0, failed: 0, spaceRecovered: 0, errors: [] }
    }
    return cleanDrivers(valid)
  })

  ipcMain.handle(IPC.DRIVER_UPDATE_SCAN, () => scanDriverUpdates(sendUpdateProgress))

  ipcMain.handle(IPC.DRIVER_UPDATE_INSTALL, async (_event, wuUpdateIds: string[]) => {
    const valid = validateStringArray(wuUpdateIds, 500)
    if (!valid) {
      getLogger().warning('driver-manager', 'Invalid update IDs received for driver update install')
      return { installed: 0, failed: 0, rebootRequired: false, errors: [] }
    }
    return installDriverUpdates(valid, sendUpdateProgress)
  })
}
