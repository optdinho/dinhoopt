import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { cleanItems, resolveChildSubdirs, scanMultipleDirectories } from '../services/file-utils'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems } from '../services/scan-cache'
import type { WindowGetter } from './index'

export function registerAppCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.APP_SCAN, async (): Promise<ScanResult[]> => {
    getLogger().info('app-cleaner', 'Starting app scan...')
    const results: ScanResult[] = []
    const category = CleanerType.App

    for (const app of getPlatform().paths.appPaths()) {
      try {
        const paths = await resolveChildSubdirs(app.paths, app.childSubdir)
        const result = await scanMultipleDirectories(paths, category, app.name)
        if (result.items.length > 0) {
          cacheItems(result.items)
          results.push(result)
        }
      } catch {
        getLogger().warning('app-cleaner', `Skipped inaccessible app path: ${app.name}`)
      }
    }

    const win = getWindow()
    if (win && !win.isDestroyed())
      win.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category,
        currentPath: 'App scan complete',
        progress: 100,
        itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
        sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
      })

    getLogger().success('app-cleaner', 'App scan completed')
    return results
  })

  ipcMain.handle(IPC.APP_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    getLogger().info('app-cleaner', 'Starting app clean...')
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('app-cleaner', 'Invalid item IDs received for app clean')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }
    return cleanItems(valid, (processed, total, currentPath, cleanedSize) => {
      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'cleaning',
          category: CleanerType.App,
          currentPath,
          progress: (processed / total) * 100,
          itemsFound: total,
          sizeFound: cleanedSize,
        })
    }).then((result) => {
      getLogger().success(
        'app-cleaner',
        `App clean completed — ${result.totalCleaned} bytes cleaned, ${result.filesDeleted} files deleted`,
      )
      return result
    })
  })
}
