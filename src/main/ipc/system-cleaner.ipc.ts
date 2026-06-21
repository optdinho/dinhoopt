import { homedir } from 'node:os'
import path from 'node:path'
import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { isAdmin } from '../services/elevation'
import {
  cleanItems,
  resolveChildSubdirs,
  scanDirectory,
  scanFile,
  scanMultipleDirectories,
  scanWithFileMask,
} from '../services/file-utils'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems } from '../services/scan-cache'
import type { WindowGetter } from './index'
import { getImportedRules } from './winapp2-rules-store'

function resolveWinapp2Path(template: string): string {
  const home = homedir()
  const vars: Record<string, string> = {
    LOCALAPPDATA: process.env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'),
    APPDATA: process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'),
    WINDIR: process.env.WINDIR || 'C:\\Windows',
    PROGRAMDATA: process.env.ProgramData || 'C:\\ProgramData',
    PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files',
    PROGRAMFILES_X86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    HOME: home,
    SYSTEMDRIVE: process.env.SystemDrive || 'C:',
  }
  const withBrace = template.replace(/\$\{(\w+)\}/g, (_, name) => vars[name] || '')
  const withPercent = withBrace.replace(
    /%(\w+)%/g,
    (_, name) => vars[name.toUpperCase()] || process.env[name.toUpperCase()] || '',
  )
  return path.win32.normalize(withPercent)
}

export function registerSystemCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.SYSTEM_SCAN, async (): Promise<ScanResult[]> => {
    const logger = getLogger()
    logger.info('system-cleaner', 'Scanning system junk...')
    const results: ScanResult[] = []
    const category = CleanerType.System

    const elevated = isAdmin()
    const platform = getPlatform()
    const targets = platform.paths.systemCleanTargets()
    const protectedEventLogs = platform.paths.protectedEventLogs()

    const eventLogsTarget = targets.find((t) => t.subcategory === 'Event Log Archives')

    const skippedForElevation: string[] = []

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      if (!target) continue

      if (target.needsAdmin && !elevated) {
        skippedForElevation.push(target.subcategory)
        continue
      }

      try {
        let result: ScanResult
        if (target.childSubdir) {
          const childPaths = await resolveChildSubdirs([target.path], target.childSubdir)
          result = await scanMultipleDirectories(childPaths, category, target.subcategory)
        } else {
          result = await scanDirectory(target.path, category, target.subcategory)
        }

        if (eventLogsTarget && target.path === eventLogsTarget.path) {
          result.items = result.items.filter((item) => {
            const fileName = item.path.split(/[\\/]/).pop()?.toLowerCase() || ''
            return !protectedEventLogs.some((p) => fileName === p)
          })
          result.totalSize = result.items.reduce((s, item) => s + item.size, 0)
          result.itemCount = result.items.length
        }

        if (result.items.length > 0) {
          cacheItems(result.items)
          results.push(result)
        }

        const win = getWindow()
        if (win && !win.isDestroyed())
          win.webContents.send(IPC.SCAN_PROGRESS, {
            phase: 'scanning',
            category,
            currentPath: target.path,
            progress: ((i + 1) / targets.length) * 100,
            itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
            sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
          })
      } catch {
        getLogger().warning('system-cleaner', `Skipped inaccessible target: ${target.path}`)
      }
    }

    for (const target of platform.paths.singleFileCleanTargets()) {
      try {
        const dumpResult = await scanFile(target.path, category, target.subcategory)
        if (dumpResult.items.length > 0) {
          cacheItems(dumpResult.items)
          results.push(dumpResult)
        }
      } catch {
        getLogger().warning('system-cleaner', `Single file target not present: ${target.path}`)
      }
    }

    // Scan imported Winapp2 rules (if any)
    const importedRules = getImportedRules()
    for (const rule of importedRules) {
      try {
        const resolvedPath = resolveWinapp2Path(rule.path)
        const ruleResult = await scanWithFileMask(resolvedPath, rule.fileMask, rule.recurse, category, rule.subcategory)
        if (ruleResult.items.length > 0) {
          cacheItems(ruleResult.items)
          results.push(ruleResult)
        }
      } catch {
        getLogger().warning('system-cleaner', `Skipped Winapp2 target: ${rule.path}`)
      }
    }

    if (skippedForElevation.length > 0) {
      results.push({
        category,
        subcategory: '__elevation_required',
        items: [],
        totalSize: 0,
        itemCount: 0,
        group: skippedForElevation.join(', '),
      })
    }

    const totalItems = results.reduce((s, r) => s + r.itemCount, 0)
    const totalSize = results.reduce((s, r) => s + r.totalSize, 0)
    logger.success(
      'system-cleaner',
      `Scan complete — ${totalItems} items found (${(totalSize / 1024 / 1024).toFixed(1)} MB)`,
    )
    return results
  })

  ipcMain.handle(IPC.SYSTEM_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
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
  })
}
