import { IPC } from '@shared/channels'
import type { DefenderExclusionResult, DefenderExclusionStatus } from '@shared/types'
import { ipcMain } from 'electron'
import {
  addDefenderExclusion,
  getDefenderExclusionStatus,
  isValidDefenderExclusionPath,
  removeDefenderExclusion,
} from '../services/defender-exclusions'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

const INVALID_PATH_RESULT: DefenderExclusionResult = { success: false, error: 'Invalid exclusion path' }

export function registerDefenderExclusionsIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DEFENDER_EXCLUSIONS_STATUS, async (event): Promise<DefenderExclusionStatus> => {
    if (!validateSender(event, getWindow())) {
      return { supported: false, tamperProtection: null, exclusions: [] }
    }
    return getDefenderExclusionStatus()
  })

  ipcMain.handle(IPC.DEFENDER_EXCLUSIONS_ADD, async (event, path: unknown): Promise<DefenderExclusionResult> => {
    if (!validateSender(event, getWindow())) return INVALID_PATH_RESULT
    if (!isValidDefenderExclusionPath(path)) {
      getLogger().warning('defender', 'Rejected invalid exclusion path')
      return INVALID_PATH_RESULT
    }
    return addDefenderExclusion(path)
  })

  ipcMain.handle(IPC.DEFENDER_EXCLUSIONS_REMOVE, async (event, path: unknown): Promise<DefenderExclusionResult> => {
    if (!validateSender(event, getWindow())) return INVALID_PATH_RESULT
    if (!isValidDefenderExclusionPath(path)) {
      getLogger().warning('defender', 'Rejected invalid exclusion path')
      return INVALID_PATH_RESULT
    }
    return removeDefenderExclusion(path)
  })
}
