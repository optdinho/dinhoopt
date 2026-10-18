import { spawn } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { IPC } from '@shared/channels'
import type {
  DiskNode,
  DiskRepairProgress,
  DiskRepairResult,
  DiskRepairSummaryCode,
  DriveInfo,
  FileTypeInfo,
} from '@shared/types'
import { type BrowserWindow, ipcMain } from 'electron'
import { isAdmin } from '../services/elevation'
import { execFileAsync, psUtf8, trackChildProcess } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

const MAX_DEPTH = 3
const FILE_TYPE_MAX_DEPTH = 4

/** Mutable per-scan counter so swallowed FS errors still leave a trace in the log. */
interface ScanStats {
  skipped: number
}

// ── Internal helpers ──

async function analyzeDirectory(
  dirPath: string,
  depth: number,
  mainWindow: BrowserWindow | null,
  stats: ScanStats,
): Promise<DiskNode> {
  const node: DiskNode = {
    name: basename(dirPath) || dirPath,
    path: dirPath,
    size: 0,
    children: [],
  }

  if (depth >= MAX_DEPTH) {
    node.size = await quickSize(dirPath, stats)
    return node
  }

  try {
    const entries = await readdir(dirPath, { withFileTypes: true })

    for (const [index, entry] of entries.entries()) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          const child = await analyzeDirectory(fullPath, depth + 1, mainWindow, stats)
          node.children!.push(child)
          node.size += child.size
        } else {
          const s = await stat(fullPath)
          node.size += s.size
        }
      } catch {
        // Skip inaccessible entry — counted in `stats` and reported once per scan.
        stats.skipped += 1
      }

      // Real, per-entry progress for the top level (the UI shows a live bar).
      if (depth === 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'scanning',
          category: 'disk',
          currentPath: fullPath,
          progress: Math.round(((index + 1) / Math.max(entries.length, 1)) * 100),
          itemsFound: node.children!.length,
          sizeFound: node.size,
        })
      }
    }

    if (depth === 0 && entries.length === 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category: 'disk',
        currentPath: dirPath,
        progress: 100,
        itemsFound: 0,
        sizeFound: 0,
      })
    }
  } catch {
    // Inaccessible root/subdirectory — counted, not logged per directory.
    stats.skipped += 1
  }

  node.children?.sort((a, b) => b.size - a.size)
  return node
}

async function collectFileTypes(
  dirPath: string,
  depth: number,
  extMap: Map<string, { size: number; count: number }>,
  mainWindow: BrowserWindow | null,
  stats: ScanStats,
): Promise<void> {
  if (depth >= FILE_TYPE_MAX_DEPTH) return
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const [index, entry] of entries.entries()) {
      const fullPath = join(dirPath, entry.name)
      try {
        if (entry.isDirectory()) {
          await collectFileTypes(fullPath, depth + 1, extMap, mainWindow, stats)
        } else {
          const s = await stat(fullPath)
          const ext = (extname(entry.name) || '(no extension)').toLowerCase()
          const existing = extMap.get(ext)
          if (existing) {
            existing.size += s.size
            existing.count += 1
          } else {
            extMap.set(ext, { size: s.size, count: 1 })
          }
        }
      } catch {
        // Skip inaccessible entry (counted for the end-of-scan warning).
        stats.skipped += 1
      }
      if (depth === 0 && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'scanning',
          category: 'disk-file-types',
          currentPath: dirPath,
          progress: Math.round(((index + 1) / Math.max(entries.length, 1)) * 100),
          itemsFound: extMap.size,
          sizeFound: 0,
        })
      }
    }
  } catch {
    // Inaccessible directory (counted for the end-of-scan warning).
    stats.skipped += 1
  }
}

/**
 * Shallow size of a directory: sums only the files directly inside it.
 * Intentional (tested: "skips subdirectories in quickSize calculation") — used to
 * cap the cost of the depth-3 frontier, where listing children would be unbounded.
 * Consequence: a depth-3 node's `size` excludes its own subdirectories.
 */
async function quickSize(dirPath: string, stats: ScanStats): Promise<number> {
  let size = 0
  try {
    const entries = await readdir(dirPath, { withFileTypes: true })
    for (const entry of entries) {
      try {
        const s = await stat(join(dirPath, entry.name))
        size += s.isDirectory() ? 0 : s.size
      } catch {
        // Skip unreadable entry.
        stats.skipped += 1
      }
    }
  } catch {
    // Unreadable directory.
    stats.skipped += 1
  }
  return size
}

// ── Exported core logic ──

