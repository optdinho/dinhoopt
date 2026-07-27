import { randomBytes } from 'node:crypto'
import { lstat, open, readdir, rm, rmdir, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, normalize, resolve } from 'node:path'
import { IPC } from '@shared/channels'
import type { ShredderEntry, ShredderProgress, ShredderResult } from '@shared/types'
import { type BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { logAudit } from '../services/audit-log'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

let cancelled = false

// ── Safety: paths we must never shred ──

const PROTECTED_WIN32 = [
  'windows',
  'system32',
  'syswow64',
  'winsxs',
  'program files',
  'program files (x86)',
  'programdata',
  'recovery',
  'boot',
  '$recycle.bin',
  'system volume information',
  'perflogs',
  'msocache',
  'config.msi',
  'drivers',
  'inf',
  'logs',
]
const PROTECTED_GENERIC = [
  '.git',
  '.svn',
  '.hg',
  'node_modules',
  '.npm',
  '.cache',
  '.local',
  '__pycache__',
  '.venv',
  '.env',
  '.ssh',
  '.gnupg',
  '.config',
  'appdata',
  '.android',
  '.gradle',
]

function isProtectedPath(targetPath: string): boolean {
  const normalized = normalize(resolve(targetPath)).replace(/\\/g, '/')
  const name = basename(normalized).toLowerCase()
  const pathLower = normalized.toLowerCase()
  const segments = pathLower.split('/').filter(Boolean)

  // Never shred filesystem roots (/, C:\)
  if (segments.length === 0) return true
  // On Windows C:/ has segments ['c:'] — depth 1 is the drive root
  if (segments.length <= 1) return true

  // Never shred root-level directories (C:\Windows, /usr, etc.)
  const isRootLevel = segments.length <= 2
  if (isRootLevel) return true

  // Check against protected name lists
  const protectedNames = [...PROTECTED_WIN32, ...PROTECTED_GENERIC]
  if (protectedNames.includes(name)) return true

  // Never shred user profile root folders
  const userProfileDirs = ['desktop', 'documents', 'downloads', 'pictures', 'videos', 'music', 'onedrive']
  if (userProfileDirs.includes(name)) {
    const home = (process.env.HOME || process.env.USERPROFILE || '').toLowerCase().replace(/\\/g, '/')
    if (home) {
      const parent = pathLower.substring(0, pathLower.lastIndexOf('/'))
      if (parent === home || parent === `${home}/`) return true
    }
  }

  return false
}

function sendProgress(win: BrowserWindow | null, data: ShredderProgress): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.SHREDDER_PROGRESS, data)
  }
}

/**
 * Overwrite a single file with random data then zeros (2-pass shred).
 * Uses lstat to avoid following symlinks.  Checks the module-level
 * `cancelled` flag between chunks so large files can be interrupted.
 */
async function shredFile(filePath: string): Promise<void> {
  const stats = await lstat(filePath)
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size === 0) return

  const size = stats.size
  const CHUNK = 1024 * 1024 // 1 MB
  const fh = await open(filePath, 'r+')
  try {
    // Pass 1: random data
    let offset = 0
    while (offset < size) {
      if (cancelled) return
      const len = Math.min(CHUNK, size - offset)
      await fh.write(randomBytes(len), 0, len, offset)
      offset += len
    }
    await fh.datasync()

    // Pass 2: zeros
    const zeroBuf = Buffer.alloc(Math.min(CHUNK, size))
    offset = 0
    while (offset < size) {
      if (cancelled) return
      const len = Math.min(CHUNK, size - offset)
      await fh.write(zeroBuf, 0, len, offset)
      offset += len
    }
    await fh.datasync()
  } finally {
    await fh.close()
  }
}

const MAX_DEPTH = 50

/**
 * Collect all file paths within a directory recursively.
 * Skips symlinks and protected paths, respects a depth limit.
 * Sets `state.depthExceeded` if any branch is cut short by MAX_DEPTH.
 */
async function collectFiles(
  dirPath: string,
  files: string[],
  state: { depthExceeded: boolean },
  depth = 0,
): Promise<void> {
  if (depth >= MAX_DEPTH) {
    state.depthExceeded = true
    return
  }
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const fullPath = join(dirPath, entry.name)
      if (entry.isDirectory()) {
        if (isProtectedPath(fullPath)) continue
        await collectFiles(fullPath, files, state, depth + 1)
      } else if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  } catch {
    // Skip inaccessible directories
  }
}

