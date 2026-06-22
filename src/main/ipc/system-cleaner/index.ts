import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import type { WindowGetter } from '../index'
import { handleSystemClean } from './system-clean-handler'
import { handleSystemScan } from './system-scan-handler'

export function registerSystemCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.SYSTEM_SCAN, async () => handleSystemScan(getWindow))
  ipcMain.handle(IPC.SYSTEM_CLEAN, async (_event, itemIds: string[]) => handleSystemClean(getWindow, itemIds))
}