export async function getDrives(): Promise<DriveInfo[]> {
  getLogger().info('disk-analyzer', 'Fetching drive list...')
  try {
    const driveScript = `$fixed = (Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DriveType -eq 3 }).DeviceID -replace ':',''; Get-PSDrive -PSProvider FileSystem | Where-Object { $_.Used -ne $null -and $fixed -contains $_.Name } | ForEach-Object { "$($_.Name)|$($_.Description)|$($_.Used)|$($_.Free)" }`
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(driveScript)], {
      timeout: 10000,
      windowsHide: true,
    })

    const drives: DriveInfo[] = []
    for (const line of String(stdout).trim().split('\n')) {
      const [letter, label, used, free] = line.trim().split('|')
      if (letter && used && free) {
        const usedSpace = Number.parseInt(used, 10) || 0
        const freeSpace = Number.parseInt(free, 10) || 0
        drives.push({
          letter: letter.trim(),
          label: label?.trim() || letter.trim(),
          totalSize: usedSpace + freeSpace,
          freeSpace,
          usedSpace,
        })
      }
    }
    getLogger().success('disk-analyzer', `Found ${drives.length} drive(s) on Windows`)
    return drives
  } catch (err) {
    getLogger().error(
      'disk-analyzer',
      'Failed to fetch drives via CIM',
      err instanceof Error ? err.message : String(err),
    )
    return []
  }
}

/** Resolve a drive identifier to a root path (Windows letter) */
function resolveRootPath(drive: string): string | null {
  if (typeof drive !== 'string' || !drive) return null
  if (/^[A-Za-z]$/.test(drive)) return `${drive.toUpperCase()}:\\`
  return null
}

export async function analyzeDisk(drive: string, mainWindow: BrowserWindow | null = null): Promise<DiskNode> {
  getLogger().info('disk-analyzer', `Analyzing disk: ${drive}`)
  const rootPath = resolveRootPath(drive)
  if (!rootPath) {
    getLogger().warning('disk-analyzer', `Invalid drive identifier: ${drive}`)
    return { name: '', path: '', size: 0, children: [] }
  }
  const stats: ScanStats = { skipped: 0 }
  const node = await analyzeDirectory(rootPath, 0, mainWindow, stats)
  if (stats.skipped > 0) {
    getLogger().warning('disk-analyzer', `Disk analysis skipped ${stats.skipped} inaccessible item(s) on ${drive}`)
  }
  getLogger().success(
    'disk-analyzer',
    `Disk analysis complete for ${drive}: ${node.size} bytes in ${node.children?.length ?? 0} items`,
  )
  return node
}

export async function getFileTypes(drive: string, mainWindow: BrowserWindow | null = null): Promise<FileTypeInfo[]> {
  getLogger().info('disk-analyzer', `Collecting file types for: ${drive}`)
  const rootPath = resolveRootPath(drive)
  if (!rootPath) {
    getLogger().warning('disk-analyzer', `Invalid drive for file types: ${drive}`)
    return []
  }
  const extMap = new Map<string, { size: number; count: number }>()
  const stats: ScanStats = { skipped: 0 }
  await collectFileTypes(rootPath, 0, extMap, mainWindow, stats)
  if (stats.skipped > 0) {
    getLogger().warning('disk-analyzer', `File-type scan skipped ${stats.skipped} inaccessible path(s) on ${drive}`)
  }
  const results: FileTypeInfo[] = []
  for (const [ext, info] of extMap) {
    results.push({ extension: ext, totalSize: info.size, fileCount: info.count })
  }
  results.sort((a, b) => b.totalSize - a.totalSize)
  getLogger().success('disk-analyzer', `Found ${results.length} file type(s) on ${drive}`)
  return results
}

// ── Disk Repair helpers (Windows SFC / DISM) ──

function sendRepairProgress(win: BrowserWindow | null, data: DiskRepairProgress): void {
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.DISK_REPAIR_PROGRESS, data)
  }
}

/**
 * Run SFC /scannow and stream progress to the renderer.
 * SFC outputs progress lines like "Verification 42% complete."
 */
