import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import { CleanerType } from '../../../shared/enums'
import type { CleanResult, ScanResult } from '../../../shared/types'
import { getPlatform } from '../../platform'
import { psUtf8 } from '../../services/exec-utf8'
import {
  cleanItems,
  resolveChildSubdirs,
  scanDirectoriesAsItems,
  scanDirectory,
  scanFile,
  scanMultipleDirectories,
} from '../../services/file-utils'
import { cacheItems } from '../../services/scan-cache'
import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliVerbose, formatBytes, log, showProgress } from '../utils'

export async function scanSystem(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.System
  const platform = getPlatform()
  const targets = platform.paths.systemCleanTargets()
  const protectedEventLogs = platform.paths.protectedEventLogs()
  const eventLogsTarget = targets.find((t) => t.subcategory === 'Event Log Archives')

  for (const target of targets) {
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
    } catch {
      /* skip */
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
      /* skip */
    }
  }
  return results
}

export async function scanBrowserCli(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.Browser
  const browserPaths = getPlatform().paths.browserPaths()
  const chromiumBrowsers = [
    { label: 'Chrome', ...browserPaths.chrome, hasProfiles: true },
    { label: 'Edge', ...browserPaths.edge, hasProfiles: true },
    { label: 'Brave', ...browserPaths.brave, hasProfiles: true },
    { label: 'Vivaldi', ...browserPaths.vivaldi, hasProfiles: true },
    { label: 'Opera', ...browserPaths.opera, hasProfiles: false },
    { label: 'Opera GX', ...browserPaths.operaGX, hasProfiles: false },
    { label: 'Arc', ...browserPaths.arc, hasProfiles: true },
    { label: 'Chromium', ...browserPaths.chromium, hasProfiles: true },
    { label: 'Thorium', ...browserPaths.thorium, hasProfiles: true },
    { label: 'Supermium', ...browserPaths.supermium, hasProfiles: true },
    { label: 'Helium', ...browserPaths.helium, hasProfiles: true },
    { label: 'Cromite', ...browserPaths.cromite, hasProfiles: true },
    { label: 'CatsXP', ...browserPaths.catsxp, hasProfiles: true },
  ]
  for (const browser of chromiumBrowsers) {
    if (!existsSync(browser.base)) continue
    if (browser.hasProfiles) {
      const profiles = await getChromiumProfiles(browser.base)
      for (const profile of profiles) {
        for (const { dir, label } of [
          { dir: browser.cache, label: 'Cache' },
          { dir: browser.codeCache, label: 'Code Cache' },
          { dir: browser.gpuCache, label: 'GPU Cache' },
          { dir: browser.serviceWorker, label: 'Service Worker Cache' },
        ]) {
          const cachePath = join(browser.base, profile, dir)
          if (existsSync(cachePath)) {
            const result = await scanDirectory(cachePath, category, `${browser.label} - ${profile} ${label}`)
            if (result.items.length > 0) {
              cacheItems(result.items)
              results.push(result)
            }
          }
        }
      }
    } else {
      for (const { dir, label } of [
        { dir: browser.cache, label: 'Cache' },
        { dir: browser.codeCache, label: 'Code Cache' },
        { dir: browser.gpuCache, label: 'GPU Cache' },
        { dir: browser.serviceWorker, label: 'Service Worker Cache' },
      ]) {
        const cachePath = join(browser.base, dir)
        if (existsSync(cachePath)) {
          const result = await scanDirectory(cachePath, category, `${browser.label} - ${label}`)
          if (result.items.length > 0) {
            cacheItems(result.items)
            results.push(result)
          }
        }
      }
    }
  }
  if (existsSync(browserPaths.firefox.cache)) {
    try {
      const profileDirs = await readdir(browserPaths.firefox.cache, { withFileTypes: true })
      for (const dir of profileDirs) {
        if (dir.isDirectory()) {
          const cachePath = join(browserPaths.firefox.cache, dir.name, 'cache2', 'entries')
          if (existsSync(cachePath)) {
            const result = await scanDirectory(cachePath, category, `Firefox - ${dir.name} Cache`)
            if (result.items.length > 0) {
              cacheItems(result.items)
              results.push(result)
            }
          }
        }
      }
    } catch {
      /* skip */
    }
  }
  const firefoxForks = [
    { label: 'LibreWolf', ...browserPaths.librewolf },
    { label: 'Waterfox', ...browserPaths.waterfox },
    { label: 'Floorp', ...browserPaths.floorp },
  ]
  for (const fork of firefoxForks) {
    if (!fork.cache || !existsSync(fork.cache)) continue
    try {
      const profileDirs = await readdir(fork.cache, { withFileTypes: true })
      for (const dir of profileDirs) {
        if (dir.isDirectory()) {
          const cachePath = join(fork.cache, dir.name, 'cache2')
          if (existsSync(cachePath)) {
            const result = await scanDirectory(cachePath, category, `${fork.label} - ${dir.name} Cache`)
            if (result.items.length > 0) {
              cacheItems(result.items)
              results.push(result)
            }
          }
        }
      }
    } catch {
      /* skip */
    }
  }
  if (browserPaths.safari && existsSync(browserPaths.safari.cache)) {
    const result = await scanDirectory(browserPaths.safari.cache, category, 'Safari - Cache')
    if (result.items.length > 0) {
      cacheItems(result.items)
      results.push(result)
    }
  }
  return results
}

