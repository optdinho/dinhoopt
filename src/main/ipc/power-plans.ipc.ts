import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'
import { activatePowerPlan, createPowerPlan, deletePowerPlan, listPowerPlans } from '../services/power-plans'

export function registerPowerPlansIpc(): void {
  ipcMain.handle(IPC.POWER_PLANS_LIST, async () => {
    getLogger().info('power-plans', 'Listing power plans...')
    return listPowerPlans()
  })

  ipcMain.handle(IPC.POWER_PLANS_ACTIVATE, async (_event, guid: unknown) => {
    getLogger().info('power-plans', 'Activating power plan...')
    if (typeof guid !== 'string') {
      getLogger().warning('power-plans', 'Invalid GUID provided for activation')
      return { success: false, error: 'Invalid GUID' }
    }
    return activatePowerPlan(guid)
  })

  ipcMain.handle(IPC.POWER_PLANS_CREATE, async (_event, name: unknown) => {
    getLogger().info('power-plans', 'Creating power plan...')
    if (typeof name !== 'string') {
      getLogger().warning('power-plans', 'Invalid name provided for power plan creation')
      return { success: false, error: 'Invalid name' }
    }
    return createPowerPlan(name)
  })

  ipcMain.handle(IPC.POWER_PLANS_DELETE, async (_event, guid: unknown) => {
    getLogger().info('power-plans', 'Deleting power plan...')
    if (typeof guid !== 'string') {
      getLogger().warning('power-plans', 'Invalid GUID provided for deletion')
      return { success: false, error: 'Invalid GUID' }
    }
    return deletePowerPlan(guid)
  })
}
