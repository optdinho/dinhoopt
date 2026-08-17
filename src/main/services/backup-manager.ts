import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { app } from 'electron'
import { getLogger } from './logger.service'

let backupDir: string

export function initBackupManager(): void {
  backupDir = join(app.getPath('userData'), 'backups')
  mkdirSync(backupDir, { recursive: true })
}

export function backupFile(sourcePath: string): string | null {
  if (!existsSync(sourcePath)) return null
  try {
    const timestamp = Date.now()
    const name = sourcePath.replace(/[\\/]/g, '_').replace(/:/g, '')
    const backupPath = join(backupDir, `${name}_${timestamp}.bak`)
    writeFileSync(backupPath, readFileSync(sourcePath))
    getLogger().info('backup-manager', `Backed up ${basename(sourcePath)} → ${basename(backupPath)}`)
    return backupPath
  } catch (err) {
    getLogger().warning('backup-manager', `Backup failed for ${sourcePath}: ${err}`)
    return null
  }
}

export function getLatestBackup(sourcePath: string): string | null {
  if (!backupDir || !existsSync(backupDir)) return null
  try {
    const prefix = sourcePath.replace(/[\\/]/g, '_').replace(/:/g, '')
    const files = readdirSync(backupDir)
      .filter((f) => f.startsWith(prefix) && f.endsWith('.bak'))
      .sort()
    return files.length > 0 ? join(backupDir, files[files.length - 1]!) : null
  } catch {
    return null
  }
}
