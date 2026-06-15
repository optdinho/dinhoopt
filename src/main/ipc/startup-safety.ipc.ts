import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'

export function registerStartupSafetyIpc(): void {
  ipcMain.handle(IPC.STARTUP_SAFETY_FETCH, async () => {
    getLogger().info('startup-safety', 'Fetching startup safety ratings')
    // NOTE: offline — depends on external safety rating service
    return { ratings: [], pending: 0 }
  })
}
