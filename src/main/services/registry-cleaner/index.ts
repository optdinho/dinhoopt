export { scanSystemHealth } from './scanner-system-health'
export { scanComOle } from './scanner-com-ole'
export { scanSecurity } from './scanner-security'
export { scanNetwork } from './scanner-network'
export { scanPerformance } from './scanner-performance'
export { scanScheduledTasks } from './scanner-tasks'
export { fixRegistryEntries } from './fixer'
export {
  execReg,
  splitTaskPath,
  expandEnvVars,
  extractExePath,
  clsidExists,
  findMissingClsidDll,
  stripRegHeader,
  SAFE_TASK_PATH_RE,
} from './utils'
export { collectBackupTargets, createFullBackup, createTargetedBackup, pruneOldBackups } from './backup'

import type { RegistryEntry } from '@shared/types'
import { scanSystemHealth } from './scanner-system-health'
import { scanComOle } from './scanner-com-ole'
import { scanSecurity } from './scanner-security'
import { scanNetwork } from './scanner-network'
import { scanPerformance } from './scanner-performance'
import { scanScheduledTasks } from './scanner-tasks'

export async function scanRegistry(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const checkAborted = (): void => {
    if (signal?.aborted) throw new Error('Operation cancelled')
  }

  const entries: RegistryEntry[] = []

  checkAborted()
  entries.push(...await scanSystemHealth(signal))

  checkAborted()
  entries.push(...await scanComOle(signal))

  checkAborted()
  entries.push(...await scanSecurity(signal))

  checkAborted()
  entries.push(...await scanNetwork(signal))

  checkAborted()
  entries.push(...await scanPerformance(signal))

  checkAborted()
  entries.push(...await scanScheduledTasks(signal))

  return entries
}
