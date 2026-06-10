import { ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import type { WindowGetter } from './index'
import { validateStringArray } from '../services/ipc-validation'
import { scanCompliance, applyComplianceSettings, revertComplianceSettings } from '../services/compliance-auditor.service'

function sendProgress(win: ReturnType<WindowGetter>, data: object): void {
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.COMPLIANCE_PROGRESS, data)
    }
  } catch {
    // Window closed during scan
  }
}

export function registerComplianceAuditorIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.COMPLIANCE_SCAN, () => scanCompliance((data) => {
    sendProgress(getWindow(), data)
  }))

  ipcMain.handle(IPC.COMPLIANCE_APPLY, async (_event, ids: string[]) => {
    const valid = validateStringArray(ids, 100)
    if (!valid) return { succeeded: 0, failed: 0, errors: [] }
    return applyComplianceSettings(valid)
  })

  ipcMain.handle(IPC.COMPLIANCE_REVERT, async (_event, ids: string[]) => {
    const valid = validateStringArray(ids, 100)
    if (!valid) return { succeeded: 0, failed: 0, errors: [] }
    return revertComplianceSettings(valid)
  })
}
