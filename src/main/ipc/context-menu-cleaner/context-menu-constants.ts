import { mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  ContextMenuAction,
  ContextMenuEntry,
  ContextMenuEntryKind,
  ContextMenuHive,
  ContextMenuScope,
  ContextMenuStatus,
} from '@shared/types'
import { app } from 'electron'
import { getBackupDir } from '../../services/backup-dir'
import { isAdmin } from '../../services/elevation'
import { getLogger } from '../../services/logger.service'
import { execReg } from '../../services/registry-utils'

// ── ScanRoot ────────────────────────────────────────────────────────

export interface ScanRoot {
  hive: ContextMenuHive
  scope: ContextMenuScope
  shellPath: string
  shellexPath: string
}

export const SCAN_ROOTS: ReadonlyArray<ScanRoot> = [
  {
    hive: 'HKCR',
    scope: 'AllFiles',
    shellPath: 'HKCR\\*\\shell',
    shellexPath: 'HKCR\\*\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCR',
    scope: 'Directory',
    shellPath: 'HKCR\\Directory\\shell',
    shellexPath: 'HKCR\\Directory\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCR',
    scope: 'DirectoryBackground',
    shellPath: 'HKCR\\Directory\\Background\\shell',
    shellexPath: 'HKCR\\Directory\\Background\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCR',
    scope: 'Folder',
    shellPath: 'HKCR\\Folder\\shell',
    shellexPath: 'HKCR\\Folder\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCR',
    scope: 'Drive',
    shellPath: 'HKCR\\Drive\\shell',
    shellexPath: 'HKCR\\Drive\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCR',
    scope: 'AllFilesystemObjects',
    shellPath: 'HKCR\\AllFilesystemObjects\\shell',
    shellexPath: 'HKCR\\AllFilesystemObjects\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCU',
    scope: 'AllFiles',
    shellPath: 'HKCU\\Software\\Classes\\*\\shell',
    shellexPath: 'HKCU\\Software\\Classes\\*\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCU',
    scope: 'Directory',
    shellPath: 'HKCU\\Software\\Classes\\Directory\\shell',
    shellexPath: 'HKCU\\Software\\Classes\\Directory\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCU',
    scope: 'DirectoryBackground',
    shellPath: 'HKCU\\Software\\Classes\\Directory\\Background\\shell',
    shellexPath: 'HKCU\\Software\\Classes\\Directory\\Background\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCU',
    scope: 'Folder',
    shellPath: 'HKCU\\Software\\Classes\\Folder\\shell',
    shellexPath: 'HKCU\\Software\\Classes\\Folder\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCU',
    scope: 'Drive',
    shellPath: 'HKCU\\Software\\Classes\\Drive\\shell',
    shellexPath: 'HKCU\\Software\\Classes\\Drive\\shellex\\ContextMenuHandlers',
  },
  {
    hive: 'HKCU',
    scope: 'AllFilesystemObjects',
    shellPath: 'HKCU\\Software\\Classes\\AllFilesystemObjects\\shell',
    shellexPath: 'HKCU\\Software\\Classes\\AllFilesystemObjects\\shellex\\ContextMenuHandlers',
  },
]

// ── Safelists ───────────────────────────────────────────────────────

export const VERB_SAFELIST: ReadonlyArray<string> = [
  'open',
  'edit',
  'print',
  'printto',
  'runas',
  'opennewwindow',
  'opennewprocess',
  'find',
  'explore',
  'cmd',
  'properties',
  'cut',
  'copy',
  'paste',
  'link',
  'rename',
  'delete',
  'sendto',
  'pintohome',
  'pintotaskbar',
  'unpinfromtaskbar',
  'pintostartscreen',
  'unpinfromstartscreen',
]

export const CLSID_SAFELIST: ReadonlyArray<string> = [
  '{09A47860-11B0-4DA5-AFA5-26D86198A780}',
  '{CB3D0F55-BC2C-4C1A-85ED-23ED75B5106B}',
  '{BB64F8A7-BEE7-4E1A-AB8D-7D8273F7FDB6}',
  '{09799AFB-AD67-11D1-ABCD-00C04FC30936}',
  '{7BA4C740-9E81-11CF-99D3-00AA004AE837}',
  '{A470F8CF-A1E8-4f65-8335-227475AA5C46}',
  '{F81E9010-6EA4-11CE-A7FF-00AA003CA9F6}',
  '{888DCA60-FC0A-11CF-8F0F-00C04FD7D062}',
  '{F39A0DC0-9CC8-11D0-A599-00C04FD64433}',
  '{e82a2d71-5b2f-43a0-97b8-81be15854de8}',
  '{40dd6e20-7c17-11ce-a804-00aa003ca9f6}',
  '{ECCDF543-45CC-11CE-B9BF-0080C87CDBA6}',
  '{00021500-0000-0000-C000-000000000046}',
  '{B41DB860-8EE4-11D2-9906-E49FADC173CA}',
]