/**
 * Remove empty directories bottom-up.  Uses rmdir() (not rm -rf) so it
 * only succeeds on truly empty directories — any un-shredded files that
 * were beyond the depth cutoff are safely preserved.
 */
async function removeEmptyDirs(dirPath: string, depth = 0): Promise<void> {
  if (depth >= MAX_DEPTH) return
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) {
        const childPath = join(dirPath, entry.name)
        if (isProtectedPath(childPath)) continue
        await removeEmptyDirs(childPath, depth + 1)
      }
    }
    // Try to remove this directory — only works if now empty
    await rmdir(dirPath)
  } catch {
    // Not empty or inaccessible — leave it alone
  }
}

/**
 * Get the total size of an entry (file size, or recursive directory size).
 */
async function getEntrySize(entryPath: string, depth = 0): Promise<number> {
  if (depth >= MAX_DEPTH) return 0
  try {
    const stats = await lstat(entryPath)
    if (stats.isSymbolicLink()) return 0
    if (stats.isFile()) return stats.size
    if (stats.isDirectory()) {
      let total = 0
      const entries = await readdir(entryPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue
        total += await getEntrySize(join(entryPath, entry.name), depth + 1)
      }
      return total
    }
  } catch {
    /* skip */
  }
  return 0
}

export function registerFileShredderIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.SHREDDER_SELECT_FILES, async () => {
    getLogger().info('file-shredder', 'Opening file selection dialog')
    const win = getWindow()
    if (!win) return []
    const fileOpts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections'] }
    const result = await dialog.showOpenDialog(win, fileOpts)
    if (result.canceled || !result.filePaths.length) {
      getLogger().warning('file-shredder', 'File selection cancelled or empty')
      return []
    }

    const entries: ShredderEntry[] = []
    for (const filePath of result.filePaths) {
      try {
        const s = await stat(filePath)
        entries.push({
          path: filePath,
          name: filePath.split(/[\\/]/).pop() || filePath,
          size: s.size,
          isDirectory: false,
        })
      } catch {
        /* skip */
      }
    }
    getLogger().success('file-shredder', `Selected ${entries.length} file(s) for shredding`)
    return entries
  })

  ipcMain.handle(IPC.SHREDDER_SELECT_FOLDERS, async () => {
    getLogger().info('file-shredder', 'Opening folder selection dialog')
    const win = getWindow()
    if (!win) return []
    const folderOpts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'multiSelections'] }
    const result = await dialog.showOpenDialog(win, folderOpts)
    if (result.canceled || !result.filePaths.length) {
      getLogger().warning('file-shredder', 'Folder selection cancelled or empty')
      return []
    }

    const entries: ShredderEntry[] = []
    for (const dirPath of result.filePaths) {
      try {
        const size = await getEntrySize(dirPath)
        entries.push({
          path: dirPath,
          name: dirPath.split(/[\\/]/).pop() || dirPath,
          size,
          isDirectory: true,
        })
      } catch {
        /* skip */
      }
    }
    getLogger().success('file-shredder', `Selected ${entries.length} folder(s) for shredding`)
    return entries
  })

  // Cancel
  ipcMain.handle(IPC.SHREDDER_CANCEL, () => {
    getLogger().warning('file-shredder', 'Shredding cancelled by user')
    cancelled = true
  })

  // Shred
  ipcMain.handle(IPC.SHREDDER_SHRED, async (event, paths: unknown): Promise<ShredderResult> => {
    if (!validateSender(event, getWindow())) {
      return {
        shredded: 0,
        failed: 0,
        bytesShredded: 0,
        duration: 0,
        errors: [{ path: '', reason: 'Invalid sender' }],
        cancelled: false,
      }
    }
    cancelled = false
    const startTime = Date.now()
    const win = getWindow()
    const emptyResult: ShredderResult = {
      shredded: 0,
      failed: 0,
      bytesShredded: 0,
      duration: 0,
      errors: [],
      cancelled: false,
    }

    if (!Array.isArray(paths)) {
      getLogger().warning('file-shredder', 'Shred called with non-array paths')
      return emptyResult
    }
    const safePaths = paths.filter((p): p is string => typeof p === 'string' && isAbsolute(p))
    if (safePaths.length === 0) {
      getLogger().warning('file-shredder', 'Shred called with empty or invalid paths')
      return emptyResult
    }
    getLogger().info('file-shredder', `Starting shred for ${safePaths.length} path(s)`)

    // Reject any protected paths before doing any work
    const errors: { path: string; reason: string }[] = []
    const allowedPaths: string[] = []
    for (const p of safePaths) {
      if (isProtectedPath(p)) {
        errors.push({ path: p, reason: 'Protected system path — shredding blocked' })
      } else {
        allowedPaths.push(p)
      }
    }

    // First, collect all individual files to shred
    const allFiles: string[] = []
    const dirPaths: string[] = []
    const collectState = { depthExceeded: false }

    for (const p of allowedPaths) {
      try {
        const s = await lstat(p)
        if (s.isSymbolicLink()) continue
        if (s.isDirectory()) {
          dirPaths.push(p)
          await collectFiles(p, allFiles, collectState)
        } else if (s.isFile()) {
          allFiles.push(p)
        }
      } catch {
        /* skip */
      }
    }

    // Deduplicate — overlapping selections (parent + child folder, or
    // a folder and an explicit file inside it) would otherwise shred
    // the same file twice, inflating progress and reporting a bogus
    // ENOENT failure on the second attempt.
    const uniqueFiles = [...new Set(allFiles)]

    // Calculate total bytes
    let totalBytes = 0
    const fileSizes = new Map<string, number>()
    for (const f of uniqueFiles) {
      try {
        const s = await stat(f)
        fileSizes.set(f, s.size)
        totalBytes += s.size
      } catch {
        fileSizes.set(f, 0)
      }
    }

    let shredded = 0
    let failed = errors.length
    let bytesShredded = 0
    let lastReport = Date.now()

    // Shred each file
    for (const filePath of uniqueFiles) {
      if (cancelled) break

      const now = Date.now()
      if (now - lastReport > 300) {
        lastReport = now
        sendProgress(win, {
          currentPath: filePath,
          filesShredded: shredded,
          totalFiles: uniqueFiles.length,
          bytesShredded,
          totalBytes,
          progress: totalBytes > 0 ? (bytesShredded / totalBytes) * 100 : 0,
        })
      }

      try {
        await shredFile(filePath)
        await rm(filePath, { force: true })
        const fileSize = fileSizes.get(filePath) || 0
        bytesShredded += fileSize
        shredded++
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : 'Unknown error'
        failed++
        errors.push({ path: filePath, reason })
      }
    }

    // Remove emptied directories bottom-up.
    // If the depth limit was hit, some files beyond MAX_DEPTH were never
    // collected and therefore never shredded — using recursive rm would
    // silently delete them without the overwrite pass.  rmdir() only
    // succeeds on empty directories, so un-shredded files are preserved.
    if (!cancelled) {
      for (const dirPath of dirPaths) {
        await removeEmptyDirs(dirPath)
      }
    }

    const wasCancelled = cancelled

    // Final progress — reflect actual state, not a blanket 100 %
    sendProgress(win, {
      currentPath: '',
      filesShredded: shredded,
      totalFiles: uniqueFiles.length,
      bytesShredded,
      totalBytes,
      progress: wasCancelled ? (totalBytes > 0 ? (bytesShredded / totalBytes) * 100 : 0) : 100,
    })

    if (wasCancelled) {
      getLogger().warning('file-shredder', `Shred cancelled after ${shredded} file(s), ${bytesShredded} bytes`)
    } else {
      getLogger().success(
        'file-shredder',
        `Shred complete: ${shredded} file(s), ${failed} failed, ${bytesShredded} bytes in ${Date.now() - startTime}ms`,
      )
    }

    logAudit('FILE_SHRED', 'shredder', {
      paths: safePaths,
      shredded,
      failed,
      bytesShredded,
      duration: Date.now() - startTime,
      cancelled: wasCancelled,
    })

    return {
      shredded,
      failed,
      bytesShredded,
      duration: Date.now() - startTime,
      errors,
      cancelled: wasCancelled,
    }
  })

  // Open file location
  ipcMain.handle(IPC.SHREDDER_OPEN_LOCATION, (_event, filePath: unknown) => {
    getLogger().info('file-shredder', `Opening file location: ${filePath}`)
    if (typeof filePath !== 'string' || !isAbsolute(filePath)) return
    shell.showItemInFolder(filePath)
  })
}
