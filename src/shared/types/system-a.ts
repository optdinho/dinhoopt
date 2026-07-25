// ─── Registry ──────────────────────────────────────────────────
export interface RegistryFixAction {
  op: 'delete-value' | 'delete-key' | 'set-value' | 'disable-task' | 'delete-task'
  key?: string // full registry key (overrides keyPath if abbreviated)
  value?: string // value name (overrides valueName if different)
  regType?: string // REG_DWORD, REG_SZ
  data?: string // value data to set
}

export interface RegistryEntry {
  id: string
  type:
    | 'obsolete'
    | 'invalid'
    | 'orphaned'
    | 'broken'
    | 'vulnerability'
    | 'privacy'
    | 'performance'
    | 'network'
    | 'service'
    | 'task'
  keyPath: string
  valueName: string
  issue: string
  risk: 'low' | 'medium' | 'high'
  selected: boolean
  fix?: RegistryFixAction
}

// ─── Startup ───────────────────────────────────────────────────
export interface StartupItem {
  id: string
  name: string
  displayName: string
  command: string
  location: string
  source:
    | 'registry-hkcu'
    | 'registry-hklm'
    | 'startup-folder'
    | 'task-scheduler'
    | 'launch-agent-user'
    | 'launch-agent-global'
    | 'login-item'
    | 'systemd-user'
    | 'autostart-desktop'
    | 'cron'
  enabled: boolean
  publisher: string
  impact: 'high' | 'medium' | 'low' | 'none'
}

export interface StartupBootEntry {
  name: string
  displayName: string
  delayMs: number
  source: StartupItem['source']
  impact: StartupItem['impact']
}

export interface StartupBootTrace {
  totalBootMs: number
  lastBootDate: string | null
  mainPathMs: number
  startupAppsMs: number
  entries: StartupBootEntry[]
  available: boolean
  needsAdmin: boolean
}

export interface StartupSafetyRating {
  name: string
  safetyScore: number
  description: string
  analyzedAt: string
}

export interface StartupSafetyResult {
  ratings: StartupSafetyRating[]
  pending: number
}

// ─── Debloater / Network ───────────────────────────────────────
export interface BloatwareApp {
  id: string
  name: string
  packageName: string
  publisher: string
  category: 'microsoft' | 'oem' | 'gaming' | 'media' | 'communication' | 'utility'
  description: string
  size: string
  selected: boolean
}

export interface NetworkItem {
  id: string
  type: 'dns-cache' | 'wifi-profile' | 'arp-cache' | 'network-history'
  label: string
  detail: string
  selected: boolean
}

export interface NetworkCleanResult {
  cleaned: number
  failed: number
  details: string[]
}

// ─── Driver Manager ─────────────────────────────────────────
export interface DriverPackage {
  id: string
  publishedName: string // e.g. "oem42.inf"
  originalName: string // e.g. "nvlddmkm.inf"
  provider: string
  className: string // e.g. "Display adapters"
  version: string
  date: string
  signer: string
  folderPath: string // full path in FileRepository
  size: number // bytes
  isCurrent: boolean // true = actively bound to hardware
  selected: boolean
}

export interface DriverScanResult {
  packages: DriverPackage[]
  totalStaleSize: number
  totalStaleCount: number
  totalCurrentCount: number
}

export interface DriverCleanResult {
  removed: number
  failed: number
  spaceRecovered: number
  errors: { publishedName: string; reason: string }[]
}

export interface DriverScanProgress {
  phase: 'enumerating' | 'analyzing' | 'measuring'
  current: number
  total: number
  currentDriver: string
}

export interface DriverUpdate {
  id: string
  updateId: string // Windows Update Identity.UpdateID (used for install matching)
  deviceName: string
  deviceId: string
  className: string
  currentVersion: string
  currentDate: string
  availableVersion: string
  availableDate: string
  provider: string
  updateTitle: string // Windows Update title string
  downloadSize: string // human-readable size from WU
  selected: boolean
}

export interface DriverUpdateScanResult {
  updates: DriverUpdate[]
  totalAvailable: number
  scanDuration: number
}

export interface DriverUpdateInstallResult {
  installed: number
  failed: number
  rebootRequired: boolean
  errors: { deviceName: string; reason: string }[]
}

export interface DriverUpdateProgress {
  phase: 'checking' | 'downloading' | 'installing'
  current: number
  total: number
  currentDevice: string
  percent: number
}

// ─── Program Uninstaller ────────────────────────────────────
export interface InstalledProgram {
  id: string
  displayName: string
  publisher: string
  displayVersion: string
  installDate: string
  estimatedSize: number
  installLocation: string
  uninstallString: string
  quietUninstallString: string
  displayIcon: string
  registryKey: string
  isSystemComponent: boolean
  isWindowsInstaller: boolean
  lastUsed: number // timestamp ms, 0 = unknown/never seen in Prefetch
}

export interface UninstallerListResult {
  programs: InstalledProgram[]
  totalCount: number
}

export interface UninstallProgress {
  phase: 'listing' | 'uninstalling' | 'scanning-leftovers' | 'cleaning-leftovers' | 'force-removing'
  currentProgram: string
  progress: number
  detail: string
}

export interface UninstallResult {
  success: boolean
  programName: string
  exitCode: number | null
  error?: string
  leftoversFound: number
  leftoversCleaned: number
  leftoversSize: number
}

// ─── Service Manager ────────────────────────────────────────
export type ServiceStatus = 'Running' | 'Stopped' | 'StartPending' | 'StopPending' | 'Paused' | 'Unknown'

export type ServiceStartType = 'Automatic' | 'AutomaticDelayed' | 'Manual' | 'Disabled' | 'Boot' | 'System' | 'Unknown'

export type ServiceSafety = 'safe' | 'caution' | 'unsafe'

export type ServiceCategory =
  | 'telemetry'
  | 'xbox'
  | 'print'
  | 'fax'
  | 'media'
  | 'network'
  | 'bluetooth'
  | 'remote'
  | 'hyper-v'
  | 'developer'
  | 'misc'
  | 'core'
  | 'security'
  | 'unknown'

export interface WindowsService {
  name: string
  displayName: string
  description: string
  status: ServiceStatus
  startType: ServiceStartType
  safety: ServiceSafety
  category: ServiceCategory
  isMicrosoft: boolean
  dependsOn: string[]
  dependents: string[]
  selected: boolean
  originalStartType: ServiceStartType
  incompatibleGames?: string[]
}

export interface ServiceScanResult {
  services: WindowsService[]
  totalCount: number
  runningCount: number
  disabledCount: number
  safeToDisableCount: number
}

export interface ServiceApplyResult {
  succeeded: number
  failed: number
  errors: { name: string; displayName: string; reason: string }[]
}

export interface ServiceScanProgress {
  phase: 'enumerating' | 'classifying'
  current: number
  total: number
  currentService: string
}
