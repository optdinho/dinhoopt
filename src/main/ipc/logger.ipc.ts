import { IPC } from '@shared/channels'
import type { LogConfig, LogFilter } from '@shared/types'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'

export function registerLoggerIpc(): void {
  const logger = getLogger()

  ipcMain.handle(IPC.LOGS_LIST, async (_event, filter?: LogFilter, page?: number, pageSize?: number) => {
    return logger.list(filter, page, pageSize)
  })

  ipcMain.handle(IPC.LOGS_CLEAR, async () => {
    await logger.clear()
  })

  ipcMain.handle(IPC.LOGS_EXPORT, async (_event, filter?: LogFilter) => {
    return logger.exportAsText(filter)
  })

  ipcMain.handle(IPC.LOGS_CONFIG_GET, async () => {
    return logger.getConfig()
  })

  ipcMain.handle(IPC.LOGS_CONFIG_SET, async (_event, config: LogConfig) => {
    if (!config || typeof config.retentionDays !== 'number') return
    await logger.setConfig(config)
  })
}