async function runSfc(drive: string, getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (!isAdmin()) {
    getLogger().warning('disk-analyzer', 'SFC skipped: admin privileges required')
    return {
      tool: 'sfc',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run SFC',
      summaryCode: 'adminRequired',
      log: '',
      requiresReboot: false,
      needsAdmin: true,
    }
  }

  // Validate drive letter — must be a single A-Z character
  const safeDrive = /^[A-Za-z]$/.test(drive) ? drive.toUpperCase() : 'C'

  return new Promise((resolve) => {
    // `spawn` can emit both 'error' and 'close'; resolve exactly once.
    let settled = false
    const settle = (result: DiskRepairResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const args = ['/scannow']
    // If a non-system drive is specified, use /offbootdir and /offwindir
    if (safeDrive !== 'C') {
      args.push(`/offbootdir=${safeDrive}:\\`, `/offwindir=${safeDrive}:\\Windows`)
    }

    const child = spawn('cmd', ['/c', 'chcp 65001 >nul & sfc', ...args], { windowsHide: true })
    let stdout = ''
    let lastPercent = 0
    const decoder = new StringDecoder('utf-8')
    const stderrDecoder = new StringDecoder('utf-8')
    trackChildProcess(child)

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk)
      stdout += text
      // Parse progress from SFC output like "Verification 42% complete."
      const match = text.match(/(\d+)\s*%/i)
      if (match) {
        const pct = Number.parseInt(match[1] ?? '0', 10)
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'sfc',
            phase: 'running',
            percent: pct,
            message: `System File Checker: ${pct}% complete`,
            messageCode: 'percent',
            messageParams: { percent: pct },
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += stderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'sfc',
        phase: 'failed',
        percent: 0,
        message: `SFC failed to start: ${err.message}`,
        messageCode: 'startFailed',
        messageParams: { error: err.message },
      })
      settle({
        tool: 'sfc',
        success: false,
        exitCode: null,
        summary: `Failed to start SFC: ${err.message}`,
        summaryCode: 'startFailed',
        summaryParams: { error: err.message },
        log: stdout,
        requiresReboot: false,
        needsAdmin: false,
      })
    })

    child.on('close', (code) => {
      const success = code === 0
      let summary: string
      let summaryCode: DiskRepairSummaryCode
      if (stdout.includes('did not find any integrity violations')) {
        summary = 'No integrity violations found — your system files are healthy.'
        summaryCode = 'sfcNoViolations'
      } else if (stdout.includes('successfully repaired')) {
        summary = 'Windows found and repaired corrupted system files.'
        summaryCode = 'sfcRepaired'
      } else if (stdout.includes('found corrupt files but was unable to fix')) {
        summary = 'Corrupted files were found but could not be repaired. Try running DISM first, then SFC again.'
        summaryCode = 'sfcRepairIncomplete'
      } else if (success) {
        summary = 'SFC completed successfully.'
        summaryCode = 'sfcCompleted'
      } else {
        summary = `SFC exited with code ${code}.`
        summaryCode = 'sfcExitCode'
      }

      // Check for reboot indicators — use specific phrases, not generic words
      const requiresReboot = /pending system repair|restart your computer|reboot.*required/i.test(stdout)
      sendRepairProgress(getWindow(), {
        tool: 'sfc',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary,
      })
      settle({
        tool: 'sfc',
        success,
        exitCode: code,
        summary,
        summaryCode,
        ...(summaryCode === 'sfcExitCode' ? { summaryParams: { code: String(code) } } : {}),
        log: stdout,
        requiresReboot,
        needsAdmin: false,
      })
    })
  })
}

/**
 * Run DISM /Online /Cleanup-Image /RestoreHealth and stream progress.
 * DISM outputs progress like "[==                 10.0%                 ]"
 */
async function runDism(getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (!isAdmin()) {
    getLogger().warning('disk-analyzer', 'DISM skipped: admin privileges required')
    return {
      tool: 'dism',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run DISM',
      summaryCode: 'adminRequired',
      log: '',
      requiresReboot: false,
      needsAdmin: true,
    }
  }

  return new Promise((resolve) => {
    let settled = false
    const settle = (result: DiskRepairResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = spawn(
      'cmd',
      ['/c', 'chcp 65001 >nul & DISM', '/English', '/Online', '/Cleanup-Image', '/RestoreHealth'],
      {
        windowsHide: true,
      },
    )
    let stdout = ''
    let lastPercent = 0
    const dismDecoder = new StringDecoder('utf-8')
    const dismStderrDecoder = new StringDecoder('utf-8')
    trackChildProcess(child)

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = dismDecoder.write(chunk)
      stdout += text
      const match = text.match(/(\d+(?:\.\d+)?)\s*%/i)
      if (match) {
        const pct = Math.round(Number.parseFloat(match[1] ?? '0'))
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'dism',
            phase: 'running',
            percent: pct,
            message: `DISM RestoreHealth: ${pct}% complete`,
            messageCode: 'percent',
            messageParams: { percent: pct },
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += dismStderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'dism',
        phase: 'failed',
        percent: 0,
        message: `DISM failed to start: ${err.message}`,
        messageCode: 'startFailed',
        messageParams: { error: err.message },
      })
      settle({
        tool: 'dism',
        success: false,
        exitCode: null,
        summary: `Failed to start DISM: ${err.message}`,
        summaryCode: 'startFailed',
        summaryParams: { error: err.message },
        log: stdout,
        requiresReboot: false,
        needsAdmin: false,
      })
    })

    child.on('close', (code) => {
      const success = code === 0
      let summary: string
      let summaryCode: DiskRepairSummaryCode
      if (stdout.includes('The restore operation completed successfully')) {
        summary = 'DISM successfully repaired the Windows component store.'
        summaryCode = 'dismRepaired'
      } else if (stdout.includes('No component store corruption detected')) {
        summary = 'No component store corruption detected — image is healthy.'
        summaryCode = 'dismHealthy'
      } else if (success) {
        summary = 'DISM completed successfully.'
        summaryCode = 'dismCompleted'
      } else {
        summary = `DISM exited with code ${code}. Check the log for details.`
        summaryCode = 'dismExitCode'
      }

      // Check for reboot indicators — use specific phrases to avoid false positives
      const requiresReboot = /restart your computer|reboot.*required|pending reboot/i.test(stdout)
      sendRepairProgress(getWindow(), {
        tool: 'dism',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary,
      })
      settle({
        tool: 'dism',
        success,
        exitCode: code,
        summary,
        summaryCode,
        ...(summaryCode === 'dismExitCode' ? { summaryParams: { code: String(code) } } : {}),
        log: stdout,
        requiresReboot,
        needsAdmin: false,
      })
    })
  })
}

