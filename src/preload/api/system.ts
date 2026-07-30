import { IPC, RENDERER_LOG } from '@shared/channels'
import type { AgentEvaluationResult } from '@shared/driver-agent-types'
import type {
  BenchmarkProgress,
  DiNhoSettings,
  DiskNode,
  DiskRepairProgress,
  DiskRepairResult,
  DiskSmartInfo,
  DnsPreset,
  DriveInfo,
  DriverCleanResult,
  DriverScanProgress,
  DriverScanResult,
  DriverUpdateInstallResult,
  DriverUpdateProgress,
  DriverUpdateScanResult,
  DuplicateDeleteMode,
  DuplicateDeleteResult,
  DuplicateScanOptions,
  DuplicateScanProgress,
  DuplicateScanResult,
  EmptyFolderDeleteResult,
  EmptyFolderScanOptions,
  EmptyFolderScanProgress,
  EmptyFolderScanResult,
  FileTypeInfo,
  FirewallAction,
  FirewallApplyResult,
  FirewallScanProgress,
  FirewallScanResult,
  GameModeActivateResult,
  GameModeAuditReport,
  GameModeConfig,
  GameModeDeactivateResult,
  GameModeProgress,
  GameModeStatus,
  LargeFileDeleteMode,
  LargeFileDeleteResult,
  LargeFileScanOptions,
  LargeFileScanProgress,
  LargeFileScanResult,
  LicenseResult,
  LogConfig,
  LogFilter,
  LogsListResult,
  MemoryInfo,
  MemoryOptimizeProgress,
  MemoryOptimizeResult,
  MemoryProcess,
  NetworkCleanResult,
  NetworkItem,
  PerfKillResult,
  PerfProcessList,
  PerfQuickStats,
  PerfSnapshot,
  PerfSystemInfo,
  PlatformInfo,
  PowerPlanActivateResult,
  PowerPlanCreateResult,
  PowerPlanDeleteResult,
  PowerPlanInfo,
  ScanHistoryEntry,
  ServiceApplyResult,
  ServiceScanProgress,
  ServiceScanResult,
  ShredderEntry,
  ShredderProgress,
  ShredderResult,
  StartupBootTrace,
  StartupItem,
  StartupSafetyResult,
  TrimDriveInfo,
  TrimProgress,
  TrimRunResult,
  UninstallerListResult,
  UninstallProgress,
  UninstallResult,
  UpdateCheckResult,
  UpdateProgress,
  UpdateResult,
  UpdateStatus,
  WindowsTweakApplyProgress,
  WindowsTweakResult,
  WindowsTweakState,
} from '@shared/types'
import { ipcRenderer } from 'electron'

function onEvent<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

