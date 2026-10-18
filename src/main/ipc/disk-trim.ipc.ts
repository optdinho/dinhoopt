import { spawn } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'
import { IPC } from '@shared/channels'
import type {
  TrimDriveInfo,
  TrimMediaType,
  TrimProgress,
  TrimReasonCode,
  TrimRunResult,
  TrimStatus,
  TrimSummaryCode,
  TrimSupport,
} from '@shared/types'
import { ipcMain } from 'electron'
import { isAdmin } from '../services/elevation'
import { execFileAsync, psUtf8, trackChildProcess } from '../services/exec-utf8'
import { getLogger } from '../services/logger.service'
import { getLastTrimAt, isThrottled, setLastTrimAt } from '../services/trim-history-store'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

// Module-level mutex: only one TRIM batch may run at a time.
let runningBatch = false

const SEVEN_DAYS = 7 * 24 * 60 * 60 * 1000
const THIRTY_DAYS = 30 * 24 * 60 * 60 * 1000

// ── Status heuristic ──

export interface TrimStatusInfo {
  status: TrimStatus
  reason: string
  reasonCode: TrimReasonCode
  reasonParams?: Record<string, string | number>
}

export function computeStatus(drive: Partial<TrimDriveInfo>, now = Date.now()): TrimStatusInfo {
  if (drive.mediaType === 'HDD') {
    return { status: 'not-applicable', reason: 'HDDs do not benefit from TRIM.', reasonCode: 'hdd' }
  }
  if (drive.isRemovable) {
    return {
      status: 'not-applicable',
      reason: 'Removable drive — TRIM is not recommended.',
      reasonCode: 'removable',
    }
  }
  if (drive.trimSupport === 'unsupported') {
    return {
      status: 'not-applicable',
      reason: 'The filesystem or device does not support TRIM/DISCARD.',
      reasonCode: 'unsupported',
    }
  }
  if (drive.trimSupport === 'disabled') {
    return {
      status: 'disabled',
      reason: 'TRIM is disabled at the system level (DisableDeleteNotify).',
      reasonCode: 'disabled',
    }
  }
  if (drive.lastTrimAt && now - drive.lastTrimAt < SEVEN_DAYS) {
    const days = Math.max(1, Math.round((now - drive.lastTrimAt) / (24 * 60 * 60 * 1000)))
    return {
      status: 'recently-trimmed',
      reason: `Trimmed ${days} day${days === 1 ? '' : 's'} ago — no action needed.`,
      reasonCode: 'recentlyTrimmed',
      reasonParams: { days },
    }
  }
  if (drive.lastTrimAt && now - drive.lastTrimAt > THIRTY_DAYS) {
    return { status: 'recommended', reason: 'Last TRIM was over 30 days ago.', reasonCode: 'recommendedStale' }
  }
  if (!drive.lastTrimAt) {
    return {
      status: 'unknown',
      reason: 'No TRIM history recorded — the OS may already be handling it on a schedule.',
      reasonCode: 'unknown',
    }
  }
  return { status: 'ok', reason: 'Healthy — last TRIM is recent enough.', reasonCode: 'ok' }
}

/**
 * DISCARD needs a filesystem that understands it — NTFS and ReFS on Windows.
 * An unreadable/absent filesystem cannot be trimmed, so it counts as unsupported.
 */
function isDiscardCapableFilesystem(fs: string | null | undefined): boolean {
  const s = (fs ?? '').trim().toUpperCase()
  return s === 'NTFS' || s === 'REFS'
}

// ── Windows ──

interface WinPhysicalDisk {
  DeviceId?: string | number
  Number?: number
  MediaType?: number | string // PowerShell may return enum int (3=HDD, 4=SSD, 5=SCM, 0=Unspecified) or string
  BusType?: number | string
  FriendlyName?: string
}

interface WinVolume {
  Letter?: string
  Label?: string | null
  FS?: string | null
  Size?: number
  Free?: number
  DiskNumber?: number
  DriveType?: number | string // Get-Volume DriveType is stringified by PS: 'Fixed' | 'Removable' | 'Network' | 'CD-ROM' | 'RAM Disk'
  BitLockerStatus?: string | null
}

