import { IPC } from '@shared/channels'
import type { AppInstallerListResult, AppInstallProgress, AppInstallResult } from '@shared/types'
import { ipcMain } from 'electron'
import { cancelAppInstall, installApps, listAvailableApps, resetAppInstallCancel } from '../services/app-installer'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

export function registerAppInstallerIpc(getWindow: WindowGetter): void {
  const sendProgress = (data: AppInstallProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.APP_INSTALLER_PROGRESS, data)
  }

  ipcMain.handle(IPC.APP_INSTALLER_LIST_AVAILABLE, async (event): Promise<AppInstallerListResult> => {
    if (!validateSender(event, getWindow())) return { apps: [], wingetAvailable: false, failure: 'list-failed' }
    const logger = getLogger()
    logger.info('app-installer', 'Listing available apps')
    try {
      const result = await listAvailableApps()
      logger.info('app-installer', `Found ${result.apps.length} apps, winget available: ${result.wingetAvailable}`)
      return result
    } catch (err) {
      logger.error('app-installer', `List failed: ${err instanceof Error ? err.message : String(err)}`)
      return { apps: [], wingetAvailable: false, failure: 'list-failed' }
    }
  })

  ipcMain.handle(IPC.APP_INSTALLER_INSTALL, async (event, appIds: string[]): Promise<AppInstallResult> => {
    if (!validateSender(event, getWindow())) return { succeeded: 0, failed: 0, errors: [] }
    getLogger().info('app-installer', `Installing ${appIds?.length ?? 0} apps`)
    if (!Array.isArray(appIds) || appIds.length === 0) {
      getLogger().warning('app-installer', 'No app IDs provided for install')
      return { succeeded: 0, failed: 0, errors: [] }
    }
    const safeIds = appIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length < 200)
    const result = await installApps(safeIds, sendProgress)
    getLogger().success('app-installer', `Install complete: ${result.succeeded} succeeded, ${result.failed} failed`)
    return result
  })

  ipcMain.handle(IPC.APP_INSTALLER_CANCEL, (event) => {
    if (!validateSender(event, getWindow())) return
    getLogger().info('app-installer', 'Cancel requested')
    cancelAppInstall()
    resetAppInstallCancel()
  })
}
