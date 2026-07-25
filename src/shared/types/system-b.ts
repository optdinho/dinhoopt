// ─── Disk & File Info ───────────────────────────────────────

export interface DiskNode {
  name: string
  path: string
  size: number
  children?: DiskNode[]
  isFile?: boolean
}

export interface DriveInfo {
  letter: string
  label: string
  totalSize: number
  freeSpace: number
  usedSpace: number
}

export interface FileTypeInfo {
  extension: string
  totalSize: number
  fileCount: number
}

// ─── Firewall Audit (Windows-only) ──────────────────────────
export type FirewallProfile = 'Domain' | 'Private' | 'Public' | 'Any'
export type FirewallSignatureStatus = 'signed' | 'unsigned' | 'unknown' | 'not-applicable'
export type FirewallIssue = 'stale' | 'unsigned' | 'broad-scope' | 'any-remote'
export type FirewallRiskLevel = 'high' | 'medium' | 'low'

export interface FirewallRule {
  // Internal name (used as -Name when disabling/removing). Unique per rule.
  name: string
  displayName: string
  description: string
  group: string
  profiles: FirewallProfile[]
  protocol: string
  localPort: string
  remoteAddress: string
  // Raw program path as Windows stores it (may contain %SystemRoot% etc.)
  program: string
  // Expanded/resolved absolute path. Empty if rule has no program filter.
  programResolved: string
  programExists: boolean
  signature: FirewallSignatureStatus
  // Microsoft-shipped rule: program lives under Windows/Program Files OR the
  // description is an MUI resource reference (e.g. "@FirewallAPI.dll,-25000").
  // We suppress broad-scope/any-remote findings on these — they're default
  // system rules and removing them tends to break Windows features.
  builtin: boolean
  enabled: boolean
  issues: FirewallIssue[]
  risk: FirewallRiskLevel
  selected: boolean
}

export interface FirewallScanResult {
  rules: FirewallRule[]
  totalCount: number
  staleCount: number
  unsignedCount: number
  broadScopeCount: number
}

export interface FirewallApplyResult {
  succeeded: number
  failed: number
  errors: { name: string; displayName: string; reason: string }[]
}

export interface FirewallScanProgress {
  phase: 'enumerating' | 'classifying' | 'verifying'
  current: number
  total: number
  currentRule: string
}

export type FirewallAction = 'disable' | 'delete'

// ─── Disk Repair ───────────────────────────────────────────
export interface DiskRepairProgress {
  tool: 'sfc' | 'dism' | 'chkdsk'
  phase: 'running' | 'done' | 'failed'
  percent: number
  message: string
}

export interface DiskRepairResult {
  tool: 'sfc' | 'dism' | 'chkdsk'
  success: boolean
  exitCode: number | null
  summary: string
  log: string
  requiresReboot: boolean
  needsAdmin: boolean
}

// ─── Disk Maintenance (SSD TRIM) ───────────────────────────
export type TrimMediaType = 'SSD' | 'NVMe' | 'HDD' | 'Unknown'
export type TrimSupport = 'supported' | 'disabled' | 'unsupported' | 'macos-managed'
export type TrimStatus = 'recently-trimmed' | 'ok' | 'recommended' | 'not-applicable' | 'disabled' | 'unknown'

/**
 * One row in the Disk Maintenance UI.
 * `id` is the stable key — Windows: drive letter ('C'); Linux: mountpoint; macOS: BSD name.
 */
export interface TrimDriveInfo {
  id: string
  letter?: string
  mountPoint?: string
  label: string
  totalSize: number
  freeSpace: number
  mediaType: TrimMediaType
  busType?: string
  filesystem?: string
  isRemovable: boolean
  isEncrypted: boolean
  trimSupport: TrimSupport
  status: TrimStatus
  statusReason: string
  lastTrimAt: number | null
  estimatedDiscardBytes?: number
}

export interface TrimRunResult {
  driveId: string
  success: boolean
  needsAdmin?: boolean
  throttled?: boolean
  bytesDiscarded?: number
  durationMs: number
  exitCode: number | null
  summary: string
  log: string
  timestamp: number
}

export interface TrimProgress {
  driveId: string
  phase: 'starting' | 'running' | 'done' | 'failed'
  /** -1 = indeterminate (Windows Optimize-Volume doesn't report clean percentages) */
  percent: number
  message: string
}

// ─── Context Menu Cleaner ──────────────────────────────────────────────

export type ContextMenuEntryKind = 'verb' | 'handler'