function mapMediaType(mediaType: WinPhysicalDisk['MediaType'], busType: WinPhysicalDisk['BusType']): TrimMediaType {
  // Get-PhysicalDisk MediaType: 3=HDD, 4=SSD, 5=SCM, 0=Unspecified
  // Some systems return strings; handle both shapes.
  const m = String(mediaType ?? '').toLowerCase()
  const b = String(busType ?? '').toLowerCase()
  if (b === 'nvme' || b === '17') return 'NVMe'
  if (m === 'ssd' || m === '4') return 'SSD'
  if (m === 'hdd' || m === '3') return 'HDD'
  return 'Unknown'
}

function mapBusType(busType: WinPhysicalDisk['BusType']): string | undefined {
  if (busType == null) return undefined
  const map: Record<string, string> = {
    '1': 'SCSI',
    '2': 'ATAPI',
    '3': 'ATA',
    '4': '1394',
    '5': 'SSA',
    '6': 'Fibre',
    '7': 'USB',
    '8': 'RAID',
    '9': 'iSCSI',
    '10': 'SAS',
    '11': 'SATA',
    '12': 'SD',
    '13': 'MMC',
    '15': 'FileBackedVirtual',
    '16': 'StorageSpaces',
    '17': 'NVMe',
    '18': 'MicroSSD',
  }
  const s = String(busType)
  return map[s] ?? s
}

function isLetterSafe(letter: string): boolean {
  return /^[A-Za-z]$/.test(letter)
}

async function listDrivesWindows(): Promise<TrimDriveInfo[]> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$disks = Get-PhysicalDisk | Select-Object DeviceId, Number, MediaType, BusType, FriendlyName
$ddn = 0
$ddnOut = @()
try { $ddnOut = fsutil behavior query DisableDeleteNotify 2>$null } catch {}
if (($ddnOut -join [char]10) -match 'DisableDeleteNotify\\s*=\\s*(\\d+)') { $ddn = [int]$Matches[1] }
$volumes = @()
Get-Partition | ForEach-Object {
  $p = $_
  $v = $p | Get-Volume -ErrorAction SilentlyContinue
  if ($v -and $v.DriveLetter) {
    $bl = $null
    try { $bl = (Get-BitLockerVolume -MountPoint ("$($v.DriveLetter):") -ErrorAction Stop).ProtectionStatus.ToString() } catch {}
    $volumes += [pscustomobject]@{
      Letter = "$($v.DriveLetter)"
      Label = $v.FileSystemLabel
      FS = $v.FileSystem
      Size = [int64]$v.Size
      Free = [int64]$v.SizeRemaining
      DiskNumber = $p.DiskNumber
      DriveType = "$($v.DriveType)"
      BitLockerStatus = $bl
    }
  }
}
@{ disks = $disks; volumes = $volumes; ddn = $ddn } | ConvertTo-Json -Depth 4 -Compress
`
  let stdout = ''
  try {
    const res = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(script)], {
      timeout: 15000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    })
    stdout = String(res.stdout)
  } catch (err) {
    getLogger().error('disk-trim', 'Failed to enumerate volumes', err instanceof Error ? err.message : String(err))
    return []
  }

  let parsed: {
    disks?: WinPhysicalDisk[] | WinPhysicalDisk
    volumes?: WinVolume[] | WinVolume
    ddn?: number | string
  } = {}
  try {
    parsed = JSON.parse(stdout)
  } catch {
    getLogger().error('disk-trim', 'Failed to parse volume enumeration output')
    return []
  }

  // DisableDeleteNotify: 0 = TRIM enabled (default), 1 = disabled at the OS level.
  const trimDisabledSystemWide = Number(parsed.ddn) === 1
  if (trimDisabledSystemWide) {
    getLogger().warning('disk-trim', 'TRIM is disabled system-wide (DisableDeleteNotify = 1)')
  }

  const disks = Array.isArray(parsed.disks) ? parsed.disks : parsed.disks ? [parsed.disks] : []
  const volumes = Array.isArray(parsed.volumes) ? parsed.volumes : parsed.volumes ? [parsed.volumes] : []
  const diskByNumber = new Map<number, WinPhysicalDisk>()
  for (const d of disks) {
    const num = typeof d.Number === 'number' ? d.Number : Number(d.DeviceId)
    if (!Number.isNaN(num)) diskByNumber.set(num, d)
  }

  const lastTrims = readWindowsLastTrimCache()
  const now = Date.now()

  const result: TrimDriveInfo[] = []
  for (const v of volumes) {
    if (!v.Letter || !isLetterSafe(v.Letter)) continue
    // Network shares are not physical media and never support DISCARD.
    if (String(v.DriveType).toLowerCase() === 'network') continue

    const phys = v.DiskNumber != null ? diskByNumber.get(v.DiskNumber) : undefined
    const mediaType = mapMediaType(phys?.MediaType, phys?.BusType)
    const busType = mapBusType(phys?.BusType)
    const isRemovable = String(v.DriveType).toLowerCase() === 'removable' || (busType ?? '').toUpperCase() === 'USB'

    const id = v.Letter.toUpperCase()
    const lastTrimAt = lastTrims[id] ?? getLastTrimAt(id) ?? null

    // Real capability, no guessing: OS-level toggle wins, then the filesystem.
    const trimSupport: TrimSupport = trimDisabledSystemWide
      ? 'disabled'
      : isDiscardCapableFilesystem(v.FS)
        ? 'supported'
        : 'unsupported'

    const { status, reason, reasonCode, reasonParams } = computeStatus(
      { mediaType, isRemovable, trimSupport, lastTrimAt },
      now,
    )

    result.push({
      id,
      letter: id,
      label: v.Label || `${id}:`,
      totalSize: Number(v.Size) || 0,
      freeSpace: Number(v.Free) || 0,
      mediaType,
      ...(busType ? { busType } : {}),
      ...(v.FS ? { filesystem: v.FS } : {}),
      isRemovable,
      isEncrypted: !!v.BitLockerStatus && v.BitLockerStatus !== 'Off',
      trimSupport,
      status,
      statusReason: reason,
      statusReasonCode: reasonCode,
      ...(reasonParams ? { statusReasonParams: reasonParams } : {}),
      lastTrimAt,
    })
  }
  return result
}

/**
 * Last-retrim timestamps per drive letter, populated by {@link refreshWindowsLastTrim}.
 * Pure cache read (no I/O) so the synchronous volume-mapping loop can use it;
 * `listTrimDrives` refreshes the cache before listing.
 */
function readWindowsLastTrimCache(): Record<string, number> {
  return _winLastTrimCache
}

let _winLastTrimCache: Record<string, number> = {}

async function refreshWindowsLastTrim(): Promise<void> {
  const script = `
