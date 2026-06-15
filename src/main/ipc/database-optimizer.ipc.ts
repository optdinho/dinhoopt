import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { IPC } from '@shared/channels'
import { ipcMain } from 'electron'

type DatabaseConstructor = typeof import('better-sqlite3')

let databaseModule: DatabaseConstructor | null = null
let databasePromise: Promise<DatabaseConstructor | null> | null = null

async function getDatabase(): Promise<DatabaseConstructor | null> {
  if (databaseModule) return databaseModule
  if (databasePromise) return databasePromise
  databasePromise = (async () => {
    try {
      const mod = await import('better-sqlite3')
      databaseModule = mod.default as unknown as DatabaseConstructor
      return databaseModule
    } catch {
      return null
    }
  })()
  return databasePromise
}
import { CleanerType } from '@shared/enums'
import type { CleanError, CleanResult, ScanItem, ScanResult } from '@shared/types'
import { getPlatform } from '../platform'
import type { DatabaseTarget } from '../platform/types'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems, getCachedItem } from '../services/scan-cache'
import type { WindowGetter } from './index'

/** Check if a file is a valid SQLite database by reading the magic header */
function isSqliteFile(filePath: string): boolean {
  let fd: number | undefined
  try {
    fd = fs.openSync(filePath, 'r')
    const buf = Buffer.alloc(16)
    fs.readSync(fd, buf, 0, 16, 0)
    return buf.toString('utf8', 0, 16) === 'SQLite format 3\0'
  } catch {
    return false
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

/** Resolve profile directories for multi-profile apps (Chromium, Firefox) */
function resolveProfileDirs(basePath: string, target: DatabaseTarget): string[] {
  if (!target.multiProfile) return [basePath]
  try {
    const entries = fs.readdirSync(basePath, { withFileTypes: true })
    const dirs: string[] = []
    if (target.profilePattern) {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        for (const pattern of target.profilePattern) {
          const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
          if (new RegExp(`^${escaped}$`).test(entry.name)) {
            dirs.push(path.join(basePath, entry.name))
            break
          }
        }
      }
    } else {
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (entry.name === 'Default' || /^Profile \d+$/.test(entry.name)) {
          dirs.push(path.join(basePath, entry.name))
        }
      }
    }
    return dirs.length > 0 ? dirs : [basePath]
  } catch {
    return [basePath]
  }
}

export function registerDatabaseOptimizerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DATABASE_SCAN, async (): Promise<ScanResult[]> => {
    getLogger().info('database-optimizer', 'Starting database scan...')
    const results: ScanResult[] = []
    const category = CleanerType.Database
    const targets = getPlatform().paths.databaseOptimizeTargets()

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]!

      try {
        if (!fs.existsSync(target.basePath)) continue

        const profileDirs = resolveProfileDirs(target.basePath, target)
        const items: ScanItem[] = []

        for (const profileDir of profileDirs) {
          for (const dbFile of target.dbFiles) {
            const dbPath = path.join(profileDir, dbFile)

            // Fast scan: just stat the file + WAL, check the SQLite header.
            // No need to open the database — estimate reclaimable space from
            // file sizes. VACUUM typically reclaims 5-20% of the main DB
            // plus the entire WAL file.
            try {
              const stat = fs.statSync(dbPath)
              if (stat.size === 0) continue
              if (!isSqliteFile(dbPath)) continue

              let walSize = 0
              try {
                walSize = fs.statSync(`${dbPath}-wal`).size
              } catch {
                /* no WAL */
              }

              // Estimate: WAL is fully reclaimable, plus ~10% of the main DB
              // for internal fragmentation / freelist pages
              const estimatedWaste = walSize + Math.floor(stat.size * 0.1)
              if (estimatedWaste < 4096) continue

              items.push({
                id: crypto.randomUUID(),
                path: dbPath,
                size: estimatedWaste,
                category,
                subcategory: target.label,
                lastModified: stat.mtimeMs,
                selected: true,
              })
            } catch {
              getLogger().warning('database-optimizer', `Skipped inaccessible db: ${dbPath}`)
            }
          }
        }

        if (items.length > 0) {
          cacheItems(items)
          results.push({
            category,
            subcategory: target.label,
            items,
            totalSize: items.reduce((s, item) => s + item.size, 0),
            itemCount: items.length,
          })
        }
      } catch {
        getLogger().warning('database-optimizer', `Skipped inaccessible target: ${target.basePath}`)
      }

      const win = getWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'scanning',
          category,
          currentPath: target.basePath,
          progress: ((i + 1) / targets.length) * 100,
          itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
          sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
        })
      }
    }

    getLogger().success('database-optimizer', `Database scan completed: ${results.length} categories found`)
    return results
  })

  ipcMain.handle(IPC.DATABASE_CLEAN, async (_event, itemIds: string[]): Promise<CleanResult> => {
    getLogger().info('database-optimizer', 'Starting database clean...')
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('database-optimizer', 'Invalid item IDs provided for database clean')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }

    const Database = await getDatabase()
    if (!Database) {
      getLogger().error('database-optimizer', 'better-sqlite3 module not available for database clean')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }

    let totalCleaned = 0
    let filesDeleted = 0
    let filesSkipped = 0
    const errors: CleanError[] = []
    let lastReport = 0

    for (let i = 0; i < valid.length; i++) {
      const id = valid[i]!
      const item = getCachedItem(id)

      if (item) {
        // Yield between each VACUUM so the main thread stays responsive
        await new Promise((resolve) => setTimeout(resolve, 0))

        try {
          const sizeBefore = fs.statSync(item.path).size
          let walSizeBefore = 0
          try {
            walSizeBefore = fs.statSync(`${item.path}-wal`).size
          } catch {
            /* no WAL */
          }

          const db = new Database(item.path, { fileMustExist: true })
          try {
            const journalMode = (db.pragma('journal_mode', { simple: true }) as string).toLowerCase()
            db.exec('VACUUM')
            if (journalMode === 'wal') {
              db.pragma('journal_mode = WAL')
            }
          } finally {
            db.close()
          }

          const sizeAfter = fs.statSync(item.path).size
          let walSizeAfter = 0
          try {
            walSizeAfter = fs.statSync(`${item.path}-wal`).size
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
            getLogger().error('database-optimizer', `Database in use, skipped: ${item.path}`)
          } else if (code === 'EPERM' || code === 'EACCES') {
            errors.push({ path: item.path, reason: 'permission-denied' })
            getLogger().error('database-optimizer', `Permission denied for database: ${item.path}`)
          } else {
            const msg = (err as Error).message || 'unknown error'
            errors.push({ path: item.path, reason: msg })
            getLogger().error('database-optimizer', `Database clean error for ${item.path}`, msg)
          }
        }
      }

      const now = Date.now()
      if (now - lastReport > 120 || i === valid.length - 1) {
        lastReport = now
        const win = getWindow()
        if (win && !win.isDestroyed())
          win.webContents.send(IPC.SCAN_PROGRESS, {
            phase: 'cleaning',
            category: CleanerType.Database,
            currentPath: item?.path ?? '',
            progress: ((i + 1) / valid.length) * 100,
            itemsFound: valid.length,
            sizeFound: totalCleaned,
          })
      }
    }

    getLogger().success(
      'database-optimizer',
      `Database clean completed: ${filesDeleted} files cleaned, ${totalCleaned} bytes reclaimed`,
    )
    return {
      totalCleaned,
      filesDeleted,
      filesSkipped,
      errors,
      needsElevation: errors.some((e) => e.reason === 'permission-denied'),
    }
  })
}
