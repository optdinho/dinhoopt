import { ipcMain } from 'electron'
import { IPC } from '@shared/channels'
import { listPowerPlans, activatePowerPlan, createPowerPlan, deletePowerPlan } from '../services/power-plans'

export function registerPowerPlansIpc(): void {
  ipcMain.handle(IPC.POWER_PLANS_LIST, async () => {
    return listPowerPlans()
  })

  ipcMain.handle(IPC.POWER_PLANS_ACTIVATE, async (_event, guid: unknown) => {
    if (typeof guid !== 'string') return { success: false, error: 'Invalid GUID' }
    return activatePowerPlan(guid)
  })

  ipcMain.handle(IPC.POWER_PLANS_CREATE, async (_event, name: unknown) => {
    if (typeof name !== 'string') return { success: false, error: 'Invalid name' }
    return createPowerPlan(name)
  })

  ipcMain.handle(IPC.POWER_PLANS_DELETE, async (_event, guid: unknown) => {
    if (typeof guid !== 'string') return { success: false, error: 'Invalid GUID' }
    return deletePowerPlan(guid)
  })
}
