import { IPC } from '@shared/channels'
import type {
  ComplianceApplyResult,
  ComplianceScanProgress,
  ComplianceState,
  ContextMenuApplyProgress,
  ContextMenuApplyRequest,
  ContextMenuApplyResult,
  ContextMenuScanResult,
  MalwareActionResult,
  MalwareAllowlistEntry,
  MalwareScanProgress,
  MalwareScanResult,
  PrivacyApplyResult,
  PrivacyScanProgress,
  PrivacyShieldState,
  QuarantinedItem,
  QuarantineMeta,
  RegistryEntry,
  VulnerabilityActionResult,
  VulnerabilityScanProgress,
  VulnerabilityScanResult,
  YaraRulesInfo,
} from '@shared/types'
import { ipcRenderer } from 'electron'

function onEvent<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

export const scannerMethods = {
  registryScan: (): Promise<RegistryEntry[]> => ipcRenderer.invoke(IPC.REGISTRY_SCAN),
  registryFix: (
    entryIds: string[],
  ): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> =>
    ipcRenderer.invoke(IPC.REGISTRY_FIX, entryIds),
  registryScanCancel: (): Promise<void> => ipcRenderer.invoke(IPC.REGISTRY_SCAN_CANCEL),
  registryFixCancel: (): Promise<void> => ipcRenderer.invoke(IPC.REGISTRY_FIX_CANCEL),
  registrySetTweakIgnored: (signatures: string[], ignored: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC.REGISTRY_SET_TWEAK_IGNORED, signatures, ignored),
  onRegistryFixProgress: (callback: (data: { current: number; total: number; currentEntry: string }) => void) =>
    onEvent(IPC.REGISTRY_FIX_PROGRESS, callback),

  contextMenuScan: (): Promise<ContextMenuScanResult> => ipcRenderer.invoke(IPC.CONTEXT_MENU_SCAN),
  contextMenuScanCancel: (): Promise<void> => ipcRenderer.invoke(IPC.CONTEXT_MENU_SCAN_CANCEL),
  contextMenuApply: (requests: ContextMenuApplyRequest[]): Promise<ContextMenuApplyResult> =>
    ipcRenderer.invoke(IPC.CONTEXT_MENU_APPLY, requests),
  onContextMenuApplyProgress: (callback: (data: ContextMenuApplyProgress) => void) =>
    onEvent(IPC.CONTEXT_MENU_APPLY_PROGRESS, callback),

  privacyScan: (): Promise<PrivacyShieldState> => ipcRenderer.invoke(IPC.PRIVACY_SCAN),
  privacyApply: (ids: string[]): Promise<PrivacyApplyResult> => ipcRenderer.invoke(IPC.PRIVACY_APPLY, ids),
  privacyRevert: (ids: string[]): Promise<PrivacyApplyResult> => ipcRenderer.invoke(IPC.PRIVACY_REVERT, ids),
  onPrivacyProgress: (callback: (data: PrivacyScanProgress) => void) => onEvent(IPC.PRIVACY_PROGRESS, callback),

  complianceScan: (): Promise<ComplianceState> => ipcRenderer.invoke(IPC.COMPLIANCE_SCAN),
  complianceApply: (ids: string[]): Promise<ComplianceApplyResult> => ipcRenderer.invoke(IPC.COMPLIANCE_APPLY, ids),
  complianceRevert: (ids: string[]): Promise<ComplianceApplyResult> => ipcRenderer.invoke(IPC.COMPLIANCE_REVERT, ids),
  onComplianceProgress: (callback: (data: ComplianceScanProgress) => void) =>
    onEvent(IPC.COMPLIANCE_PROGRESS, callback),

  vulnerabilityScan: (): Promise<VulnerabilityScanResult> => ipcRenderer.invoke(IPC.VULN_SCAN),
  vulnerabilityApply: (ids: string[]): Promise<VulnerabilityActionResult> => ipcRenderer.invoke(IPC.VULN_APPLY, ids),
  vulnerabilityRevert: (ids: string[]): Promise<VulnerabilityActionResult> => ipcRenderer.invoke(IPC.VULN_REVERT, ids),
  onVulnerabilityProgress: (callback: (data: VulnerabilityScanProgress) => void) =>
    onEvent(IPC.VULN_PROGRESS, callback),

  malwareScan: (scanId?: string, profileId?: string): Promise<MalwareScanResult> =>
    ipcRenderer.invoke(IPC.MALWARE_SCAN, scanId, profileId),
  malwareCancelScan: (scanId: string): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_CANCEL_SCAN, scanId),
  malwareQuarantine: (paths: string[], meta?: QuarantineMeta[]): Promise<MalwareActionResult> =>
    ipcRenderer.invoke(IPC.MALWARE_QUARANTINE, paths, meta),
  malwareDelete: (paths: string[]): Promise<MalwareActionResult> => ipcRenderer.invoke(IPC.MALWARE_DELETE, paths),
  malwareRestore: (quarantinedPath: string, originalPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_RESTORE, quarantinedPath, originalPath),
  malwareQuarantineList: (): Promise<QuarantinedItem[]> => ipcRenderer.invoke(IPC.MALWARE_QUARANTINE_LIST),
  malwareIgnore: (path: string, meta?: QuarantineMeta): Promise<MalwareAllowlistEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_IGNORE, path, meta),
  malwareAllowlistList: (): Promise<MalwareAllowlistEntry[]> => ipcRenderer.invoke(IPC.MALWARE_ALLOWLIST_LIST),
  malwareAllowlistRemove: (sha256: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_ALLOWLIST_REMOVE, sha256),
  onMalwareProgress: (callback: (data: MalwareScanProgress) => void) => onEvent(IPC.MALWARE_PROGRESS, callback),
  malwareYaraInfo: (): Promise<YaraRulesInfo> => ipcRenderer.invoke(IPC.MALWARE_YARA_INFO),
  malwareYaraUpdate: (): Promise<{
    success: boolean
    error?: string
    stats?: { rulesCount: number; version: string }
  }> => ipcRenderer.invoke(IPC.MALWARE_YARA_UPDATE),
  onYaraCompileProgress: (callback: (data: { loaded: number; total: number }) => void) =>
    onEvent(IPC.MALWARE_YARA_COMPILE_PROGRESS, callback),

  watcherStart: (directories: string[]): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_WATCHER_START, directories),
  watcherStop: (): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_WATCHER_STOP),
  watcherStatus: (): Promise<{ isWatching: boolean; watchedCount: number }> =>
    ipcRenderer.invoke(IPC.MALWARE_WATCHER_STATUS),

  getScanProfiles: (): Promise<import('@shared/types').ScanProfile[]> => ipcRenderer.invoke(IPC.MALWARE_GET_PROFILES),
  setScanProfile: (profileId: string): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_SET_PROFILE, profileId),

  customRulesList: (): Promise<{ name: string; content: string; size: number; addedAt: Date }[]> =>
    ipcRenderer.invoke(IPC.MALWARE_CUSTOM_RULES_LIST),
  customRulesAdd: (name: string, content: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_CUSTOM_RULES_ADD, name, content),
  customRulesRemove: (name: string): Promise<boolean> => ipcRenderer.invoke(IPC.MALWARE_CUSTOM_RULES_REMOVE, name),

  exportReport: (result: MalwareScanResult, format: string, outputPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_EXPORT_REPORT, result, format, outputPath),

  memoryScan: (): Promise<import('@shared/types').MemoryScanResult> => ipcRenderer.invoke(IPC.MALWARE_MEMORY_SCAN),

  getTimeline: (limit?: number, offset?: number): Promise<import('@shared/types').TimelineEntry[]> =>
    ipcRenderer.invoke(IPC.MALWARE_TIMELINE_GET, limit, offset),
  clearTimeline: (): Promise<void> => ipcRenderer.invoke(IPC.MALWARE_TIMELINE_CLEAR),
  getTimelineStats: (): Promise<{
    total: number
    bySeverity: Record<string, number>
    byAction: Record<string, number>
  }> => ipcRenderer.invoke(IPC.MALWARE_TIMELINE_STATS),

  intelCheckHash: (hash: string): Promise<import('@shared/types').ThreatIntelEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_CHECK_HASH, hash),
  intelCheckDomain: (domain: string): Promise<import('@shared/types').ThreatIntelEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_CHECK_DOMAIN, domain),
  intelCheckIp: (ip: string): Promise<import('@shared/types').ThreatIntelEntry | null> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_CHECK_IP, ip),
  intelStats: (): Promise<{ total: number; byType: Record<string, number>; bySeverity: Record<string, number> }> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_STATS),
  intelFeeds: (): Promise<
    Array<{ name: string; url: string; enabled: boolean; updateInterval: number; lastUpdated?: number; parser: string }>
  > => ipcRenderer.invoke(IPC.MALWARE_INTEL_FEEDS),
  intelToggleFeed: (name: string, enabled: boolean): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_INTEL_TOGGLE_FEED, name, enabled),
  intelClear: (): Promise<void> => ipcRenderer.invoke(IPC.MALWARE_INTEL_CLEAR),

  exploitScan: (filePath: string): Promise<import('@shared/types').ExploitScanResult> =>
    ipcRenderer.invoke(IPC.MALWARE_EXPLOIT_SCAN, filePath),

  backupConfigGet: (): Promise<import('../../main/services/cloud-backup.service').CloudBackupConfig> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_CONFIG_GET),
  backupConfigSet: (updates: Record<string, unknown>): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_CONFIG_SET, updates),
  backupNow: (): Promise<import('../../main/services/cloud-backup.service').BackupResult> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_NOW),
  backupList: (): Promise<{ name: string; size: number; date: string }[]> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_LIST),
  backupRestore: (backupId: string, destPath: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC.MALWARE_BACKUP_RESTORE, backupId, destPath),
  backupStorage: (): Promise<number> => ipcRenderer.invoke(IPC.MALWARE_BACKUP_STORAGE),

  sandboxAnalyze: (
    filePath: string,
  ): Promise<import('../../main/services/behavioral-sandbox.service').SandboxResult | null> =>
    ipcRenderer.invoke(IPC.MALWARE_SANDBOX_ANALYZE, filePath),
}
