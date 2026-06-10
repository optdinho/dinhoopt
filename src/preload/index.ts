import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '@shared/channels'
import type { LicenseResult } from '@shared/types'
import type {
  PlatformInfo,
  PowerPlanInfo,
  PowerPlanActivateResult,
  PowerPlanCreateResult,
  PowerPlanDeleteResult,
  ScanResult,
  CleanResult,
  ProgressData,
  DiskRepairProgress,
  DiskRepairResult,
  TrimDriveInfo,
  TrimRunResult,
  TrimProgress,
  RegistryEntry,
  StartupItem,
  StartupBootTrace,
  DiskNode,
  DriveInfo,
  DiNhoSettings,
  BloatwareApp,
  ScanHistoryEntry,
  NetworkItem,
  NetworkCleanResult,
  MalwareScanResult,
  MalwareScanProgress,
  MalwareActionResult,
  PrivacyShieldState,
  PrivacyApplyResult,
  PrivacyScanProgress,
  ComplianceState,
  ComplianceApplyResult,
  ComplianceScanProgress,
  RestorePointResult,
  RestorePointInfo,
  RestorePointListResult,
  RestorePointDeleteResult,
  RestorePointRestoreResult,
  MemoryInfo,
  MemoryProcess,
  MemoryOptimizeResult,
  MemoryOptimizeProgress,
  DriverScanResult,
  DriverCleanResult,
  DriverScanProgress,
  DriverUpdateScanResult,
  DriverUpdateInstallResult,
  DriverUpdateProgress,
  PerfSystemInfo,
  PerfSnapshot,
  PerfProcessList,
  PerfKillResult,
  DiskSmartInfo,
  UpdateStatus,
  ServiceScanResult,
  ServiceApplyResult,
  ServiceScanProgress,
  FirewallScanResult,
  FirewallApplyResult,
  FirewallScanProgress,
  FirewallAction,
  UninstallerListResult,
  UninstallProgress,
  UninstallResult,
  UpdateCheckResult,
  UpdateProgress,
  UpdateResult,
  FileTypeInfo,
  MalwareAllowlistEntry,
  DuplicateScanOptions,
  DuplicateScanResult,
  DuplicateScanProgress,
  DuplicateDeleteMode,
  DuplicateDeleteResult,
  ShredderEntry,
  ShredderProgress,
  ShredderResult,
  LargeFileScanOptions,
  LargeFileScanResult,
  LargeFileScanProgress,
  LargeFileDeleteMode,
  LargeFileDeleteResult,
  EmptyFolderScanOptions,
  EmptyFolderScanResult,
  EmptyFolderScanProgress,
  EmptyFolderDeleteResult,
  GameModeConfig,
  GameModeActivateResult,
  GameModeDeactivateResult,
  GameModeStatus,
  GameModeProgress,
  GameModeAuditReport,
  StartupSafetyResult,
  ContextMenuApplyProgress,
  ContextMenuApplyRequest,
  ContextMenuApplyResult,
  ContextMenuScanResult,
  WindowsTweakState,
  WindowsTweakApplyProgress,
  WindowsTweakResult,
  DnsPreset,
  BenchmarkResult,
  BenchmarkProgress,
  QuarantineMeta,
  QuarantinedItem,
  YaraRulesInfo,
  PerfQuickStats

} from '@shared/types'

function onEvent<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => { ipcRenderer.removeListener(channel, handler) }
}

