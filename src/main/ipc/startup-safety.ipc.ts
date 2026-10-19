import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

export function registerStartupSafetyIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.STARTUP_SAFETY_FETCH, (event) => {
    if (!validateSender(event, getWindow())) return { ratings: [], pending: 0 }
    getLogger().info('startup-safety', 'Fetching startup safety ratings')
    // NOTE: offline — depends on external safety rating service
    return { ratings: [], pending: 0 }
  })
}