/**
 * Run CHKDSK on a drive and stream progress to the renderer.
 * CHKDSK outputs progress like "Stage 1: ... (42% complete)"
 */
async function runChkdsk(drive: string, getWindow: WindowGetter): Promise<DiskRepairResult> {
  if (!isAdmin()) {
    getLogger().warning('disk-analyzer', 'CHKDSK skipped: admin privileges required')
    return {
      tool: 'chkdsk',
      success: false,
      exitCode: null,
      summary: 'Administrator privileges required to run CHKDSK',
      summaryCode: 'adminRequired',
      log: '',
      requiresReboot: false,
      needsAdmin: true,
    }
  }

  const safeDrive = /^[A-Za-z]$/.test(drive) ? drive.toUpperCase() : 'C'

  return new Promise((resolve) => {
    let settled = false
    const settle = (result: DiskRepairResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }

    const child = spawn('cmd', ['/c', `chcp 65001 >nul & chkdsk ${safeDrive}: /scan`], { windowsHide: true })
    let stdout = ''
    let lastPercent = 0
    const decoder = new StringDecoder('utf-8')
    const stderrDecoder = new StringDecoder('utf-8')
    trackChildProcess(child)

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = decoder.write(chunk)
      stdout += text
      const match = text.match(/(\d+)\s*percent/i) || text.match(/(\d+)\s*%/i)
      if (match) {
        const pct = Number.parseInt(match[1] ?? '0', 10)
        if (pct > lastPercent) {
          lastPercent = pct
          sendRepairProgress(getWindow(), {
            tool: 'chkdsk',
            phase: 'running',
            percent: pct,
            message: `CHKDSK: ${pct}% complete`,
            messageCode: 'percent',
            messageParams: { percent: pct },
          })
        }
      }
    })

    child.stderr?.on('data', (chunk: Buffer) => {
      stdout += stderrDecoder.write(chunk)
    })

    child.on('error', (err) => {
      sendRepairProgress(getWindow(), {
        tool: 'chkdsk',
        phase: 'failed',
        percent: 0,
        message: `CHKDSK failed to start: ${err.message}`,
        messageCode: 'startFailed',
        messageParams: { error: err.message },
      })
      settle({
        tool: 'chkdsk',
        success: false,
        exitCode: null,
        summary: `Failed to start CHKDSK: ${err.message}`,
        summaryCode: 'startFailed',
        summaryParams: { error: err.message },
        log: stdout,
        requiresReboot: false,
        needsAdmin: false,
      })
    })

    child.on('close', (code) => {
      // CHKDSK exit codes: 0 = no errors, 1 = errors found & fixed,
      // 2 = cleanup performed, 3 = could not check the disk.
      // Codes 0–2 are successful completions.
      const success = code !== null && code <= 2
      let summary: string
      let summaryCode: DiskRepairSummaryCode
      if (stdout.includes('Windows has scanned the file system and found no problems')) {
        summary = 'No file system errors found — disk is healthy.'
        summaryCode = 'chkdskHealthy'
      } else if (stdout.includes('Windows has made corrections to the file system')) {
        summary = 'File system errors were found and repaired.'
        summaryCode = 'chkdskFixed'
      } else if (stdout.includes('no further action is required')) {
        summary = 'CHKDSK completed — no further action required.'
        summaryCode = 'chkdskCompleted'
      } else if (code === 1) {
        summary = 'Errors were found and fixed successfully.'
        summaryCode = 'chkdskFixed'
      } else if (code === 2) {
        summary = 'CHKDSK completed disk cleanup.'
        summaryCode = 'chkdskCleanup'
      } else if (code === 0) {
        summary = 'CHKDSK completed successfully.'
        summaryCode = 'chkdskCompleted'
      } else {
        summary = `CHKDSK exited with code ${code}. Check the log for details.`
        summaryCode = 'chkdskExitCode'
      }

      const requiresReboot = /restart your computer|schedule.*check.*restart|cannot run.*volume is in use/i.test(stdout)
      sendRepairProgress(getWindow(), {
        tool: 'chkdsk',
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary,
      })
      settle({
        tool: 'chkdsk',
        success,
        exitCode: code,
        summary,
        summaryCode,
        ...(summaryCode === 'chkdskExitCode' ? { summaryParams: { code: String(code) } } : {}),
        log: stdout,
        requiresReboot,
        needsAdmin: false,
      })
    })
  })
}

