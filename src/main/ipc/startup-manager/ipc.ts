import { IPC } from '@shared/channels'
import type { StartupItem } from '@shared/types'
import { ipcMain } from 'electron'
import { getBootTrace } from './boot-trace'
import { deleteStartupItem } from './delete'
import { listStartupItems } from './list'
import { toggleStartupItem } from './toggle'

export function registerStartupManagerIpc(): void {
  ipcMain.handle(IPC.STARTUP_LIST, () => listStartupItems())

  ipcMain.handle(IPC.STARTUP_BOOT_TRACE, () => getBootTrace())

  ipcMain.handle(
    IPC.STARTUP_TOGGLE,
    async (
      _event,
      name: string,
      location: string,
      command: string,
      source: StartupItem['source'],
      enabled: boolean,
    ) => {
      return toggleStartupItem(name, location, command, source, enabled)
    },
  )

  ipcMain.handle(IPC.STARTUP_DELETE, async (_event, name: string, location: string, source: StartupItem['source']) => {
    return deleteStartupItem(name, location, source)
  })
}
