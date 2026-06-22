import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { getSettings } from './settings-store'

/** Default location for Kudu backups (registry, shell extensions, etc.) */
export function getDefaultBackupDir(): string {
  return join(homedir(), 'Documents', 'DiNho Optimizer Backups')
}

/**
 * Resolve the backup directory: user-configured if set and valid, otherwise default.
 * Uses `path.resolve` to normalize any `..` or `.` components, preventing path traversal
 * via crafted absolute paths like `C:\Users\..\Windows\System32`.
 * Falls back to default for empty, non-string, or non-absolute values to keep callers safe.
 */
export function getBackupDir(): string {
  const configured = getSettings().backupPath
  if (typeof configured === 'string' && configured.length > 0 && isAbsolute(configured)) {
    return resolve(configured)
  }
  return getDefaultBackupDir()
}

/**
 * Validate that a user-provided subpath stays within the backup directory.
 * Normalizes the resolved path and checks via `path.relative` that it doesn't escape.
 * Throws if the path attempts traversal (e.g., contains `..` that leaves the backup dir).
 */
export function resolveBackupPath(subpath: string): string {
  const backupDir = getBackupDir()
  const resolved = resolve(backupDir, subpath)
  const rel = relative(backupDir, resolved)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path traversal blocked: "${subpath}" resolves outside the backup directory ("${backupDir}")`)
  }
  return resolved
}
