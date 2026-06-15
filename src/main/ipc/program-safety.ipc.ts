import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'

export function registerProgramSafetyIpc(): void {
  ipcMain.handle(IPC.PROGRAM_SAFETY_FETCH, async () => {
    getLogger().info('program-safety', 'Fetching program safety ratings')
    // NOTE: offline — depends on external safety rating service
    return { ratings: [], pending: 0 }
  })
}
