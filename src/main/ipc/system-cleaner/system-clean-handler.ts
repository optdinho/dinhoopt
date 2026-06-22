import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult } from '@shared/types'
import { cleanItems } from '../../services/file-utils'
import { validateStringArray } from '../../services/ipc-validation'
import { getLogger } from '../../services/logger.service'
import type { WindowGetter } from '../index'

export async function handleSystemClean(getWindow: WindowGetter, itemIds: string[]): Promise<CleanResult> {
  const logger = getLogger()
  const valid = validateStringArray(itemIds)
  if (!valid) {
    logger.warning('system-cleaner', 'Clean called with invalid item IDs')
    return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
  }
  logger.info('system-cleaner', `Cleaning ${valid.length} item(s)...`)
  const result = await cleanItems(valid, (processed, total, currentPath, cleanedSize) => {
    const win = getWindow()
    if (win && !win.isDestroyed())
      win.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'cleaning',
        category: CleanerType.System,
        currentPath,
        progress: (processed / total) * 100,
        itemsFound: total,
        sizeFound: cleanedSize,
      })
  })
  logger.success(
    'system-cleaner',
    `Cleaned ${result.filesDeleted} file(s) (${(result.totalCleaned / 1024 / 1024).toFixed(1)} MB)`,
  )
  return result
}