// ── Source patterns ─────────────────────────────────────────────────

export interface SourcePattern {
  pattern: RegExp
  source: import('@shared/types').ContextMenuSource
}

export const SOURCE_PATTERNS: ReadonlyArray<SourcePattern> = [
  { pattern: /onedrive/i, source: 'OneDrive' },
  { pattern: /7-?zip/i, source: '7-Zip' },
  { pattern: /winrar|rarext/i, source: 'WinRAR' },
  { pattern: /notepad\+\+|nppshell/i, source: 'Notepad++' },
  { pattern: /[\\/]code[\\/]|code\.exe|code-insiders|vs\s?code/i, source: 'VSCode' },
  { pattern: /defender|antimalware|msmpeng/i, source: 'Defender' },
  { pattern: /[\\/]git[\\/]|git-?bash|tortoisegit/i, source: 'Git' },
  { pattern: /dropbox/i, source: 'Dropbox' },
  { pattern: /googledrive|googlephotos/i, source: 'Google Drive' },
  { pattern: /powertoys/i, source: 'PowerToys' },
  { pattern: /[\\/]system32[\\/]|[\\/]syswow64[\\/]|microsoft|windows/i, source: 'Microsoft' },
]

// ── ParsedKey / ClsidInfo ───────────────────────────────────────────

export interface ParsedKey {
  keyPath: string
  values: Record<string, { type: string; data: string }>
}

export interface ClsidInfo {
  friendlyName: string | null
  dllPath: string | null
}

// ── Disabled-state file ─────────────────────────────────────────────

export const DISABLED_STATE_VERSION = 1 as const

export interface DisabledStateEntry {
  keyPath: string
  originalName: string
  disabledAt: string
  kind: ContextMenuEntryKind
}

export interface DisabledStateFile {
  version: typeof DISABLED_STATE_VERSION
  entries: Record<string, DisabledStateEntry>
}

export function disabledStatePath(): string {
  return join(app.getPath('userData'), 'context-menu-disabled.json')
}

export function readDisabledState(): DisabledStateFile {
  const empty: DisabledStateFile = { version: DISABLED_STATE_VERSION, entries: {} }
  try {
    const raw = readFileSync(disabledStatePath(), 'utf-8')
    const parsed = JSON.parse(raw) as DisabledStateFile
    if (parsed?.version !== DISABLED_STATE_VERSION || typeof parsed.entries !== 'object') {
      getLogger().warning('context-menu-cleaner', 'disabled-state version mismatch, ignoring')
      return empty
    }
    return parsed
  } catch {
    return empty
  }
}

export function writeDisabledState(state: DisabledStateFile): void {
  const target = disabledStatePath()
  const tmp = `${target}.tmp`
  writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
  renameSync(tmp, target)
}

// ── Backup helpers ──────────────────────────────────────────────────

export const BACKUP_DIR = () => getBackupDir()

