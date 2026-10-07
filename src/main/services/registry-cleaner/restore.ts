import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { RegistryBackupInfo, RegistryBackupKind } from '@shared/types'
import { getBackupDir, resolveBackupPath } from '../backup-dir'
import { getLogger } from '../logger.service'
import { execReg } from './utils'

const TS_RE = /(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/

function classifyBackup(name: string): RegistryBackupKind | null {
  if (name.startsWith('registry-backup-targeted-')) return 'targeted'
  if (name.startsWith('registry-backup-tasks-')) return 'tasks'
  if (/^registry-backup-(HKCU|SYSTEM|HKCR-CLSID|HKCR-Interface|HKCR-MIME)-/.test(name)) return 'hive'
  if (name.includes('-shellex-')) return 'shell'
  if (name.startsWith('registry-backup-')) return 'full'
  return null
}

function dirSize(dir: string): number {
  let total = 0
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name)
    total += statSync(abs).isDirectory() ? dirSize(abs) : statSync(abs).size
  }
  return total
}

export function listRegistryBackups(): RegistryBackupInfo[] {
  try {
    const backupDir = getBackupDir()
    const items: RegistryBackupInfo[] = []
    for (const name of readdirSync(backupDir)) {
      const match = name.match(TS_RE)
      if (!match) continue
      const kind = classifyBackup(name)
      if (!kind) continue
      const abs = join(backupDir, name)
      let size = 0
      try {
        size = statSync(abs).isDirectory() ? dirSize(abs) : statSync(abs).size
      } catch {
        /* skip unreadable entry */
      }
      items.push({ name, timestamp: match[1]!, kind, size })
    }
    items.sort((a, b) => (a.timestamp < b.timestamp ? 1 : a.timestamp > b.timestamp ? -1 : 0))
    return items
  } catch {
    return []
  }
}

export async function restoreRegistryBackup(
  subpath: string,
  signal?: AbortSignal,
): Promise<{ ok: boolean; message?: string }> {
  let resolved: string
  try {
    resolved = resolveBackupPath(subpath)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid backup path'
    getLogger().error('registry-restore', `Restore blocked: ${message}`)
    return { ok: false, message }
  }
  if (!existsSync(resolved)) {
    getLogger().error('registry-restore', `Restore failed: backup not found (${subpath})`)
    return { ok: false, message: `Backup not found: ${subpath}` }
  }
  if (statSync(resolved).isDirectory()) {
    getLogger().warning('registry-restore', 'Restoring scheduled-task backups is not supported yet')
    return { ok: false, message: 'Scheduled-task backup restoration is not supported' }
  }
  try {
    await execReg(['import', resolved], { timeout: 120000, ...(signal ? { signal } : {}) })
    return { ok: true }
  } catch (err: unknown) {
    if (signal?.aborted) throw err
    const detail =
      (err as { stderr?: string; message?: string })?.stderr?.trim() ??
      (err as { message?: string })?.message ??
      'reg import failed'
    getLogger().error('registry-restore', `Restore failed for ${subpath}: ${detail}`)
    return { ok: false, message: detail }
  }
}
