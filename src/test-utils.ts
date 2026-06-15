import type { Mock } from 'vitest'
import { vi } from 'vitest'

export function mockKudu(): Record<string, Mock> {
  const mock: Record<string, Mock> = {
    // Cleaner
    systemScan: vi.fn(),
    systemClean: vi.fn(),
    browserScan: vi.fn(),
    browserClean: vi.fn(),
    appScan: vi.fn(),
    appClean: vi.fn(),
    gamingScan: vi.fn(),
    gamingClean: vi.fn(),
    environmentScan: vi.fn(),
    environmentClean: vi.fn(),
    recycleBinScan: vi.fn(),
    recycleBinClean: vi.fn(),
    shortcutScan: vi.fn(),
    shortcutClean: vi.fn(),
    contextMenuScan: vi.fn(),
    contextMenuApply: vi.fn(),
    emptyFoldersScan: vi.fn(),
    emptyFoldersDelete: vi.fn(),
    largeFilesScan: vi.fn(),
    duplicatesScan: vi.fn(),

    // Registry
    registryScan: vi.fn(),
    registryFix: vi.fn(),
    registryScanCancel: vi.fn(),
    registryFixCancel: vi.fn(),
    registrySetTweakIgnored: vi.fn(() => Promise.resolve()),

    // Malware
    malwareScan: vi.fn(),
    malwareQuarantine: vi.fn(),
    malwareDelete: vi.fn(),
    malwareQuarantineList: vi.fn(),
    malwareAllowlistList: vi.fn(),

    // Privacy & Security
    privacyScan: vi.fn(),
    privacyApply: vi.fn(),
    privacyRevert: vi.fn(),
    complianceScan: vi.fn(),
    complianceApply: vi.fn(),
    complianceRevert: vi.fn(),
    vulnerabilityScan: vi.fn(),
    vulnerabilityApply: vi.fn(),
    vulnerabilityRevert: vi.fn(),
    firewallScan: vi.fn(),
    firewallApply: vi.fn(),
    hostsRead: vi.fn(),
    hostsWrite: vi.fn(),
    hostsFlushDns: vi.fn(),

    // Performance
    benchmarkRun: vi.fn(),
    benchmarkCancel: vi.fn(),
    memoryLoad: vi.fn(),
    memoryOptimize: vi.fn(),
    perfStart: vi.fn(),
    perfStop: vi.fn(),
    perfGetSnapshot: vi.fn(),
    powerPlansList: vi.fn(),
    powerPlansActivate: vi.fn(),
    powerPlansCreate: vi.fn(),
    powerPlansDelete: vi.fn(),

    // System
    diskAnalyze: vi.fn(),
    diskTrimRun: vi.fn(),
    diskRepairSfc: vi.fn(),
    diskRepairDism: vi.fn(),
    diskRepairChkdsk: vi.fn(),
    startupList: vi.fn(),
    startupToggle: vi.fn(),
    startupDelete: vi.fn(),
    serviceScan: vi.fn(),
    serviceApply: vi.fn(),
    debloatScan: vi.fn(),
    debloatRemove: vi.fn(),
    windowsTweaksLoad: vi.fn(),
    windowsTweaksApply: vi.fn(),
    windowsTweaksRevert: vi.fn(),

    // Drivers
    driverScan: vi.fn(),
    driverClean: vi.fn(),
    driverUpdateScan: vi.fn(),
    driverUpdateInstall: vi.fn(),
    driverAgentEvaluate: vi.fn(),
    driverAgentApprove: vi.fn(),

    // Software
    softwareUpdateScan: vi.fn(),
    softwareUpdateInstall: vi.fn(),
    uninstallerScan: vi.fn(),
    uninstallerRun: vi.fn(),

    // Game mode
    gameModeConfig: vi.fn(),
    gameModeStatus: vi.fn(),
    gameModeActivate: vi.fn(),
    gameModeDeactivate: vi.fn(),
    gameModeRunAudit: vi.fn(),

    // License
    licenseActivate: vi.fn(),
    licenseCheck: vi.fn(),
    licenseGetHwid: vi.fn(),

    // Settings
    settingsGet: vi.fn(),
    settingsSet: vi.fn(() => Promise.resolve()),

    // History & Logs
    historyList: vi.fn(),
    historyAdd: vi.fn(),
    historyClear: vi.fn(),
    loggerFetch: vi.fn(),
    loggerClear: vi.fn(),
    loggerExport: vi.fn(),
    loggerFetchConfig: vi.fn(),
    loggerSetConfig: vi.fn(),

    // App
    appUpdateCheck: vi.fn(),
    appUpdateDownload: vi.fn(),
    appUpdateInstall: vi.fn(),
    appRestart: vi.fn(),
    getPlatformInfo: vi.fn(),
    openExternal: vi.fn(),
    openLocation: vi.fn(),
    onboardingSet: vi.fn(),
    cleanupOpenLocation: vi.fn(),

    // Progress listeners (each returns cleanup fn)
    onScanProgress: vi.fn(() => vi.fn()),
    onCleanProgress: vi.fn(() => vi.fn()),
    onRegistryFixProgress: vi.fn(() => vi.fn()),
    onMalwareProgress: vi.fn(() => vi.fn()),
    onDriverProgress: vi.fn(() => vi.fn()),
    onServiceProgress: vi.fn(() => vi.fn()),
    onBenchmarkProgress: vi.fn(() => vi.fn()),
    onMemoryProgress: vi.fn(() => vi.fn()),
    onGameModeProgress: vi.fn(() => vi.fn()),
    onHistoryChanged: vi.fn(() => vi.fn()),
    onAppUpdateStatus: vi.fn(() => vi.fn()),
    onPerfSnapshot: vi.fn(() => vi.fn()),
    onDiskProgress: vi.fn(() => vi.fn()),
    onSoftwareUpdateProgress: vi.fn(() => vi.fn()),
    onDriverUpdateProgress: vi.fn(() => vi.fn()),
    onBackgroundScanResult: vi.fn(() => vi.fn()),
    onScheduleTrigger: vi.fn(() => vi.fn()),
    onPrivacyProgress: vi.fn(() => vi.fn()),
    onComplianceProgress: vi.fn(() => vi.fn()),
    onVulnerabilityProgress: vi.fn(() => vi.fn()),
  }

  if (typeof window === 'undefined') {
    // biome-ignore lint/suspicious/noExplicitAny: test utils
    ;(globalThis as any).window = {}
  }
  // biome-ignore lint/suspicious/noExplicitAny: test utils
  ;(window as any).dinho = mock
  return mock
}
