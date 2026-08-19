import { IPC } from '@shared/channels'
import type { StartupItem } from '@shared/types'
import { ipcMain } from 'electron'
import type { WindowGetter } from '../index'
import { validateSender } from '../sender-validation'
import { getBootTrace } from './boot-trace'
import { deleteStartupItem } from './delete'
import { listStartupItems } from './list'
import { toggleStartupItem } from './toggle'

export function registerStartupManagerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.STARTUP_LIST, (event) => {
    if (!validateSender(event, getWindow())) return [] as StartupItem[]
    return listStartupItems()
  })

  ipcMain.handle(IPC.STARTUP_BOOT_TRACE, (event) => {
    if (!validateSender(event, getWindow())) return null
    return getBootTrace()
  })

  ipcMain.handle(
    IPC.STARTUP_TOGGLE,
    async (event, name: string, location: string, command: string, source: StartupItem['source'], enabled: boolean) => {
      if (!validateSender(event, getWindow())) return false
      return toggleStartupItem(name, location, command, source, enabled)
    },
  )

  ipcMain.handle(IPC.STARTUP_DELETE, async (event, name: string, location: string, source: StartupItem['source']) => {
    if (!validateSender(event, getWindow())) return false
    return deleteStartupItem(name, location, source)
  })
}