// ── IPC registration ──

export function registerDiskAnalyzerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DISK_DRIVES, (event) => (validateSender(event, getWindow()) ? getDrives() : []))

  ipcMain.handle(IPC.DISK_FILE_TYPES, async (event, drive: string): Promise<FileTypeInfo[]> => {
    if (!validateSender(event, getWindow())) return []
    return getFileTypes(drive, getWindow())
  })

  ipcMain.handle(IPC.DISK_ANALYZE, async (event, drive: string): Promise<DiskNode> => {
    if (!validateSender(event, getWindow())) return { name: '', path: '', size: 0, children: [] }
    return analyzeDisk(drive, getWindow())
  })

  // Disk repair
  ipcMain.handle(IPC.DISK_REPAIR_SFC, async (event, drive: unknown): Promise<DiskRepairResult> => {
    if (!validateSender(event, getWindow()))
      return {
        tool: 'sfc',
        success: false,
        exitCode: null,
        summary: 'Invalid sender',
        summaryCode: 'invalidSender',
        log: '',
        requiresReboot: false,
        needsAdmin: false,
      }
    const safeDrive = typeof drive === 'string' && /^[A-Za-z]$/.test(drive) ? drive : 'C'
    getLogger().info('disk-analyzer', `IPC: running SFC scan on ${safeDrive}`)
    const result = await runSfc(safeDrive, getWindow)
    if (result.success) {
      getLogger().success('disk-analyzer', `SFC completed on ${safeDrive}: ${result.summary}`)
    } else {
      getLogger().error('disk-analyzer', `SFC failed on ${safeDrive}: ${result.summary}`)
    }
    return result
  })

  ipcMain.handle(IPC.DISK_REPAIR_DISM, async (event): Promise<DiskRepairResult> => {
    if (!validateSender(event, getWindow()))
      return {
        tool: 'dism',
        success: false,
        exitCode: null,
        summary: 'Invalid sender',
        summaryCode: 'invalidSender',
        log: '',
        requiresReboot: false,
        needsAdmin: false,
      }
    getLogger().info('disk-analyzer', 'IPC: running DISM RestoreHealth')
    const result = await runDism(getWindow)
    if (result.success) {
      getLogger().success('disk-analyzer', `DISM completed: ${result.summary}`)
    } else {
      getLogger().error('disk-analyzer', `DISM failed: ${result.summary}`)
    }
    return result
  })

  ipcMain.handle(IPC.DISK_REPAIR_CHKDSK, async (event, drive: unknown): Promise<DiskRepairResult> => {
    if (!validateSender(event, getWindow()))
      return {
        tool: 'chkdsk',
        success: false,
        exitCode: null,
        summary: 'Invalid sender',
        summaryCode: 'invalidSender',
        log: '',
        requiresReboot: false,
        needsAdmin: false,
      }
    const safeDrive = typeof drive === 'string' && /^[A-Za-z]$/.test(drive) ? drive : 'C'
    getLogger().info('disk-analyzer', `IPC: running CHKDSK on ${safeDrive}`)
    const result = await runChkdsk(safeDrive, getWindow)
    if (result.success) {
      getLogger().success('disk-analyzer', `CHKDSK completed on ${safeDrive}: ${result.summary}`)
    } else {
      getLogger().error('disk-analyzer', `CHKDSK failed on ${safeDrive}: ${result.summary}`)
    }
    return result
  })
}
