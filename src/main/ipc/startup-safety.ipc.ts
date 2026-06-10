import { ipcMain } from 'electron'
import { IPC } from '@shared/channels'

export function registerStartupSafetyIpc(): void {
  ipcMain.handle(IPC.STARTUP_SAFETY_FETCH, async () => {
    return { ratings: [], pending: 0 }
  })
}
