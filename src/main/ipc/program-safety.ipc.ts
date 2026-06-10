import { ipcMain } from 'electron'
import { IPC } from '@shared/channels'

export function registerProgramSafetyIpc(): void {
  ipcMain.handle(IPC.PROGRAM_SAFETY_FETCH, async () => {
    return { ratings: [], pending: 0 }
  })
}