export async function scanApp(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.App
  for (const appDef of getPlatform().paths.appPaths()) {
    try {
      const paths = await resolveChildSubdirs(appDef.paths, appDef.childSubdir)
      const result = await scanMultipleDirectories(paths, category, appDef.name)
      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    } catch {
      /* skip */
    }
  }
  return results
}

export async function scanGaming(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.Gaming
  for (const launcher of getPlatform().paths.gamingPaths()) {
    try {
      const result = await scanDirectoriesAsItems(launcher.paths, category, launcher.name, 'Launcher Caches')
      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    } catch {
      /* skip */
    }
  }
  for (const gpu of getPlatform().paths.gpuCachePaths()) {
    try {
      const result = await scanDirectoriesAsItems(gpu.paths, category, gpu.name, 'GPU Shader Caches')
      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    } catch {
      /* skip */
    }
  }
  return results
}

export async function scanRecycleBin(): Promise<ScanResult[]> {
  const trashPath = getPlatform().paths.trashPath()
  if (trashPath) {
    if (!existsSync(trashPath)) return []
    const result = await scanDirectory(trashPath, CleanerType.RecycleBin, 'Trash', 0)
    if (result.items.length > 0) {
      cacheItems(result.items)
      return [result]
    }
    return []
  }
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  try {
    const rbScript = `$shell = New-Object -ComObject Shell.Application; $rb = $shell.NameSpace(0x0a); $items = $rb.Items(); $count = $items.Count; $size = ($items | Measure-Object -Property Size -Sum).Sum; Write-Output "$count|$size"`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(rbScript)], {
      windowsHide: true,
    })
    const [countStr, sizeStr] = stdout.trim().split('|')
    const count = Number.parseInt(countStr!) || 0
    const size = Number.parseInt(sizeStr!) || 0
    if (count === 0) return []
    const item = {
      id: randomUUID(),
      path: 'Recycle Bin',
      size,
      category: CleanerType.RecycleBin,
      subcategory: 'Recycle Bin',
      lastModified: Date.now(),
      selected: true,
    }
    cacheItems([item])
    return [
      {
        category: CleanerType.RecycleBin,
        subcategory: 'Recycle Bin',
        items: [item],
        totalSize: size,
        itemCount: count,
      },
    ]
  } catch {
    return []
  }
}

