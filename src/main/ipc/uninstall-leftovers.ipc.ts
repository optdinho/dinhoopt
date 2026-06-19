import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { cleanItems } from '../services/file-utils'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems } from '../services/scan-cache'
import { scanForLeftovers } from '../services/uninstall-leftovers'
import type { WindowGetter } from './index'

export function registerUninstallLeftoversIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.UNINSTALL_LEFTOVERS_SCAN, async (): Promise<ScanResult[]> => {
    getLogger().info('uninstall-leftovers', 'Starting leftovers scan')
    try {
      const results = await scanForLeftovers(getWindow)

      // Cache all items so the clean handler can look them up by ID
      for (const result of results) {
        cacheItems(result.items)
      }

      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'scanning',
          category: CleanerType.UninstallLeftovers,
          currentPath: 'Uninstall leftovers scan complete',
          progress: 100,
          itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
          sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
        })

      getLogger().success('uninstall-leftovers', `Scan complete: ${results.length} result groups`)
      return results
    } catch (err) {
      getLogger().error('uninstall-leftovers', `Scan failed: ${err}`)
      return []
    }
  })

  ipcMain.handle(IPC.UNINSTALL_LEFTOVERS_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    getLogger().info('uninstall-leftovers', 'Starting leftovers clean')
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('uninstall-leftovers', 'Clean skipped — invalid item IDs')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }

    const win = getWindow()
    const result = await cleanItems(valid, (processed, total, currentPath, cleanedSize) => {
      if (win && !win.isDestroyed())
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'cleaning',
          category: CleanerType.UninstallLeftovers,
          currentPath,
          progress: total > 0 ? Math.round((processed / total) * 100) : 100,
          itemsFound: total,
          sizeFound: cleanedSize,
        })
    })

    if (win && !win.isDestroyed())
      win.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'cleaning',
        category: CleanerType.UninstallLeftovers,
        currentPath: 'Uninstall leftovers clean complete',
        progress: 100,
        itemsFound: valid.length,
        sizeFound: result.totalCleaned,
      })

    getLogger().success('uninstall-leftovers', `Clean complete — ${result.filesDeleted} files deleted`)
    return result
  })
}
