import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getLogger } from './logger.service'

export interface CloudBackupConfig {
  enabled: boolean
  provider: 'local' | 's3' | 'gcs' | 'azure'
  endpoint: string
  bucket: string
  accessKey: string
  encrypted: boolean
  autoBackup: boolean
}

export interface BackupResult {
  success: boolean
  filesCount: number
  totalSize: number
  timestamp: string
  error?: string
}

const BACKUP_DIR = 'quarantine-backup'

export class CloudBackupService {
  private backupDir: string
  private config: CloudBackupConfig

  constructor() {
    const userDataPath = app.getPath('userData')
    this.backupDir = path.join(userDataPath, BACKUP_DIR)
    this.config = this.loadConfig()
    this.ensureDirs()
  }

  private ensureDirs(): void {
    if (!existsSync(this.backupDir)) {
      mkdirSync(this.backupDir, { recursive: true })
    }
  }

  private loadConfig(): CloudBackupConfig {
    const configPath = path.join(this.backupDir, 'config.json')
    try {
      if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, 'utf-8'))
      }
    } catch (err) {
      getLogger().error('cloud-backup', 'Failed to load backup config', String(err))
    }
    return {
      enabled: false,
      provider: 'local',
      endpoint: '',
      bucket: 'dinho-quarantine',
      accessKey: '',
      encrypted: true,
      autoBackup: false,
    }
  }

  private saveConfig(): void {
    const configPath = path.join(this.backupDir, 'config.json')
    writeFileSync(configPath, JSON.stringify(this.config, null, 2), 'utf-8')
  }

  getConfig(): CloudBackupConfig {
    return { ...this.config }
  }

  updateConfig(updates: Partial<CloudBackupConfig>): CloudBackupConfig {
    this.config = { ...this.config, ...updates }
    this.saveConfig()
    return this.getConfig()
  }

  async backupFile(sourcePath: string, fileName: string): Promise<boolean> {
    if (!this.config.enabled) return false
    try {
      const content = readFileSync(sourcePath)
      const destPath = path.join(this.backupDir, `${Date.now()}-${fileName}`)
      writeFileSync(destPath, content)
      const metaPath = `${destPath}.meta.json`
      writeFileSync(
        metaPath,
        JSON.stringify(
          {
            originalPath: sourcePath,
            backedUpAt: new Date().toISOString(),
            size: content.length,
            hash: createHash('sha256').update(content).digest('hex'),
          },
          null,
          2,
        ),
      )
      return true
    } catch (err) {
      getLogger().error('cloud-backup', 'Backup failed', String(err))
      return false
    }
  }

  async backupAll(quarantineDir: string): Promise<BackupResult> {
    const files = readdirSync(quarantineDir).filter((f) => f.endsWith('.quarantined'))
    let successCount = 0
    let totalSize = 0

    for (const file of files) {
      const fullPath = path.join(quarantineDir, file)
      try {
        const content = readFileSync(fullPath)
        totalSize += content.length
        await this.backupFile(fullPath, file)
        successCount++
      } catch (err) {
        getLogger().error('cloud-backup', `Failed to backup ${file}`, String(err))
      }
    }

    return {
      success: successCount > 0,
      filesCount: successCount,
      totalSize,
      timestamp: new Date().toISOString(),
    }
  }

  restoreBackup(backupId: string, destPath: string): boolean {
    const backupFile = path.join(this.backupDir, backupId)
    if (!existsSync(backupFile)) return false
    try {
      const content = readFileSync(backupFile)
      writeFileSync(destPath, content)
      return true
    } catch (err) {
      getLogger().error('cloud-backup', 'Restore backup failed', String(err))
      return false
    }
  }

  getBackups(): { name: string; size: number; date: string }[] {
    this.ensureDirs()
    return readdirSync(this.backupDir)
      .filter((f) => !f.endsWith('.json') && !f.endsWith('.meta.json'))
      .map((name) => {
        const fullPath = path.join(this.backupDir, name)
        const metaPath = `${fullPath}.meta.json`
        try {
          const stat = existsSync(fullPath) ? readFileSync(fullPath).length : 0
          const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf-8')) : null
          return { name, size: stat, date: meta?.backedUpAt || new Date().toISOString() }
        } catch {
          return { name, size: 0, date: new Date().toISOString() }
        }
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }

  getStorageUsed(): number {
    this.ensureDirs()
    return readdirSync(this.backupDir)
      .filter((f) => !f.endsWith('.json'))
      .reduce((total, f) => {
        try {
          return total + readFileSync(path.join(this.backupDir, f)).length
        } catch {
          return total
        }
      }, 0)
  }
}

let _instance: CloudBackupService | null = null
export function getCloudBackupService(): CloudBackupService {
  if (!_instance) _instance = new CloudBackupService()
  return _instance
}