export async function scanDatabaseCli(): Promise<ScanResult[]> {
  const results: ScanResult[] = []
  const category = CleanerType.Database
  const targets = getPlatform().paths.databaseOptimizeTargets()
  const { statSync, existsSync: fileExists, readdirSync, openSync, readSync, closeSync } = await import('node:fs')
  const path = await import('node:path')

  function isSqliteFile(filePath: string): boolean {
    let fd: number | undefined
    try {
      fd = openSync(filePath, 'r')
      const buf = Buffer.alloc(16)
      readSync(fd, buf, 0, 16, 0)
      return buf.toString('utf8', 0, 16) === 'SQLite format 3\0'
    } catch {
      return false
    } finally {
      if (fd !== undefined) closeSync(fd)
    }
  }

  for (const target of targets) {
    try {
      if (!fileExists(target.basePath)) continue
      const items: ScanResult['items'] = []

      let profileDirs = [target.basePath]
      if (target.multiProfile) {
        try {
          const entries = readdirSync(target.basePath, { withFileTypes: true })
          const dirs: string[] = []
          if (target.profilePattern) {
            for (const entry of entries) {
              if (!entry.isDirectory()) continue
              for (const pattern of target.profilePattern) {
                const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
                if (new RegExp(`^${escaped}$`).test(entry.name)) {
                  dirs.push(path.join(target.basePath, entry.name))
                  break
                }
              }
            }
          } else {
            for (const entry of entries) {
              if (!entry.isDirectory()) continue
              if (entry.name === 'Default' || /^Profile \d+$/.test(entry.name)) {
                dirs.push(path.join(target.basePath, entry.name))
              }
            }
          }
          if (dirs.length > 0) profileDirs = dirs
        } catch {
          /* use basePath */
        }
      }

      for (const profileDir of profileDirs) {
        for (const dbFile of target.dbFiles) {
          const dbPath = path.join(profileDir, dbFile)
          if (!fileExists(dbPath) || !isSqliteFile(dbPath)) continue
          const fileStat = statSync(dbPath)
          if (fileStat.size === 0) continue

          let walSize = 0
          try {
            walSize = statSync(`${dbPath}-wal`).size
          } catch {
            /* no WAL */
          }
          const wastedBytes = walSize + Math.floor(fileStat.size * 0.1)
          if (wastedBytes < 4096) continue

          items.push({
            id: randomUUID(),
            path: dbPath,
            size: wastedBytes,
            category,
            subcategory: target.label,
            lastModified: fileStat.mtimeMs,
            selected: true,
          })
        }
      }

      if (items.length > 0) {
        cacheItems(items)
        results.push({
          category,
          subcategory: target.label,
          items,
          totalSize: items.reduce((s, i) => s + i.size, 0),
          itemCount: items.length,
        })
      }
    } catch {
      /* skip */
    }
  }
  return results
}

export async function cleanRecycleBin(sizeBytes = 0): Promise<CleanResult> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const execFileAsync = promisify(execFile)
  try {
    const cleanScript =
      '$shell = New-Object -ComObject Shell.Application; $shell.NameSpace(0x0a).Items() | ForEach-Object { Remove-Item $_.Path -Recurse -Force -ErrorAction SilentlyContinue }; Clear-RecycleBin -Force -Confirm:$false -ErrorAction SilentlyContinue'
    await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(cleanScript)], { windowsHide: true })
    return { totalCleaned: sizeBytes, filesDeleted: 1, filesSkipped: 0, errors: [], needsElevation: false }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err)
    return {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [{ path: 'Recycle Bin', reason }],
      needsElevation: false,
    }
  }
}