export function pruneOldBackups(backupDir: string, keep: number): void {
  try {
    const files = readdirSync(backupDir).filter((f: string) => f.startsWith('registry-backup-') && f.endsWith('.reg'))
    const groups = new Map<string, string[]>()
    for (const file of files) {
      const m = file.match(/-(\d{4}-\d{2}-\d{2}T[\d-]+Z)\.reg$/)
      if (!m) continue
      const ts = m[1]!
      const list = groups.get(ts) ?? []
      list.push(file)
      groups.set(ts, list)
    }
    const stale = [...groups.keys()].sort().reverse().slice(keep)
    for (const ts of stale) {
      for (const f of groups.get(ts) ?? []) {
        try {
          unlinkSync(join(backupDir, f))
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* skip */
  }
}

export async function backupShellExtensionHives(signal?: AbortSignal): Promise<void> {
  const backupDir = BACKUP_DIR()
  try {
    mkdirSync(backupDir, { recursive: true })
  } catch {
    /* skip */
  }
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')

  const targets: { src: string; file: string }[] = [
    { src: 'HKCR\\*\\shellex', file: 'AllFileTypes' },
    { src: 'HKCR\\Directory\\shellex', file: 'Directory' },
    { src: 'HKCR\\Directory\\Background\\shellex', file: 'DirectoryBackground' },
    { src: 'HKCR\\Folder\\shellex', file: 'Folder' },
    { src: 'HKCR\\Drive\\shellex', file: 'Drive' },
    { src: 'HKCR\\AllFilesystemObjects\\shellex', file: 'AllFilesystemObjects' },
    { src: 'HKCR\\*\\shell', file: 'AllFileTypes-shell' },
    { src: 'HKCR\\Directory\\shell', file: 'Directory-shell' },
    { src: 'HKCR\\Directory\\Background\\shell', file: 'DirectoryBackground-shell' },
    { src: 'HKCR\\Folder\\shell', file: 'Folder-shell' },
    { src: 'HKCU\\Software\\Classes', file: 'HKCU-Classes' },
  ]
  for (const { src, file } of targets) {
    const dest = join(backupDir, `registry-backup-context-menu-${file}-${timestamp}.reg`)
    await execReg(['export', src, dest, '/y'], { timeout: 30000, ...(signal ? { signal } : {}) }).catch(() => {
      /* skip */
    })
  }
  pruneOldBackups(backupDir, 3)
}

// ── Apply helpers ───────────────────────────────────────────────────

export async function applyOne(
  entry: ContextMenuEntry,
  action: ContextMenuAction,
  signal?: AbortSignal,
): Promise<{ ok: true; newStatus: ContextMenuStatus } | { ok: false; reason: string }> {
  if (entry.protected && action !== 'enable') {
    return { ok: false, reason: 'Entry is protected and cannot be modified.' }
  }
  if (entry.requiresAdmin && !isAdmin()) {
    return { ok: false, reason: 'Acesso negado — execute o DiNho Optimizer como administrador.' }
  }

  try {
    if (entry.kind === 'verb') {
      if (action === 'disable') {
        await execReg(['add', entry.keyPath, '/v', 'LegacyDisable', '/t', 'REG_SZ', '/d', '', '/f'], {
          timeout: 8000,
          ...(signal ? { signal } : {}),
        })
        return { ok: true, newStatus: 'disabled' }
      }
      if (action === 'enable') {
        await execReg(['delete', entry.keyPath, '/v', 'LegacyDisable', '/f'], {
          timeout: 8000,
          ...(signal ? { signal } : {}),
        }).catch(() => {
          /* idempotent */
        })
        return { ok: true, newStatus: 'enabled' }
      }
      await execReg(['delete', entry.keyPath, '/f'], { timeout: 8000, ...(signal ? { signal } : {}) })
      return { ok: true, newStatus: 'enabled' /* gone */ }
    }
    // handler
    const parent = entry.keyPath.substring(0, entry.keyPath.lastIndexOf('\\'))
    const enabledPath = entry.keyPath
    const disabledPath = `${parent}\\-${entry.name}`

    if (action === 'disable') {
      if (entry.status === 'disabled') return { ok: true, newStatus: 'disabled' }
      await execReg(['copy', enabledPath, disabledPath, '/s', '/f'], { timeout: 8000, ...(signal ? { signal } : {}) })
      await execReg(['delete', enabledPath, '/f'], { timeout: 8000, ...(signal ? { signal } : {}) })
      return { ok: true, newStatus: 'disabled' }
    }
    if (action === 'enable') {
      if (entry.status === 'enabled') return { ok: true, newStatus: 'enabled' }
      await execReg(['copy', disabledPath, enabledPath, '/s', '/f'], { timeout: 8000, ...(signal ? { signal } : {}) })
      await execReg(['delete', disabledPath, '/f'], { timeout: 8000, ...(signal ? { signal } : {}) })
      return { ok: true, newStatus: 'enabled' }
    }
    // delete
    const target = entry.status === 'disabled' ? disabledPath : enabledPath
    await execReg(['delete', target, '/f'], { timeout: 8000, ...(signal ? { signal } : {}) })
    return { ok: true, newStatus: 'enabled' /* gone */ }
  } catch (err) {
    const message = (err as Error)?.message ?? String(err)
    return { ok: false, reason: cleanRegError(message) }
  }
}

export function cleanRegError(message: string): string {
  const m = message.match(/ERROR:\s*(.+?)(?:\r?\n|$)/)
  if (m) return m[1]!.trim()
  if (/access is denied/i.test(message)) return 'Acesso negado — execute o DiNho Optimizer como administrador.'
  if (/cancel/i.test(message)) return 'Operation cancelled'
  return message.length > 200 ? `${message.substring(0, 200)}…` : message
}

export function labelForAction(action: ContextMenuAction): string {
  switch (action) {
    case 'disable':
      return 'Disabling'
    case 'enable':
      return 'Enabling'
    case 'delete':
      return 'Deleting'
  }
}
