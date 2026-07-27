export { collectBackupTargets, createFullBackup, createTargetedBackup, pruneOldBackups } from './backup'
export { fixRegistryEntries } from './fixer'
export { scanComOle } from './scanner-com-ole'
export { scanNetwork } from './scanner-network'
export { scanPerformance } from './scanner-performance'
export { scanSecurity } from './scanner-security'
export { scanSystemHealth } from './scanner-system-health'
export { scanScheduledTasks } from './scanner-tasks'
export {
  clsidExists,
  execReg,
  expandEnvVars,
  extractExePath,
  findMissingClsidDll,
  SAFE_TASK_PATH_RE,
  splitTaskPath,
  stripRegHeader,
} from './utils'

import type { RegistryEntry } from '@shared/types'
import { scanComOle } from './scanner-com-ole'
import { scanNetwork } from './scanner-network'
import { scanPerformance } from './scanner-performance'
import { scanSecurity } from './scanner-security'
import { scanSystemHealth } from './scanner-system-health'
import { scanScheduledTasks } from './scanner-tasks'

export async function scanRegistry(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const checkAborted = (): void => {
    if (signal?.aborted) throw new Error('Operation cancelled')
  }

  const entries: RegistryEntry[] = []

  checkAborted()
  entries.push(...(await scanSystemHealth(signal)))

  checkAborted()
  entries.push(...(await scanComOle(signal)))

  checkAborted()
  entries.push(...(await scanSecurity(signal)))

  checkAborted()
  entries.push(...(await scanNetwork(signal)))

  checkAborted()
  entries.push(...(await scanPerformance(signal)))

  checkAborted()
  entries.push(...(await scanScheduledTasks(signal)))

  return entries
}