export async function cleanDatabasesCli(itemIds: string[]): Promise<CleanResult> {
  const { getCachedItem } = await import('../../services/scan-cache')
  const { statSync } = await import('node:fs')
  let Database: new (
    path: string,
    options?: { fileMustExist?: boolean },
  ) => {
    pragma: (key: string, options?: { simple?: boolean }) => unknown
    close: () => void
  }
  try {
    Database = (await import('better-sqlite3')).default
  } catch {
    return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
  }
  let totalCleaned = 0
  let filesDeleted = 0
  let filesSkipped = 0
  const errors: CleanResult['errors'] = []

  for (const id of itemIds) {
    const item = getCachedItem(id)
    if (!item) continue
    try {
      const sizeBefore = statSync(item.path).size
      let walSizeBefore = 0
      try {
        walSizeBefore = statSync(`${item.path}-wal`).size
      } catch {
        /* no WAL */
      }
      const db = new Database(item.path, { fileMustExist: true })
      try {
        const journalMode = (db.pragma('journal_mode', { simple: true }) as string).toLowerCase()
        db.exec('VACUUM')
        if (journalMode === 'wal') db.pragma('journal_mode = WAL')
      } finally {
        db.close()
      }
      const sizeAfter = statSync(item.path).size
      let walSizeAfter = 0
      try {
        walSizeAfter = statSync(`${item.path}-wal`).size
      } catch {
        /* no WAL */
      }
      const reclaimed = sizeBefore + walSizeBefore - (sizeAfter + walSizeAfter)
      if (reclaimed > 0) totalCleaned += reclaimed
      filesDeleted++
    } catch (err: unknown) {
      filesSkipped++
      const code = (err as { code?: string }).code
      if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || code === 'EBUSY') {
        errors.push({ path: item.path, reason: 'in-use' })
      } else if (code === 'EPERM' || code === 'EACCES') {
        errors.push({ path: item.path, reason: 'permission-denied' })
      } else {
        errors.push({ path: item.path, reason: (err as Error).message || 'unknown error' })
      }
    }
  }
  return {
    totalCleaned,
    filesDeleted,
    filesSkipped,
    errors,
    needsElevation: errors.some((e) => e.reason === 'permission-denied'),
  }
}

export async function getChromiumProfiles(basePath: string): Promise<string[]> {
  const profiles = ['Default']
  try {
    const entries = await readdir(basePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Profile ')) profiles.push(entry.name)
    }
  } catch {
    /* skip */
  }
  return profiles
}

