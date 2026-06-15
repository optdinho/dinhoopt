import { IPC } from '@shared/channels'
import type { UpdateCheckResult, UpdateProgress, UpdateResult } from '@shared/types'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'
import { checkForUpdates, runUpdates } from '../services/software-updater'
import type { WindowGetter } from './index'

export function registerSoftwareUpdaterIpc(getWindow: WindowGetter): void {
  const sendProgress = (data: UpdateProgress): void => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(IPC.SOFTWARE_UPDATE_PROGRESS, data)
  }

  ipcMain.handle(IPC.SOFTWARE_UPDATE_CHECK, async (): Promise<UpdateCheckResult> => {
    const logger = getLogger()
    logger.info('software-updater', 'Starting update check')
    try {
      const result = await checkForUpdates()
      logger.success('software-updater', `Update check complete: ${result.apps.length} updates available`)
      return result
    } catch (err) {
      logger.error('software-updater', `Update check failed: ${err instanceof Error ? err.message : String(err)}`)
      return { apps: [], totalCount: 0, majorCount: 0, minorCount: 0, patchCount: 0, packageManagerAvailable: false, packageManagerName: null }
    }
  })

  ipcMain.handle(IPC.SOFTWARE_UPDATE_RUN, async (_event, appIds: string[], source?: string): Promise<UpdateResult> => {
    getLogger().info('software-updater', `Running updates for ${appIds?.length ?? 0} apps`)
    if (!Array.isArray(appIds) || appIds.length === 0) {
      getLogger().warning('software-updater', 'No app IDs provided for update')
      return { succeeded: 0, failed: 0, errors: [] }
    }
    const safeIds = appIds.filter((id) => typeof id === 'string' && id.length > 0 && id.length < 200)
    const safeSource = typeof source === 'string' ? source : undefined
    const result = await runUpdates(safeIds, sendProgress, safeSource)
    getLogger().success('software-updater', `Updates complete: ${result.succeeded} succeeded, ${result.failed} failed`)
    return result
  })
}