$ErrorActionPreference = 'SilentlyContinue'
$events = Get-WinEvent -LogName 'Microsoft-Windows-Defrag/Operational' -MaxEvents 200 -ErrorAction SilentlyContinue |
  Where-Object { $_.Id -eq 258 } |
  ForEach-Object { [pscustomobject]@{ When = $_.TimeCreated.ToUniversalTime().ToString('o'); Msg = $_.Message } }
$events | ConvertTo-Json -Depth 2 -Compress
`
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', psUtf8(script)], {
      timeout: 8000,
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    })
    if (!String(stdout).trim()) {
      _winLastTrimCache = {}
      return
    }
    const data: Array<{ When: string; Msg: string }> = (() => {
      try {
        const j = JSON.parse(String(stdout))
        return Array.isArray(j) ? j : [j]
      } catch {
        return []
      }
    })()
    const out: Record<string, number> = {}
    for (const ev of data) {
      const t = Date.parse(ev.When)
      if (!Number.isFinite(t)) continue
      // Event 258 reads "The storage optimizer successfully completed retrim
      // on (C:)". The "(X:)" token is not localized, so match it directly and
      // fall back to a bare "X:" for other message shapes/OS builds.
      const m = ev.Msg?.match(/\(\s*([A-Za-z])\s*:\s*\)/) ?? ev.Msg?.match(/\b([A-Za-z]):/)
      const letter = m?.[1] ? m[1].toUpperCase() : null
      if (letter && (out[letter] ?? 0) < t) out[letter] = t
    }
    _winLastTrimCache = out
  } catch {
    _winLastTrimCache = {}
  }
}

async function runTrimWindows(letter: string, getWindow: WindowGetter): Promise<TrimRunResult> {
  const start = Date.now()
  const id = letter.toUpperCase()
  if (!isLetterSafe(id)) {
    getLogger().warning('disk-trim', `Invalid drive letter for Windows TRIM: ${letter}`)
    return failResult(id, start, 'Invalid drive letter')
  }
  getLogger().info('disk-trim', `Starting Windows TRIM on ${id}:...`)
  return new Promise((resolve) => {
    let settled = false
    const settle = (result: TrimRunResult): void => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const psCmd = `Optimize-Volume -DriveLetter ${id} -ReTrim -Verbose`
    const child = spawn('cmd', ['/c', `chcp 65001 >nul & powershell.exe -NoProfile -Command "${psCmd}"`], {
      windowsHide: true,
    })
    trackChildProcess(child)
    let log = ''
    const out = new StringDecoder('utf-8')
    const err = new StringDecoder('utf-8')

    sendProgress(getWindow, {
      driveId: id,
      phase: 'starting',
      percent: -1,
      message: `Starting TRIM on ${id}:...`,
      messageCode: 'starting',
    })

    child.stdout?.on('data', (chunk: Buffer) => {
      const text = out.write(chunk)
      log += text
      const line = text.trim()
      if (line)
        sendProgress(getWindow, { driveId: id, phase: 'running', percent: -1, message: line.split('\n').pop() || line })
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      // Optimize-Volume writes -Verbose output to stderr in PS
      const text = err.write(chunk)
      log += text
      for (const raw of text.split('\n')) {
        const line = raw.replace(/^VERBOSE:\s*/, '').trim()
        if (line) sendProgress(getWindow, { driveId: id, phase: 'running', percent: -1, message: line })
      }
    })
    child.on('error', (e) => {
      sendProgress(getWindow, {
        driveId: id,
        phase: 'failed',
        percent: -1,
        message: e.message,
        messageCode: 'startFailed',
        messageParams: { error: e.message },
      })
      settle({
        driveId: id,
        success: false,
        durationMs: Date.now() - start,
        exitCode: null,
        summary: `Failed to start Optimize-Volume: ${e.message}`,
        summaryCode: 'startFailed',
        summaryParams: { error: e.message },
        log,
        timestamp: Date.now(),
      })
    })
    child.on('close', (code) => {
      const success = code === 0
      const summary = success ? `TRIM completed successfully on ${id}.` : `Optimize-Volume exited with code ${code}.`
      sendProgress(getWindow, {
        driveId: id,
        phase: success ? 'done' : 'failed',
        percent: 100,
        message: summary,
        messageCode: success ? 'done' : 'startFailed',
      })
      if (success) setLastTrimAt(id)
      settle({
        driveId: id,
        success,
        durationMs: Date.now() - start,
        exitCode: code,
        summary,
        summaryCode: success ? 'completed' : 'exitCode',
        ...(success ? {} : { summaryParams: { code: String(code) } }),
        log,
        timestamp: Date.now(),
      })
    })
  })
}

// ── Shared helpers ──

function sendProgress(getWindow: WindowGetter, data: TrimProgress): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(IPC.DISK_TRIM_PROGRESS, data)
  }
}

function failResult(driveId: string, start: number, summary: string, summaryCode?: TrimSummaryCode): TrimRunResult {
  return {
    driveId,
    success: false,
    durationMs: Date.now() - start,
    exitCode: null,
    summary,
    ...(summaryCode ? { summaryCode } : {}),
    log: '',
    timestamp: Date.now(),
  }
}

// ── Exported core logic ──

export async function listTrimDrives(): Promise<TrimDriveInfo[]> {
  getLogger().info('disk-trim', 'Listing TRIM-capable drives...')
  if (process.platform === 'win32') {
    await refreshWindowsLastTrim()
    const drives = await listDrivesWindows()
    getLogger().success('disk-trim', `Found ${drives.length} drive(s) on Windows`)
    return drives
  }
  getLogger().warning('disk-trim', `Unsupported platform: ${process.platform}`)
  return []
}

export async function runTrimForDrive(
  driveId: string,
  getWindow: WindowGetter,
  drives: TrimDriveInfo[],
): Promise<TrimRunResult> {
  const start = Date.now()
  getLogger().info('disk-trim', `Running TRIM for drive: ${driveId}`)

  const drive = drives.find((d) => d.id === driveId)
  if (!drive) {
    getLogger().warning('disk-trim', `TRIM skipped: unknown drive ${driveId}`)
    return failResult(driveId, start, `Unknown drive: ${driveId}`, 'unknownDrive')
  }
  if (drive.mediaType === 'HDD') {
    getLogger().warning('disk-trim', `TRIM skipped for ${driveId}: HDD`)
    return failResult(driveId, start, 'TRIM is not applicable to HDDs.', 'hdd')
  }
  if (drive.isRemovable) {
    getLogger().warning('disk-trim', `TRIM skipped for ${driveId}: removable drive`)
    return failResult(driveId, start, 'TRIM is not run on removable drives.', 'removable')
  }
  if (drive.trimSupport === 'unsupported' || drive.trimSupport === 'disabled') {
    getLogger().warning('disk-trim', `TRIM skipped for ${driveId}: ${drive.statusReason || 'unsupported'}`)
    return failResult(
      driveId,
      start,
      drive.statusReason || 'TRIM is not supported on this drive.',
      drive.trimSupport === 'disabled' ? 'disabled' : 'unsupported',
    )
  }
  if (isThrottled(driveId)) {
    getLogger().warning('disk-trim', `TRIM throttled for ${driveId}: trimmed less than 24h ago`)
    return {
      driveId,
      success: false,
      throttled: true,
      durationMs: 0,
      exitCode: null,
      summary: 'Throttled — this drive was trimmed less than 24 hours ago.',
      summaryCode: 'throttled',
      log: '',
      timestamp: Date.now(),
    }
  }
  if (!isAdmin()) {
    getLogger().warning('disk-trim', `TRIM skipped for ${driveId}: admin privileges required`)
    return {
      driveId,
      success: false,
      needsAdmin: true,
      durationMs: 0,
      exitCode: null,
      summary: 'Administrator privileges are required to run TRIM.',
      summaryCode: 'needsAdmin',
      log: '',
      timestamp: Date.now(),
    }
  }

  if (process.platform === 'win32') {
    if (!drive.letter) {
      getLogger().warning('disk-trim', `TRIM failed for ${driveId}: missing drive letter`)
      return failResult(driveId, start, 'Missing drive letter', 'missingLetter')
    }
    return runTrimWindows(drive.letter, getWindow)
  }
  getLogger().error('disk-trim', `TRIM failed for ${driveId}: unsupported platform ${process.platform}`)
  return failResult(driveId, start, `Unsupported platform: ${process.platform}`, 'unsupportedPlatform')
}

// ── IPC registration ──

export function registerDiskTrimIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.DISK_TRIM_LIST, async (event) => {
    if (!validateSender(event, getWindow())) return []
    return listTrimDrives()
  })

  ipcMain.handle(IPC.DISK_TRIM_RUN, async (event, driveIds: unknown): Promise<TrimRunResult[]> => {
    if (!validateSender(event, getWindow())) return []
    if (!Array.isArray(driveIds)) {
      getLogger().warning('disk-trim', 'IPC: TRIM run called with non-array driveIds')
      return []
    }
    const ids = driveIds.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length < 256)
    if (ids.length === 0) {
      getLogger().warning('disk-trim', 'IPC: TRIM run called with empty drive list')
      return []
    }

    if (runningBatch) {
      getLogger().warning('disk-trim', 'IPC: TRIM batch rejected — another batch already running')
      return ids.map((id) => ({
        driveId: id,
        success: false,
        durationMs: 0,
        exitCode: null,
        summary: 'Another TRIM batch is already running.',
        summaryCode: 'batchBusy',
        log: '',
        timestamp: Date.now(),
      }))
    }
    runningBatch = true
    try {
      // Re-list drives once per batch so we have authoritative metadata
      const drives = await listTrimDrives()
      const results: TrimRunResult[] = []
      for (const id of ids) {
        results.push(await runTrimForDrive(id, getWindow, drives))
      }
      const succeeded = results.filter((r) => r.success).length
      getLogger().success('disk-trim', `IPC: TRIM batch complete — ${succeeded}/${ids.length} succeeded`)
      return results
    } finally {
      runningBatch = false
    }
  })
}