export const systemMethods = {
  log: (level: string, message: string) => ipcRenderer.send(RENDERER_LOG, level, message),

  platformInfo: (): Promise<PlatformInfo> => ipcRenderer.invoke(IPC.PLATFORM_INFO),

  windowMinimize: () => ipcRenderer.send(IPC.WINDOW_MINIMIZE),
  windowMaximize: () => ipcRenderer.send(IPC.WINDOW_MAXIMIZE),
  windowClose: () => ipcRenderer.send(IPC.WINDOW_CLOSE),

  startupList: (): Promise<StartupItem[]> => ipcRenderer.invoke(IPC.STARTUP_LIST),
  startupToggle: (
    name: string,
    location: string,
    command: string,
    source: string,
    enabled: boolean,
  ): Promise<boolean> => ipcRenderer.invoke(IPC.STARTUP_TOGGLE, name, location, command, source, enabled),
  startupDelete: (name: string, location: string, source: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.STARTUP_DELETE, name, location, source),
  startupBootTrace: (): Promise<StartupBootTrace> => ipcRenderer.invoke(IPC.STARTUP_BOOT_TRACE),
  startupSafetyFetch: (): Promise<StartupSafetyResult> => ipcRenderer.invoke(IPC.STARTUP_SAFETY_FETCH),

  networkScan: (): Promise<NetworkItem[]> => ipcRenderer.invoke(IPC.NETWORK_SCAN),
  networkClean: (itemIds: string[]): Promise<NetworkCleanResult> => ipcRenderer.invoke(IPC.NETWORK_CLEAN, itemIds),

  diskAnalyze: (driveLetter: string): Promise<DiskNode> => ipcRenderer.invoke(IPC.DISK_ANALYZE, driveLetter),
  diskDrives: (): Promise<DriveInfo[]> => ipcRenderer.invoke(IPC.DISK_DRIVES),
  diskFileTypes: (driveLetter: string): Promise<FileTypeInfo[]> => ipcRenderer.invoke(IPC.DISK_FILE_TYPES, driveLetter),

  diskRepairSfc: (drive: string): Promise<DiskRepairResult> => ipcRenderer.invoke(IPC.DISK_REPAIR_SFC, drive),
  diskRepairDism: (): Promise<DiskRepairResult> => ipcRenderer.invoke(IPC.DISK_REPAIR_DISM),
  diskRepairChkdsk: (drive: string): Promise<DiskRepairResult> => ipcRenderer.invoke(IPC.DISK_REPAIR_CHKDSK, drive),
  onDiskRepairProgress: (callback: (data: DiskRepairProgress) => void) => onEvent(IPC.DISK_REPAIR_PROGRESS, callback),

  diskTrimList: (): Promise<TrimDriveInfo[]> => ipcRenderer.invoke(IPC.DISK_TRIM_LIST),
  diskTrimRun: (driveIds: string[]): Promise<TrimRunResult[]> => ipcRenderer.invoke(IPC.DISK_TRIM_RUN, driveIds),
  onDiskTrimProgress: (callback: (data: TrimProgress) => void) => onEvent(IPC.DISK_TRIM_PROGRESS, callback),

  onboardingGet: (): Promise<boolean> => ipcRenderer.invoke(IPC.ONBOARDING_GET),
  onboardingSet: (value: boolean): Promise<void> => ipcRenderer.invoke(IPC.ONBOARDING_SET, value),

  settingsGet: (): Promise<DiNhoSettings> => ipcRenderer.invoke(IPC.SETTINGS_GET),
  settingsSet: (settings: Partial<DiNhoSettings>): Promise<void> => ipcRenderer.invoke(IPC.SETTINGS_SET, settings),
  settingsSelectBackupDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.SETTINGS_SELECT_BACKUP_DIR),
  settingsOpenBackupDir: (): Promise<string> => ipcRenderer.invoke(IPC.SETTINGS_OPEN_BACKUP_DIR),

  elevationCheck: (): Promise<boolean> => ipcRenderer.invoke(IPC.ELEVATION_CHECK),
  elevationRelaunch: (): Promise<void> => ipcRenderer.invoke(IPC.ELEVATION_RELAUNCH),

  applyStartup: (enabled: boolean): Promise<void> => ipcRenderer.invoke(IPC.SETTINGS_APPLY_STARTUP, enabled),
  applyTray: (enabled: boolean) => ipcRenderer.send(IPC.SETTINGS_APPLY_TRAY, enabled),
  notifyScheduledScanComplete: (totalSize: number, itemCount: number) =>
    ipcRenderer.send(IPC.SCHEDULE_SCAN_COMPLETE, totalSize, itemCount),

  onScheduleRunTrigger: (
    callback: (data: { scheduleId: string; scheduleName: string; tasks: string[]; autoApply: boolean }) => void,
  ) => onEvent(IPC.SCHEDULE_RUN_TRIGGER, callback),
  scheduleRunComplete: (scheduleId: string, status: string) =>
    ipcRenderer.send(IPC.SCHEDULE_RUN_COMPLETE, scheduleId, status),

  historyGet: (): Promise<ScanHistoryEntry[]> => ipcRenderer.invoke(IPC.HISTORY_GET),
  historyAdd: (entry: ScanHistoryEntry): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_ADD, entry),
  historyClear: (): Promise<void> => ipcRenderer.invoke(IPC.HISTORY_CLEAR),

  onHistoryChanged: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC.HISTORY_CHANGED, handler)
    return () => {
      ipcRenderer.removeListener(IPC.HISTORY_CHANGED, handler)
    }
  },

  driverScan: (): Promise<DriverScanResult> => ipcRenderer.invoke(IPC.DRIVER_SCAN),
  driverClean: (publishedNames: string[]): Promise<DriverCleanResult> =>
    ipcRenderer.invoke(IPC.DRIVER_CLEAN, publishedNames),
  onDriverProgress: (callback: (data: DriverScanProgress) => void) => onEvent(IPC.DRIVER_PROGRESS, callback),

  driverUpdateScan: (): Promise<DriverUpdateScanResult> => ipcRenderer.invoke(IPC.DRIVER_UPDATE_SCAN),
  driverUpdateInstall: (updateIds: string[]): Promise<DriverUpdateInstallResult> =>
    ipcRenderer.invoke(IPC.DRIVER_UPDATE_INSTALL, updateIds),
  onDriverUpdateProgress: (callback: (data: DriverUpdateProgress) => void) =>
    onEvent(IPC.DRIVER_UPDATE_PROGRESS, callback),

  driverAgentEvaluate: (): Promise<AgentEvaluationResult> => ipcRenderer.invoke(IPC.DRIVER_AGENT_EVALUATE),
  driverAgentApprove: (updateIds: string[]): Promise<{ success: boolean; error?: string; rebootRequired?: boolean }> =>
    ipcRenderer.invoke(IPC.DRIVER_AGENT_APPROVE, { updateIds }),

  perfQuickStats: (): Promise<PerfQuickStats> => ipcRenderer.invoke(IPC.PERF_QUICK_STATS),
  perfGetSystemInfo: (): Promise<PerfSystemInfo> => ipcRenderer.invoke(IPC.PERF_GET_SYSTEM_INFO),
  perfStartMonitoring: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_START_MONITORING),
  perfStopMonitoring: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_STOP_MONITORING),
  perfStartProcessPolling: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_START_PROCESS_POLLING),
  perfStopProcessPolling: (): Promise<void> => ipcRenderer.invoke(IPC.PERF_STOP_PROCESS_POLLING),
  perfKillProcess: (pid: number): Promise<PerfKillResult> => ipcRenderer.invoke(IPC.PERF_KILL_PROCESS, pid),
  perfGetDiskHealth: (): Promise<DiskSmartInfo[]> => ipcRenderer.invoke(IPC.PERF_DISK_HEALTH),
  onPerfSnapshot: (callback: (data: PerfSnapshot) => void) => onEvent(IPC.PERF_SNAPSHOT, callback),
  onPerfProcessList: (callback: (data: PerfProcessList) => void) => onEvent(IPC.PERF_PROCESS_LIST, callback),

  updaterCheck: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_CHECK),
  updaterDownload: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_DOWNLOAD),
  updaterInstall: (): Promise<void> => ipcRenderer.invoke(IPC.UPDATER_INSTALL),
  updaterGetStatus: (): Promise<UpdateStatus> => ipcRenderer.invoke(IPC.UPDATER_GET_STATUS),
  onUpdaterStatus: (callback: (data: UpdateStatus) => void) => onEvent(IPC.UPDATER_STATUS, callback),

  serviceScan: (): Promise<ServiceScanResult> => ipcRenderer.invoke(IPC.SERVICE_SCAN),
  serviceApply: (changes: { name: string; targetStartType: string }[], force?: boolean): Promise<ServiceApplyResult> =>
    ipcRenderer.invoke(IPC.SERVICE_APPLY, changes, force),
  onServiceProgress: (callback: (data: ServiceScanProgress) => void) => onEvent(IPC.SERVICE_PROGRESS, callback),

  firewallScan: (): Promise<FirewallScanResult> => ipcRenderer.invoke(IPC.FIREWALL_SCAN),
  firewallApply: (changes: { name: string; action: FirewallAction }[]): Promise<FirewallApplyResult> =>
    ipcRenderer.invoke(IPC.FIREWALL_APPLY, changes),
  onFirewallProgress: (callback: (data: FirewallScanProgress) => void) => onEvent(IPC.FIREWALL_PROGRESS, callback),

  uninstallerList: (): Promise<UninstallerListResult> => ipcRenderer.invoke(IPC.UNINSTALLER_LIST),
  uninstallerUninstall: (programId: string): Promise<UninstallResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_UNINSTALL, programId),
  uninstallerForceRemove: (programId: string): Promise<UninstallResult> =>
    ipcRenderer.invoke(IPC.UNINSTALLER_FORCE_REMOVE, programId),
  onUninstallerProgress: (callback: (data: UninstallProgress) => void) => onEvent(IPC.UNINSTALLER_PROGRESS, callback),
  programSafetyFetch: (): Promise<StartupSafetyResult> => ipcRenderer.invoke(IPC.PROGRAM_SAFETY_FETCH),

  softwareUpdateCheck: (): Promise<UpdateCheckResult> => ipcRenderer.invoke(IPC.SOFTWARE_UPDATE_CHECK),
  softwareUpdateRun: (appIds: string[], source?: string): Promise<UpdateResult> =>
    ipcRenderer.invoke(IPC.SOFTWARE_UPDATE_RUN, appIds, source),
  onSoftwareUpdateProgress: (callback: (data: UpdateProgress) => void) =>
    onEvent(IPC.SOFTWARE_UPDATE_PROGRESS, callback),

  duplicatesSelectDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.DUPLICATES_SELECT_DIR),
  duplicatesScan: (options: DuplicateScanOptions): Promise<DuplicateScanResult> =>
    ipcRenderer.invoke(IPC.DUPLICATES_SCAN, options),
  duplicatesCancel: (): Promise<void> => ipcRenderer.invoke(IPC.DUPLICATES_CANCEL),
  duplicatesDelete: (paths: string[], mode: DuplicateDeleteMode): Promise<DuplicateDeleteResult> =>
    ipcRenderer.invoke(IPC.DUPLICATES_DELETE, paths, mode),
  duplicatesOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.DUPLICATES_OPEN_LOCATION, filePath),
  onDuplicatesProgress: (callback: (data: DuplicateScanProgress) => void) => onEvent(IPC.DUPLICATES_PROGRESS, callback),

  largeFilesSelectDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.LARGE_FILES_SELECT_DIR),
  largeFilesScan: (options: LargeFileScanOptions): Promise<LargeFileScanResult> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_SCAN, options),
  largeFilesCancel: (): Promise<void> => ipcRenderer.invoke(IPC.LARGE_FILES_CANCEL),
  largeFilesDelete: (paths: string[], mode: LargeFileDeleteMode): Promise<LargeFileDeleteResult> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_DELETE, paths, mode),
  largeFilesOpenLocation: (filePath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.LARGE_FILES_OPEN_LOCATION, filePath),
  onLargeFilesProgress: (callback: (data: LargeFileScanProgress) => void) =>
    onEvent(IPC.LARGE_FILES_PROGRESS, callback),

  emptyFoldersSelectDir: (): Promise<string | null> => ipcRenderer.invoke(IPC.EMPTY_FOLDERS_SELECT_DIR),
  emptyFoldersScan: (options: EmptyFolderScanOptions): Promise<EmptyFolderScanResult> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_SCAN, options),
  emptyFoldersCancel: (): Promise<void> => ipcRenderer.invoke(IPC.EMPTY_FOLDERS_CANCEL),
  emptyFoldersDelete: (paths: string[], mode: string): Promise<EmptyFolderDeleteResult> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_DELETE, paths, mode),
  emptyFoldersOpenLocation: (folderPath: string): Promise<void> =>
    ipcRenderer.invoke(IPC.EMPTY_FOLDERS_OPEN_LOCATION, folderPath),
  onEmptyFoldersProgress: (callback: (data: EmptyFolderScanProgress) => void) =>
    onEvent(IPC.EMPTY_FOLDERS_PROGRESS, callback),

  shredderSelectFiles: (): Promise<ShredderEntry[]> => ipcRenderer.invoke(IPC.SHREDDER_SELECT_FILES),
  shredderSelectFolders: (): Promise<ShredderEntry[]> => ipcRenderer.invoke(IPC.SHREDDER_SELECT_FOLDERS),
  shredderShred: (paths: string[]): Promise<ShredderResult> => ipcRenderer.invoke(IPC.SHREDDER_SHRED, paths),
  shredderCancel: (): Promise<void> => ipcRenderer.invoke(IPC.SHREDDER_CANCEL),
  shredderOpenLocation: (filePath: string): Promise<void> => ipcRenderer.invoke(IPC.SHREDDER_OPEN_LOCATION, filePath),
  onShredderProgress: (callback: (data: ShredderProgress) => void) => onEvent(IPC.SHREDDER_PROGRESS, callback),

  windowsTweaksList: (): Promise<WindowsTweakState[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_LIST),
  windowsTweaksApply: (ids: string[]): Promise<WindowsTweakResult> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_APPLY, ids),
  windowsTweaksRevert: (ids: string[]): Promise<WindowsTweakResult> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_REVERT, ids),
  windowsTweaksStatus: (): Promise<WindowsTweakState[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_STATUS),
  windowsTweaksGetDnsPresets: (): Promise<DnsPreset[]> => ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GET_DNS),
  windowsTweaksSetDns: (primary: string, secondary?: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_SET_DNS, primary, secondary),
  onWindowsTweaksApplyProgress: (callback: (data: WindowsTweakApplyProgress) => void) =>
    onEvent(IPC.WINDOWS_TWEAKS_APPLY_PROGRESS, callback),
  onWindowsTweaksRevertProgress: (callback: (data: WindowsTweakApplyProgress) => void) =>
    onEvent(IPC.WINDOWS_TWEAKS_REVERT_PROGRESS, callback),

  windowsTweaksNetshTcp: (action: 'apply' | 'revert'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_NETSH_TCP, action),

  gamingTimerGet: (): Promise<import('../../main/ipc/windows-tweaks/tweaks/gaming').GamingTimerStatus> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_TIMER_GET),
  gamingTimerSet: (
    settings: Partial<
      Pick<
        import('../../main/ipc/windows-tweaks/tweaks/gaming').GamingTimerStatus,
        'hpetOff' | 'tscSyncPolicy' | 'dynamicTickDisabled'
      >
    >,
  ): Promise<{ success: boolean; errors: string[] }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_TIMER_SET, settings),
  gamingTimerRevert: (): Promise<{ success: boolean; errors: string[] }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_TIMER_REVERT),
  gamingAutoTuning: (action: 'apply' | 'revert'): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.WINDOWS_TWEAKS_GAMING_AUTOTUNING, action),

  hostsRead: (): Promise<import('@shared/types').HostsFileData> => ipcRenderer.invoke(IPC.HOSTS_READ),
  hostsWrite: (request: import('@shared/types').HostsWriteRequest): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(IPC.HOSTS_WRITE, request),
  hostsFlushDns: (): Promise<{ success: boolean; error?: string }> => ipcRenderer.invoke(IPC.HOSTS_FLUSH_DNS),

  benchmarkRun: (): Promise<import('@shared/types').BenchmarkResult> => ipcRenderer.invoke(IPC.BENCHMARK_RUN),
  benchmarkCancel: (): Promise<void> => ipcRenderer.invoke(IPC.BENCHMARK_CANCEL),
  onBenchmarkProgress: (callback: (data: BenchmarkProgress) => void) => onEvent(IPC.BENCHMARK_PROGRESS, callback),

  licenseActivate: (key: string): Promise<LicenseResult> => ipcRenderer.invoke(IPC.LICENSE_ACTIVATE, key),
  licenseStatus: (): Promise<LicenseResult> => ipcRenderer.invoke(IPC.LICENSE_STATUS),
  licenseGetHwid: (): Promise<string> => ipcRenderer.invoke(IPC.LICENSE_GET_HWID),

  memoryInfo: (): Promise<{ info: MemoryInfo; processes: MemoryProcess[] }> => ipcRenderer.invoke(IPC.MEMORY_INFO),
  memoryOptimize: (): Promise<MemoryOptimizeResult> => ipcRenderer.invoke(IPC.MEMORY_OPTIMIZE),
  onMemoryProgress: (callback: (data: MemoryOptimizeProgress) => void) => onEvent(IPC.MEMORY_PROGRESS, callback),

  gameModeActivate: (config: GameModeConfig): Promise<GameModeActivateResult> =>
    ipcRenderer.invoke(IPC.GAME_MODE_ACTIVATE, config),
  gameModeDeactivate: (): Promise<GameModeDeactivateResult> => ipcRenderer.invoke(IPC.GAME_MODE_DEACTIVATE),
  gameModeStatus: (): Promise<GameModeStatus> => ipcRenderer.invoke(IPC.GAME_MODE_STATUS),
  onGameModeProgress: (callback: (data: GameModeProgress) => void) => onEvent(IPC.GAME_MODE_PROGRESS, callback),
  onGameModeAutoEvent: (
    callback: (data: { type: 'game-detected' | 'game-exited'; processName: string | null }) => void,
  ) => onEvent(IPC.GAME_MODE_AUTO_EVENT, callback),
  gameModeRunAudit: (phase: GameModeAuditReport['phase']): Promise<GameModeAuditReport> =>
    ipcRenderer.invoke(IPC.GAME_MODE_RUN_AUDIT, phase),
  gameModeDetectorStart: (): Promise<void> => ipcRenderer.invoke(IPC.GAME_MODE_DETECTOR_START),
  gameModeDetectorStop: (): Promise<void> => ipcRenderer.invoke(IPC.GAME_MODE_DETECTOR_STOP),

  powerPlansList: (): Promise<PowerPlanInfo[]> => ipcRenderer.invoke(IPC.POWER_PLANS_LIST),
  powerPlansActivate: (guid: string): Promise<PowerPlanActivateResult> =>
    ipcRenderer.invoke(IPC.POWER_PLANS_ACTIVATE, guid),
  powerPlansCreate: (name: string): Promise<PowerPlanCreateResult> => ipcRenderer.invoke(IPC.POWER_PLANS_CREATE, name),
  powerPlansDelete: (guid: string): Promise<PowerPlanDeleteResult> => ipcRenderer.invoke(IPC.POWER_PLANS_DELETE, guid),

  logsList: (filter?: LogFilter, page?: number, pageSize?: number): Promise<LogsListResult> =>
    ipcRenderer.invoke(IPC.LOGS_LIST, filter, page, pageSize),
  logsClear: (): Promise<void> => ipcRenderer.invoke(IPC.LOGS_CLEAR),
  logsExport: (filter?: LogFilter): Promise<string> => ipcRenderer.invoke(IPC.LOGS_EXPORT, filter),
  logsConfigGet: (): Promise<LogConfig> => ipcRenderer.invoke(IPC.LOGS_CONFIG_GET),
  logsConfigSet: (config: LogConfig): Promise<void> => ipcRenderer.invoke(IPC.LOGS_CONFIG_SET, config),
}
