import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RegistryEntry } from '@shared/types'
import { execNativeUtf8 } from '../exec-utf8'
import { execReg, splitTaskPath, stripRegHeader } from './utils'

function pruneOldBackups(backupDir: string, keep: number): void {
  try {
    const tsCapture = /(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
    const regRe = new RegExp(`^registry-backup-.*?${tsCapture.source}\\.reg$`)
    const taskDirRe = new RegExp(`^registry-backup-tasks-${tsCapture.source}$`)
    const groups = new Map<string, string[]>()
    for (const f of readdirSync(backupDir)) {
      const m = f.match(regRe) || f.match(taskDirRe)
      if (!m) continue
      const ts = m[1]!
      const list = groups.get(ts) ?? []
      list.push(f)
      groups.set(ts, list)
    }
    const stale = [...groups.keys()].sort().reverse().slice(keep)
    for (const ts of stale) {
      for (const f of groups.get(ts)!) {
        const full = join(backupDir, f)
        try {
          if (taskDirRe.test(f)) rmSync(full, { recursive: true, force: true })
          else unlinkSync(full)
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* skip */
  }
}

async function createFullBackup(backupDir: string, timestamp: string, signal?: AbortSignal): Promise<void> {
  const backupPath = join(backupDir, `registry-backup-${timestamp}.reg`)
  await execReg(['export', 'HKLM\\SOFTWARE', backupPath, '/y'], { timeout: 30000, ...(signal ? { signal } : {}) })
  const hkcuBackupPath = join(backupDir, `registry-backup-HKCU-${timestamp}.reg`)
  await execReg(['export', 'HKCU\\SOFTWARE', hkcuBackupPath, '/y'], {
    timeout: 30000,
    ...(signal ? { signal } : {}),
  }).catch(() => {})
  const systemBackupPath = join(backupDir, `registry-backup-SYSTEM-${timestamp}.reg`)
  await execReg(['export', 'HKLM\\SYSTEM\\CurrentControlSet\\Services', systemBackupPath, '/y'], {
    timeout: 60000,
    ...(signal ? { signal } : {}),
  }).catch(() => {})
  const hkcrClsidPath = join(backupDir, `registry-backup-HKCR-CLSID-${timestamp}.reg`)
  await execReg(['export', 'HKCR\\CLSID', hkcrClsidPath, '/y'], {
    timeout: 60000,
    ...(signal ? { signal } : {}),
  }).catch(() => {})
  const hkcrIfacePath = join(backupDir, `registry-backup-HKCR-Interface-${timestamp}.reg`)
  await execReg(['export', 'HKCR\\Interface', hkcrIfacePath, '/y'], {
    timeout: 60000,
    ...(signal ? { signal } : {}),
  }).catch(() => {})
  const hkcrMimePath = join(backupDir, `registry-backup-HKCR-MIME-${timestamp}.reg`)
  await execReg(['export', 'HKCR\\MIME', hkcrMimePath, '/y'], { timeout: 30000, ...(signal ? { signal } : {}) }).catch(
    () => {},
  )
  const shellRoots = [
    { key: '*', file: 'AllFileTypes' },
    { key: 'Directory', file: 'Directory' },
    { key: 'Folder', file: 'Folder' },
  ]
  for (const { key, file } of shellRoots) {
    const shellPath = join(backupDir, `registry-backup-HKCR-${file}-shellex-${timestamp}.reg`)
    await execReg(['export', `HKCR\\${key}\\shellex`, shellPath, '/y'], {
      timeout: 30000,
      ...(signal ? { signal } : {}),
    }).catch(() => {})
  }
}

export function collectBackupTargets(entries: RegistryEntry[]): { keys: string[]; tasks: string[] } {
  const keys = new Set<string>()
  const tasks = new Set<string>()
  for (const entry of entries) {
    if (!entry.fix) continue
    const key = entry.fix.key || entry.keyPath
    switch (entry.fix.op) {
      case 'delete-value':
      case 'set-value':
      case 'delete-key':
        if (key) keys.add(key)
        break
      case 'disable-task':
      case 'delete-task':
        if (entry.keyPath) tasks.add(entry.keyPath)
        break
    }
  }
  return { keys: [...keys], tasks: [...tasks] }
}

async function createTargetedBackup(
  entries: RegistryEntry[],
  backupDir: string,
  timestamp: string,
  signal?: AbortSignal,
): Promise<void> {
  const { keys, tasks } = collectBackupTargets(entries)
  if (keys.length === 0 && tasks.length === 0) return
  const tempDir = mkdtempSync(join(tmpdir(), 'dinho-reg-backup-'))
  try {
    const bodies: string[] = []
    let idx = 0
    for (const key of keys) {
      if (signal?.aborted) break
      const tempPath = join(tempDir, `part-${idx++}.reg`)
      try {
        await execReg(['export', key, tempPath, '/y'], { timeout: 30000, ...(signal ? { signal } : {}) })
        bodies.push(stripRegHeader(readFileSync(tempPath, 'utf16le')))
      } catch {
        /* Key may have been removed */
      }
    }
    if (bodies.length > 0) {
      const consolidatedPath = join(backupDir, `registry-backup-targeted-${timestamp}.reg`)
      const finalText = `Windows Registry Editor Version 5.00\r\n\r\n${bodies.join('')}`
      const bom = Buffer.from([0xff, 0xfe])
      const body = Buffer.from(finalText, 'utf16le')
      writeFileSync(consolidatedPath, Buffer.concat([bom, body]))
    }
    if (tasks.length > 0) {
      const taskDir = join(backupDir, `registry-backup-tasks-${timestamp}`)
      mkdirSync(taskDir, { recursive: true })
      for (const taskPath of tasks) {
        if (signal?.aborted) break
        const parts = splitTaskPath(taskPath)
        if (!parts) continue
        const fullName = (parts.path + parts.name).replace(/\\+/g, '\\')
        const safeName = parts.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'task'
        try {
          const { stdout } = await execNativeUtf8('schtasks', ['/query', '/xml', '/tn', fullName], {
            timeout: 10000,
            ...(signal ? { signal } : {}),
          })
          writeFileSync(join(taskDir, `${safeName}.xml`), stdout, 'utf-8')
        } catch {
          /* Task may already be gone */
        }
      }
    }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

export { createFullBackup, createTargetedBackup, pruneOldBackups }
