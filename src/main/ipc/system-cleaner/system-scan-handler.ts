import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { ScanResult } from '@shared/types'
import { getPlatform } from '../../platform'
import { isAdmin } from '../../services/elevation'
import {
  resolveChildSubdirs,
  scanDirectory,
  scanFile,
  scanMultipleDirectories,
  scanWithFileMask,
} from '../../services/file-utils'
import { getLogger } from '../../services/logger.service'
import { cacheItems } from '../../services/scan-cache'
import type { WindowGetter } from '../index'
import { getImportedRules } from '../winapp2-rules-store'
import { resolveWinapp2Path } from './resolve-winapp2-path'

export async function handleSystemScan(getWindow: WindowGetter): Promise<ScanResult[]> {
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

  const importedRules = getImportedRules()
  for (const rule of importedRules) {
    try {
      const resolvedPath = resolveWinapp2Path(rule.path)
      const ruleResult = await scanWithFileMask(
        resolvedPath,
        rule.fileMask,
        rule.recurse,
        category,
        rule.subcategory,
        rule.removeSelf,
      )
      let items = ruleResult.items
      // Rules flagged Default=False are offered but not pre-selected.
      if (rule.default === false) {
        items = items.map((item) => ({ ...item, selected: false }))
      }
      if (items.length > 0) {
        cacheItems(items)
        results.push({
          ...ruleResult,
          items,
          totalSize: items.reduce((s, i) => s + i.size, 0),
          itemCount: items.length,
        })
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
}