export type ContextMenuScope =
  | 'AllFiles'
  | 'Directory'
  | 'DirectoryBackground'
  | 'Folder'
  | 'Drive'
  | 'AllFilesystemObjects'
  | 'ProgID'

export type ContextMenuHive = 'HKCR' | 'HKCU'

export type ContextMenuSource =
  | '7-Zip'
  | 'WinRAR'
  | 'OneDrive'
  | 'Notepad++'
  | 'VSCode'
  | 'Defender'
  | 'Git'
  | 'Dropbox'
  | 'Google Drive'
  | 'PowerToys'
  | 'Microsoft'
  | 'Windows'
  | 'Unknown'

export type ContextMenuStatus = 'enabled' | 'disabled'

export type ContextMenuAction = 'disable' | 'enable' | 'delete'

export interface ContextMenuEntry {
  id: string
  kind: ContextMenuEntryKind
  keyPath: string
  name: string
  displayName: string
  scope: ContextMenuScope
  hive: ContextMenuHive
  clsid: string | null
  dllPath: string | null
  command: string | null
  source: ContextMenuSource
  status: ContextMenuStatus
  protected: boolean
  requiresAdmin: boolean
  selected: boolean
}

export interface ContextMenuScanResult {
  entries: ContextMenuEntry[]
  scanDuration: number
  scanned: number
}

export interface ContextMenuApplyRequest {
  entryId: string
  action: ContextMenuAction
}

export interface ContextMenuApplyResult {
  succeeded: number
  failed: number
  errors: { entryId: string; displayName: string; reason: string }[]
  updates: { entryId: string; status: ContextMenuStatus }[]
}

export interface ContextMenuApplyProgress {
  current: number
  total: number
  currentLabel: string
}

// ─── Windows Tweaks ────────────────────────────────────────

export type WindowsTweakCategory =
  | 'mouse'
  | 'keyboard'
  | 'accessibility'
  | 'network'
  | 'gpu'
  | 'system'
  | 'gaming'
  | 'privacy'
  | 'mmcss'
  | 'energy'

export type WindowsTweakLevel = 'basico' | 'medio' | 'full'

export interface WindowsTweakDef {
  id: string
  name: string
  description: string
  category: WindowsTweakCategory
  level: WindowsTweakLevel
  hive: 'HKEY_CURRENT_USER' | 'HKEY_LOCAL_MACHINE'
  path: string
  key: string
  kind: 'DWord' | 'String'
  defaultValue: string | number
  optimizedValue: string | number
  experimental?: boolean
  requiresAdmin?: boolean
  needsReboot?: boolean
  needsLogoff?: boolean
}

export interface WindowsTweakState {
  applied: boolean
  tweak: WindowsTweakDef
}

export interface DnsPreset {
  name: string
  primary: string
  secondary: string
}

export interface WindowsTweakApplyProgress {
  current: number
  total: number
  currentTweak: string
}

export interface WindowsTweakResult {
  succeeded: number
  failed: number
  errors: { id: string; name: string; reason: string }[]
  rebootRequired: { id: string; name: string }[]
  logoffRequired: { id: string; name: string }[]
}

// ─── Power Plans ────────────────────────────────────────────

export interface PowerPlanInfo {
  guid: string
  name: string
  description: string
  isActive: boolean
  isHighPerformance: boolean
  isBalanced: boolean
  isPowerSaver: boolean
}

export interface PowerPlanActivateResult {
  success: boolean
  error?: string
}

export interface PowerPlanCreateResult {
  success: boolean
  guid?: string
  error?: string
}

export interface PowerPlanDeleteResult {
  success: boolean
  error?: string
}

// ─── HOSTS Editor ────────────────────────────────────────

export interface HostsEntry {
  id: string
  ip: string
  hostname: string
  comment: string
  enabled: boolean
}

export interface HostsFileData {
  headerComment: string
  entries: HostsEntry[]
}

export interface HostsWriteRequest {
  headerComment: string
  entries: HostsEntry[]
}

// ─── Winapp2 Import ──────────────────────────────────────

export interface Winapp2Section {
  sectionName: string
  originalName: string
  suffix: '' | '*' | '%' | '!' | '?'
  langSecRef?: number
  default: boolean
  detect: string[]
  detectFile: string[]
  detectHklm: string[]
  detectHkcu: string[]
  detectHkcuSoftware: string[]
  fileKeys: Winapp2FileKey[]
  regKeys: string[]
  warning: boolean
}

export interface Winapp2FileKey {
  path: string
  fileMask: string
  recurse: boolean
  removeSelf: boolean
}

export interface Winapp2ParseResult {
  sections: Winapp2Section[]
  totalSections: number
}