const api = {
  // Platform
  platformInfo: (): Promise<PlatformInfo> => ipcRenderer.invoke(IPC.PLATFORM_INFO),

  // Window controls
  windowMinimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

  // System cleaner
  systemScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SYSTEM_SCAN),
  systemClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.SYSTEM_CLEAN, itemIds),

  // Browser cleaner
  browserScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.BROWSER_SCAN),
  browserClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.BROWSER_CLEAN, itemIds),

  // App cleaner
  appScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.APP_SCAN),
  appClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.APP_CLEAN, itemIds),

  // Gaming cleaner
  gamingScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.GAMING_SCAN),
  gamingClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.GAMING_CLEAN, itemIds),

  // Database optimizer
  databaseScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.DATABASE_SCAN),
  databaseClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.DATABASE_CLEAN, itemIds),

  // Uninstall leftovers
  uninstallLeftoversScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_SCAN),
  uninstallLeftoversClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_CLEAN, itemIds),

  // Recycle bin
  recycleBinScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.RECYCLE_BIN_SCAN),
  recycleBinClean: (): Promise<CleanResult> => ipcRenderer.invoke(IPC.RECYCLE_BIN_CLEAN),

  // Shortcut cleaner
  shortcutScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SHORTCUT_SCAN),
  shortcutClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.SHORTCUT_CLEAN, itemIds),

  // Cleaner: open location
  cleanerOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.CLEANER_OPEN_LOCATION, filePath),

  // Environment cleaner
  environmentScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.ENVIRONMENT_SCAN),
  environmentClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.ENVIRONMENT_CLEAN, itemIds),

  // Registry
  registryScan: (): Promise<RegistryEntry[]> => ipcRenderer.invoke(IPC.REGISTRY_SCAN),
  registryFix: (entryIds: string[]): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> =>
    ipcRenderer.invoke(IPC.REGISTRY_FIX, entryIds),
  registryScanCancel: (): Promise<void> => ipcRenderer.invoke(IPC.REGISTRY_SCAN_CANCEL),
  registryFixCancel: (): Promise<void> => ipcRenderer.invoke(IPC.REGISTRY_FIX_CANCEL),
  registrySetTweakIgnored: (signatures: string[], ignored: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.REGISTRY_SET_TWEAK_IGNORED, signatures, ignored),

  // Context Menu Cleaner
  contextMenuScan: (): Promise<ContextMenuScanResult> => ipcRenderer.invoke(IPC.CONTEXT_MENU_SCAN),
  contextMenuScanCancel: (): Promise<void> => ipcRenderer.invoke(IPC.CONTEXT_MENU_SCAN_CANCEL),
  contextMenuApply: (requests: ContextMenuApplyRequest[]): Promise<ContextMenuApplyResult> =>
    ipcRenderer.invoke(IPC.CONTEXT_MENU_APPLY, requests),
  onContextMenuApplyProgress: (callback: (data: ContextMenuApplyProgress) => void) =>
    onEvent(IPC.CONTEXT_MENU_APPLY_PROGRESS, callback),

  // Debloater
  debloaterScan: (): Promise<BloatwareApp[]> => ipcRenderer.invoke(IPC.DEBLOATER_SCAN),
  debloaterRemove: (packageNames: string[]): Promise<{ removed: number; failed: number }> =>
    ipcRenderer.invoke(IPC.DEBLOATER_REMOVE, packageNames),
  onDebloaterRemoveProgress: (callback: (data: { current: number; total: number; currentApp: string; status: 'removing' | 'done' | 'failed' }) => void) =>
    onEvent(IPC.DEBLOATER_REMOVE_PROGRESS, callback),

  // Startup manager
  startupList: (): Promise<StartupItem[]> => ipcRenderer.invoke(IPC.STARTUP_LIST),
  startupToggle: (name: string, location: string, command: string, source: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STARTUP_TOGGLE, name, location, command, source, enabled),
  startupDelete: (name: string, location: string, source: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STARTUP_DELETE, name, location, source),
  startupBootTrace: (): Promise<StartupBootTrace> => ipcRenderer.invoke(IPC.STARTUP_BOOT_TRACE),
  startupSafetyFetch: (): Promise<StartupSafetyResult> => ipcRenderer.invoke(IPC.STARTUP_SAFETY_FETCH),

  // Network cleanup
  networkScan: (): Promise<NetworkItem[]> => ipcRenderer.invoke(IPC.NETWORK_SCAN),
  networkClean: (itemIds: string[]): Promise<NetworkCleanResult> =>
    ipcRenderer.invoke(IPC.NETWORK_CLEAN, itemIds),

  // Disk analyzer
  diskAnalyze: (driveLetter: string): Promise<DiskNode> =>
    ipcRenderer.invoke(IPC.DISK_ANALYZE, driveLetter),
  diskDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke(IPC.DISK_DRIVES),
  diskFileTypes: (driveLetter: string): Promise<FileTypeInfo[]> =>
    ipcRenderer.invoke(IPC.DISK_FILE_TYPES, driveLetter),

  // Disk repair
  diskRepairSfc: (drive: string): Promise<DiskRepairResult> =>
    ipcRenderer.invoke(IPC.DISK_REPAIR_SFC, drive),
  diskRepairDism: (): Promise<DiskRepairResult> =>
    ipcRenderer.invoke(IPC.DISK_REPAIR_DISM),
  diskRepairChkdsk: (drive: string): Promise<DiskRepairResult> =>
    ipcRenderer.invoke(IPC.DISK_REPAIR_CHKDSK, drive),
  onDiskRepairProgress: (callback: (data: DiskRepairProgress) => void) =>
    onEvent(IPC.DISK_REPAIR_PROGRESS, callback),

  // Disk maintenance (SSD TRIM)
  diskTrimList: (): Promise<TrimDriveInfo[]> => ipcRenderer.invoke(IPC.DISK_TRIM_LIST),
  diskTrimRun: (driveIds: string[]): Promise<TrimRunResult[]> =>
    ipcRenderer.invoke(IPC.DISK_TRIM_RUN, driveIds),
  onDiskTrimProgress: (callback: (data: TrimProgress) => void) =>
    onEvent(IPC.DISK_TRIM_PROGRESS, callback),

  // Onboarding
  onboardingGet: (): Promise<boolean> => ipcRenderer.invoke(IPC.ONBOARDING_GET),
  onboardingSet: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC.ONBOARDING_SET, value),

  // Settings
  settingsGet: (): Promise<DiNhoSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (settings: Partial<DiNhoSettings>): Promise<void> =>
    ipcRenderer.invoke(IPC.SETTINGS_SET, settings),
  settingsSelectBackupDir: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.SETTINGS_SELECT_BACKUP_DIR),
  settingsOpenBackupDir: (): Promise<string> =>
    ipcRenderer.invoke(IPC.SETTINGS_OPEN_BACKUP_DIR),

  // Elevation
  elevationCheck: (): Promise<boolean> => ipcRenderer.invoke(IPC.ELEVATION_CHECK),
  elevationRelaunch: (): Promise<void> => ipcRenderer.invoke(IPC.ELEVATION_RELAUNCH),

  // System Restore Point
  createRestorePoint: (description: string): Promise<RestorePointResult> =>
    ipcRenderer.invoke(IPC.RESTORE_POINT_CREATE, description),
  restorePointList: (): Promise<RestorePointListResult> =>
    ipcRenderer.invoke(IPC.RESTORE_POINT_LIST),
  restorePointDelete: (sequenceNumber: number): Promise<RestorePointDeleteResult> =>
    ipcRenderer.invoke(IPC.RESTORE_POINT_DELETE, sequenceNumber),
  restorePointRestore: (sequenceNumber: number): Promise<RestorePointRestoreResult> =>
    ipcRenderer.invoke(IPC.RESTORE_POINT_RESTORE, sequenceNumber),
  enableSystemProtection: (): Promise<RestorePointResult> =>
    ipcRenderer.invoke(IPC.RESTORE_POINT_ENABLE_PROTECTION),

  // Scheduled scans (legacy)
  scheduleNextScan: (): Promise<string | null> => ipcRenderer.invoke(IPC.SCHEDULE_NEXT_SCAN),
  applyStartup: (enabled: boolean): Promise<void> => ipcRenderer.invoke(IPC.SETTINGS_APPLY_STARTUP, enabled),
  applyTray: (enabled: boolean) => ipcRenderer.send(IPC.SETTINGS_APPLY_TRAY, enabled),
  notifyScheduledScanComplete: (totalSize: number, itemCount: number) =>
    ipcRenderer.send(IPC.SCHEDULE_SCAN_COMPLETE, totalSize, itemCount),

  // Multi-schedule
  onScheduleRunTrigger: (callback: (data: { scheduleId: string; scheduleName: string; tasks: string[]; autoApply: boolean }) => void) =>
    onEvent(IPC.SCHEDULE_RUN_TRIGGER, callback),
  scheduleRunComplete: (scheduleId: string, status: string) =>
    ipcRenderer.send(IPC.SCHEDULE_RUN_COMPLETE, scheduleId, status),

  // Scan history
  historyGet: (): Promise<ScanHistoryEntry[]> => ipcRenderer.invoke(IPC.HISTORY_GET),
  historyAdd: (entry: ScanHistoryEntry): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_ADD, entry),
  historyClear: (): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_CLEAR),

  // History push events
  onHistoryChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.HISTORY_CHANGED, handler)
    return () => { ipcRenderer.removeListener(IPC.HISTORY_CHANGED, handler) }
  },
  // Privacy Shield
  privacyScan: (): Promise<PrivacyShieldState> => ipcRenderer.invoke(IPC.PRIVACY_SCAN),
  privacyApply: (ids: string[]): Promise<PrivacyApplyResult> =>
    ipcRenderer.invoke(IPC.PRIVACY_APPLY, ids),
  privacyRevert: (ids: string[]): Promise<PrivacyApplyResult> =>
    ipcRenderer.invoke(IPC.PRIVACY_REVERT, ids),
  onPrivacyProgress: (callback: (data: PrivacyScanProgress) => void) =>
    onEvent(IPC.PRIVACY_PROGRESS, callback),

  // Compliance Auditor
  complianceScan: (): Promise<ComplianceState> => ipcRenderer.invoke(IPC.COMPLIANCE_SCAN),
  complianceApply: (ids: string[]): Promise<ComplianceApplyResult> =>
    ipcRenderer.invoke(IPC.COMPLIANCE_APPLY, ids),
  complianceRevert: (ids: string[]): Promise<ComplianceApplyResult> =>
    ipcRenderer.invoke(IPC.COMPLIANCE_REVERT, ids),
  onComplianceProgress: (callback: (data: ComplianceScanProgress) => void) =>
    onEvent(IPC.COMPLIANCE_PROGRESS, callback),

  // Malware scanner
  malwareScan: (): Promise<MalwareScanResult> => ipcRenderer.invoke(IPC.MALWARE_SCAN),
  malwareQuarantine: (paths: string[], meta?: QuarantineMeta[]): Promise<MalwareActionResult> =>
    ipcRenderer.invoke(IPC.MALWARE_QUARANTINE, paths, meta),
  malwareDelete: (paths: string[]): Promise<MalwareActionResult> =>
    ipcRenderer.invoke(IPC.MALWARE_DELETE, paths),
  malwareRestore: (quarantinedPath: string, originalPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_RESTORE, quarantinedPath, originalPath),
  malwareQuarantineList: (): Promise<QuarantinedItem[]> =>
    ipcRenderer.invoke(IPC.MALWARE_QUARANTINE_LIST),
  malwareIgnore: (path: string, meta?: QuarantineMeta): Promise<MalwareAllowlistEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_IGNORE, path, meta),
  malwareAllowlistList: (): Promise<MalwareAllowlistEntry[]> =>
    ipcRenderer.invoke(IPC.MALWARE_ALLOWLIST_LIST),
  malwareAllowlistRemove: (sha256: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_ALLOWLIST_REMOVE, sha256),
  onMalwareProgress: (callback: (data: MalwareScanProgress) => void) =>
    onEvent(IPC.MALWARE_PROGRESS, callback),
  malwareYaraInfo: (): Promise<YaraRulesInfo> =>
    ipcRenderer.invoke(IPC.MALWARE_YARA_INFO),
  malwareYaraUpdate: (): Promise<{ success: boolean; error?: string; stats?: { rulesCount: number; version: string } }> =>
    ipcRenderer.invoke(IPC.MALWARE_YARA_UPDATE),
  onYaraCompileProgress: (callback: (data: { loaded: number; total: number }) => void) =>
    onEvent(IPC.MALWARE_YARA_COMPILE_PROGRESS, callback),

  // Driver Manager
  driverScan: (): Promise<DriverScanResult> => ipcRenderer.invoke(IPC.DRIVER_SCAN),
  driverClean: (publishedNames: string[]): Promise<DriverCleanResult> =>
    ipcRenderer.invoke(IPC.DRIVER_CLEAN, publishedNames),
  onDriverProgress: (callback: (data: DriverScanProgress) => void) =>
    onEvent(IPC.DRIVER_PROGRESS, callback),

  // Driver Updates
  driverUpdateScan: (): Promise<DriverUpdateScanResult> => ipcRenderer.invoke(IPC.DRIVER_UPDATE_SCAN),
  driverUpdateInstall: (updateIds: string[]): Promise<DriverUpdateInstallResult> =>
    ipcRenderer.invoke(IPC.DRIVER_UPDATE_INSTALL, updateIds),
  onDriverUpdateProgress: (callback: (data: DriverUpdateProgress) => void) =>
    onEvent(IPC.DRIVER_UPDATE_PROGRESS, callback),

  // Performance Monitor
  perfQuickStats: (): Promise<PerfQuickStats> => ipcRenderer.invoke(IPC.PERF_QUICK_STATS),
  perfGetSystemInfo: (): Promise<PerfSystemInfo> => ipcRenderer.invoke(IPC.PERF_GET_SYSTEM_INFO),
  perfStartMonitoring: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_START_MONITORING),
  perfStopMonitoring: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_STOP_MONITORING),
  perfKillProcess: (pid: number): Promise<PerfKillResult> =>
    ipcRenderer.invoke(IPC.PERF_KILL_PROCESS, pid),
  perfGetDiskHealth: (): Promise<DiskSmartInfo[]> =>
    ipcRenderer.invoke(IPC.PERF_DISK_HEALTH),
  onPerfSnapshot: (callback: (data: PerfSnapshot) => void) =>
    onEvent(IPC.PERF_SNAPSHOT, callback),
  onPerfProcessList: (callback: (data: PerfProcessList) => void) =>
    onEvent(IPC.PERF_PROCESS_LIST, callback),

  // Auto-updater
  updaterCheck: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_CHECK),
  updaterDownload: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
  updaterGetStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.UPDATER_GET_STATUS),
  onUpdaterStatus: (callback: (data: UpdateStatus) => void) =>
    onEvent(IPC.UPDATER_STATUS, callback),

  // Service Manager
  serviceScan: (): Promise<ServiceScanResult> => ipcRenderer.invoke(IPC.SERVICE_SCAN),
  serviceApply: (
    changes: { name: string; targetStartType: string }[],
    force?: boolean
  ): Promise<ServiceApplyResult> => ipcRenderer.invoke(IPC.SERVICE_APPLY, changes, force),
  onServiceProgress: (callback: (data: ServiceScanProgress) => void) =>
    onEvent(IPC.SERVICE_PROGRESS, callback),

  // Firewall Audit (Windows-only)
  firewallScan: (): Promise<FirewallScanResult> => ipcRenderer.invoke(IPC.FIREWALL_SCAN),
  firewallApply: (changes: { name: string; action: FirewallAction }[]): Promise<FirewallApplyResult> =>
    ipcRenderer.invoke(IPC.FIREWALL_APPLY, changes),
  onFirewallProgress: (callback: (data: FirewallScanProgress) => void) =>
    onEvent(IPC.FIREWALL_PROGRESS, callback),

  // Program Uninstaller
  uninstallerList: (): Promise<UninstallerListResult> => ipcRenderer.invoke(IPC.UNINSTALLER_LIST),
  uninstallerUninstall: (programId: string): Promise<UninstallResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_UNINSTALL, programId),
  uninstallerForceRemove: (programId: string): Promise<UninstallResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_FORCE_REMOVE, programId),
  onUninstallerProgress: (callback: (data: UninstallProgress) => void) =>
    onEvent(IPC.UNINSTALLER_PROGRESS, callback),
  programSafetyFetch: (): Promise<StartupSafetyResult> => ipcRenderer.invoke(IPC.PROGRAM_SAFETY_FETCH),

  // Software Updater
  softwareUpdateCheck: (): Promise<UpdateCheckResult> =>
    ipcRenderer.invoke(IPC.SOFTWARE_UPDATE_CHECK),
  softwareUpdateRun: (appIds: string[], source?: string): Promise<UpdateResult> =>
    ipcRenderer.invoke(IPC.SOFTWARE_UPDATE_RUN, appIds, source),
  onSoftwareUpdateProgress: (callback: (data: UpdateProgress) => void) =>
    onEvent(IPC.SOFTWARE_UPDATE_PROGRESS, callback),

  // Duplicate Finder
  duplicatesSelectDir: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DUPLICATES_SELECT_DIR),
  duplicatesScan: (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
    ipcRenderer.invoke(IPC.DUPLICATES_SCAN, options),
  duplicatesCancel: (): Promise<void> =>
    ipcRenderer.invoke(IPC.DUPLICATES_CANCEL),
  duplicatesDelete: (paths: string[], mode: DuplicateDeleteMode): Promise<DuplicateDeleteResult> =>
    ipcRenderer.invoke(IPC.DUPLICATES_DELETE, paths, mode),
  duplicatesOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DUPLICATES_OPEN_LOCATION, filePath),
  onDuplicatesProgress: (callback: (data: DuplicateScanProgress) => void) =>
    onEvent(IPC.DUPLICATES_PROGRESS, callback),

  // Large File Finder
  largeFilesSelectDir: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_SELECT_DIR),
  largeFilesScan: (options: LargeFileScanOptions): Promise<LargeFileScanResult> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_SCAN, options),
  largeFilesCancel: (): Promise<void> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_CANCEL),
  largeFilesDelete: (paths: string[], mode: LargeFileDeleteMode): Promise<LargeFileDeleteResult> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_DELETE, paths, mode),
  largeFilesOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_OPEN_LOCATION, filePath),
  onLargeFilesProgress: (callback: (data: LargeFileScanProgress) => void) =>
    onEvent(IPC.LARGE_FILES_PROGRESS, callback),

  // Empty Folder Cleaner
  emptyFoldersSelectDir: (): Promise<string | null> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_SELECT_DIR),
  emptyFoldersScan: (options: EmptyFolderScanOptions): Promise<EmptyFolderScanResult> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_SCAN, options),
  emptyFoldersCancel: (): Promise<void> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_CANCEL),
  emptyFoldersDelete: (paths: string[], mode: string): Promise<EmptyFolderDeleteResult> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_DELETE, paths, mode),
  emptyFoldersOpenLocation: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_OPEN_LOCATION, folderPath),
  onEmptyFoldersProgress: (callback: (data: EmptyFolderScanProgress) => void) =>
    onEvent(IPC.EMPTY_FOLDERS_PROGRESS, callback),

  // File Shredder
  shredderSelectFiles: (): Promise<ShredderEntry[]> =>
    ipcRenderer.invoke(IPC.SHREDDER_SELECT_FILES),
  shredderSelectFolders: (): Promise<ShredderEntry[]> =>
    ipcRenderer.invoke(IPC.SHREDDER_SELECT_FOLDERS),
  shredderShred: (paths: string[]): Promise<ShredderResult> =>
    ipcRenderer.invoke(IPC.SHREDDER_SHRED, paths),
  shredderCancel: (): Promise<void> =>
    ipcRenderer.invoke(IPC.SHREDDER_CANCEL),
  shredderOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.SHREDDER_OPEN_LOCATION, filePath),
  onShredderProgress: (callback: (data: ShredderProgress) => void) =>
    onEvent(IPC.SHREDDER_PROGRESS, callback),

  // Progress events
  onScanProgress: (callback: (data: ProgressData) => void) =>
    onEvent(IPC.SCAN_PROGRESS, callback),
  onRegistryFixProgress: (callback: (data: { current: number; total: number; currentEntry: string }) => void) =>
    onEvent(IPC.REGISTRY_FIX_PROGRESS, callback),

  // Windows Tweaks
  windowsTweaksList: (): Promise<WindowsTweakState[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_LIST),
  windowsTweaksApply: (ids: string[]): Promise<WindowsTweakResult> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_APPLY, ids),
  windowsTweaksRevert: (ids: string[]): Promise<WindowsTweakResult> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_REVERT, ids),
  windowsTweaksStatus: (): Promise<WindowsTweakState[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_STATUS),
  windowsTweaksGetDnsPresets: (): Promise<DnsPreset[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GET_DNS),
  windowsTweaksSetDns: (primary: string, secondary?: string): Promise<boolean> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_SET_DNS, primary, secondary),
  onWindowsTweaksApplyProgress: (callback: (data: WindowsTweakApplyProgress) => void) =>
    onEvent(IPC.WINDOWS_TWEAKS_APPLY_PROGRESS, callback),
  onWindowsTweaksRevertProgress: (callback: (data: WindowsTweakApplyProgress) => void) =>
    onEvent(IPC.WINDOWS_TWEAKS_REVERT_PROGRESS, callback),

  // Benchmark
  benchmarkRun: (): Promise<BenchmarkResult> => ipcRenderer.invoke(IPC.BENCHMARK_RUN),
  benchmarkCancel: (): Promise<void> => ipcRenderer.invoke(IPC.BENCHMARK_CANCEL),
  onBenchmarkProgress: (callback: (data: BenchmarkProgress) => void) =>
    onEvent(IPC.BENCHMARK_PROGRESS, callback),

  // License / Activation
  licenseActivate: (key: string): Promise<LicenseResult> => ipcRenderer.invoke(IPC.LICENSE_ACTIVATE, key),
  licenseStatus: (): Promise<LicenseResult> => ipcRenderer.invoke(IPC.LICENSE_STATUS),
  licenseGetHwid: (): Promise<string> => ipcRenderer.invoke(IPC.LICENSE_GET_HWID),

  // Memory Optimizer
  memoryInfo: (): Promise<{ info: MemoryInfo; processes: MemoryProcess[] }> =>
    ipcRenderer.invoke(IPC.MEMORY_INFO),
  memoryOptimize: (): Promise<MemoryOptimizeResult> =>
    ipcRenderer.invoke(IPC.MEMORY_OPTIMIZE),
  onMemoryProgress: (callback: (data: MemoryOptimizeProgress) => void) =>
    onEvent(IPC.MEMORY_PROGRESS, callback),

  // Game Mode
  gameModeActivate: (config: GameModeConfig): Promise<GameModeActivateResult> =>
    ipcRenderer.invoke(IPC.GAME_MODE_ACTIVATE, config),
  gameModeDeactivate: (): Promise<GameModeDeactivateResult> =>
    ipcRenderer.invoke(IPC.GAME_MODE_DEACTIVATE),
  gameModeStatus: (): Promise<GameModeStatus> =>
    ipcRenderer.invoke(IPC.GAME_MODE_STATUS),
  onGameModeProgress: (callback: (data: GameModeProgress) => void) =>
    onEvent(IPC.GAME_MODE_PROGRESS, callback),
  onGameModeAutoEvent: (callback: (data: { type: 'game-detected' | 'game-exited'; processName: string | null }) => void) =>
    onEvent(IPC.GAME_MODE_AUTO_EVENT, callback),
  gameModeRunAudit: (phase: GameModeAuditReport['phase']): Promise<GameModeAuditReport> =>
    ipcRenderer.invoke(IPC.GAME_MODE_RUN_AUDIT, phase),

  // Power Plans
  powerPlansList: (): Promise<PowerPlanInfo[]> =>
    ipcRenderer.invoke(IPC.POWER_PLANS_LIST),
  powerPlansActivate: (guid: string): Promise<PowerPlanActivateResult> =>
    ipcRenderer.invoke(IPC.POWER_PLANS_ACTIVATE, guid),
  powerPlansCreate: (name: string): Promise<PowerPlanCreateResult> =>
    ipcRenderer.invoke(IPC.POWER_PLANS_CREATE, name),
  powerPlansDelete: (guid: string): Promise<PowerPlanDeleteResult> =>
    ipcRenderer.invoke(IPC.POWER_PLANS_DELETE, guid),

}

export type DiNhoAPI = typeof api

contextBridge.exposeInMainWorld('dinho', api)