export async function runLegacyScanClean(categories: string[], doClean: boolean, ctx: CliContext): Promise<number> {
  const scannerMap: Record<string, () => Promise<ScanResult[]>> = {
    system: scanSystem,
    browser: scanBrowserCli,
    app: scanApp,
    gaming: scanGaming,
    'recycle-bin': scanRecycleBin,
    database: scanDatabaseCli,
  }

  const allResults: ScanResult[] = []
  const scanErrors: Array<{ category: string; error: string }> = []

  cliLog(ctx, `DiNho CLI v${app.getVersion()}`)
  cliLog(ctx, `Scanning: ${categories.join(', ')}`)
  cliLog(ctx, '')

  for (const cat of categories) {
    const scanner = scannerMap[cat]
    if (!scanner) continue
    cliLog(ctx, `Scanning ${cat}...`)
    const startTime = Date.now()
    try {
      const results = await scanner()
      allResults.push(...results)
      cliVerbose(ctx, `${cat} scan took ${Date.now() - startTime}ms, found ${results.length} groups`)
      if (showProgress(ctx)) {
        if (results.length === 0) log('  No items found.')
        else for (const r of results) log(`  ${r.subcategory}: ${r.itemCount} items, ${formatBytes(r.totalSize)}`)
        log('')
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Unknown error'
      scanErrors.push({ category: cat, error: msg })
      cliLog(ctx, `  Error scanning ${cat}: ${msg}`)
      cliLog(ctx, '')
    }
  }

  const totalItems = allResults.reduce((s, r) => s + r.itemCount, 0)
  const totalSize = allResults.reduce((s, r) => s + r.totalSize, 0)

  let cleanResult: CleanResult | null = null
  if (doClean && totalItems > 0) {
    cliLog(ctx, `Cleaning ${totalItems} items (${formatBytes(totalSize)})...`)
    const hasTrashPath = getPlatform().paths.trashPath() !== null
    const fileItemIds = allResults
      .filter((r) => r.category !== CleanerType.RecycleBin || hasTrashPath)
      .filter((r) => r.category !== CleanerType.Database)
      .flatMap((r) => r.items.map((i) => i.id))
    const dbItemIds = allResults
      .filter((r) => r.category === CleanerType.Database)
      .flatMap((r) => r.items.map((i) => i.id))
    const hasRecycleBin = !hasTrashPath && allResults.some((r) => r.category === CleanerType.RecycleBin)
    let fileCleaned: CleanResult = {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    }
    let recycleCleaned: CleanResult = {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    }
    let dbCleaned: CleanResult = {
      totalCleaned: 0,
      filesDeleted: 0,
      filesSkipped: 0,
      errors: [],
      needsElevation: false,
    }
    if (fileItemIds.length > 0) fileCleaned = await cleanItems(fileItemIds)
    if (hasRecycleBin) {
      const rbSize = allResults.find((r) => r.category === CleanerType.RecycleBin)?.totalSize || 0
      recycleCleaned = await cleanRecycleBin(rbSize)
    }
    if (dbItemIds.length > 0) dbCleaned = await cleanDatabasesCli(dbItemIds)
    cleanResult = {
      totalCleaned: fileCleaned.totalCleaned + recycleCleaned.totalCleaned + dbCleaned.totalCleaned,
      filesDeleted: fileCleaned.filesDeleted + recycleCleaned.filesDeleted + dbCleaned.filesDeleted,
      filesSkipped: fileCleaned.filesSkipped + recycleCleaned.filesSkipped + dbCleaned.filesSkipped,
      errors: [...fileCleaned.errors, ...recycleCleaned.errors, ...dbCleaned.errors],
      needsElevation: fileCleaned.needsElevation || recycleCleaned.needsElevation || dbCleaned.needsElevation,
    }
    if (showProgress(ctx)) {
      log(`  Deleted: ${cleanResult.filesDeleted} items (${formatBytes(cleanResult.totalCleaned)})`)
      if (cleanResult.filesSkipped > 0) log(`  Skipped: ${cleanResult.filesSkipped} items`)
      if (cleanResult.errors.length > 0) {
        log(`  Errors: ${cleanResult.errors.length}`)
        for (const err of cleanResult.errors.slice(0, 10)) log(`    ${err.path}: ${err.reason}`)
        if (cleanResult.errors.length > 10) log(`    ... and ${cleanResult.errors.length - 10} more`)
      }
      log('')
    }
  }

  if (ctx.json) {
    const output: Record<string, unknown> = {
      scan: {
        categories,
        results: allResults.map((r) => ({
          category: r.category,
          subcategory: r.subcategory,
          group: r.group || null,
          itemCount: r.itemCount,
          totalSize: r.totalSize,
          items: r.items.map((i) => ({ path: i.path, size: i.size, lastModified: i.lastModified })),
        })),
        totalItems,
        totalSize,
        errors: scanErrors.length > 0 ? scanErrors : undefined,
      },
    }
    if (cleanResult) output.clean = cleanResult
    log(JSON.stringify(output, null, 2))
  } else {
    cliLog(ctx, '─'.repeat(50))
    cliLog(ctx, `Total: ${totalItems} items, ${formatBytes(totalSize)}`)
    if (cleanResult) cliLog(ctx, `Cleaned: ${formatBytes(cleanResult.totalCleaned)}`)
    else if (totalItems > 0) cliLog(ctx, 'Run with --clean to delete these items.')
  }

  if (cleanResult?.errors.length) {
    if (cleanResult.needsElevation) return ExitCode.PERMISSION_DENIED
    if (cleanResult.filesDeleted > 0) return ExitCode.PARTIAL_SUCCESS
    return ExitCode.GENERAL_ERROR
  }
  if (totalItems === 0) return ExitCode.NOTHING_FOUND
  return ExitCode.SUCCESS
}
