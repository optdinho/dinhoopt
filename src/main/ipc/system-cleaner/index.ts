import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import type { WindowGetter } from '../index'
import { validateSender } from '../sender-validation'
import { handleSystemClean } from './system-clean-handler'
import { handleSystemScan } from './system-scan-handler'

export function registerSystemCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.SYSTEM_SCAN, async (event) => {
    if (!validateSender(event, getWindow())) return []
    return handleSystemScan(getWindow)
  })
  ipcMain.handle(IPC.SYSTEM_CLEAN, async (event, itemIds: string[]) => {
    if (!validateSender(event, getWindow())) return { success: false, error: 'Invalid sender' }
    return handleSystemClean(getWindow, itemIds)
  })
}
