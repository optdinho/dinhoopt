import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import {
  applyComplianceSettings,
  revertComplianceSettings,
  scanCompliance,
} from '../services/compliance-auditor.service'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'

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
  ipcMain.handle(IPC.COMPLIANCE_SCAN, async () => {
    getLogger().info('compliance-auditor', 'Starting compliance scan')
    const result = await scanCompliance((data) => {
      sendProgress(getWindow(), data)
    })
    getLogger().success(
      'compliance-auditor',
      `Compliance scan complete: ${result?.checks?.length ?? 0} checks evaluated (score: ${result?.score ?? 0})`,
    )
    return result
  })

  ipcMain.handle(IPC.COMPLIANCE_APPLY, async (_event, ids: string[]) => {
    getLogger().info('compliance-auditor', `Applying ${ids?.length ?? 0} compliance settings`)
    const valid = validateStringArray(ids, 100)
    if (!valid) {
      getLogger().warning('compliance-auditor', 'Invalid compliance setting IDs provided')
      return { succeeded: 0, failed: 0, errors: [] }
    }
    const result = await applyComplianceSettings(valid)
    getLogger().success('compliance-auditor', `Applied ${result?.succeeded ?? 0} compliance settings`)
    return result
  })

  ipcMain.handle(IPC.COMPLIANCE_REVERT, async (_event, ids: string[]) => {
    getLogger().info('compliance-auditor', `Reverting ${ids?.length ?? 0} compliance settings`)
    const valid = validateStringArray(ids, 100)
    if (!valid) {
      getLogger().warning('compliance-auditor', 'Invalid compliance setting IDs for revert')
      return { succeeded: 0, failed: 0, errors: [] }
    }
    const result = await revertComplianceSettings(valid)
    getLogger().success('compliance-auditor', `Reverted ${result?.succeeded ?? 0} compliance settings`)
    return result
  })
}
