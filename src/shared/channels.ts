export const IPC = {
  // System cleaner
  SYSTEM_SCAN: 'cleaner:system:scan',
  SYSTEM_CLEAN: 'cleaner:system:clean',

  // Browser cleaner
  BROWSER_SCAN: 'cleaner:browser:scan',
  BROWSER_CLEAN: 'cleaner:browser:clean',

  // App cleaner
  APP_SCAN: 'cleaner:app:scan',
  APP_CLEAN: 'cleaner:app:clean',

  // Gaming cleaner
  GAMING_SCAN: 'cleaner:gaming:scan',
  GAMING_CLEAN: 'cleaner:gaming:clean',

  // Database optimizer
  DATABASE_SCAN: 'cleaner:database:scan',
  DATABASE_CLEAN: 'cleaner:database:clean',

  // Recycle bin
  RECYCLE_BIN_SCAN: 'cleaner:recyclebin:scan',
  RECYCLE_BIN_CLEAN: 'cleaner:recyclebin:clean',

  // Uninstall leftovers
  UNINSTALL_LEFTOVERS_SCAN: 'cleaner:uninstall-leftovers:scan',
  UNINSTALL_LEFTOVERS_CLEAN: 'cleaner:uninstall-leftovers:clean',

  // Shortcut cleaner
  SHORTCUT_SCAN: 'cleaner:shortcut:scan',
  SHORTCUT_CLEAN: 'cleaner:shortcut:clean',

  // Environment cleaner (orphaned PATH entries & env vars)
  ENVIRONMENT_SCAN: 'cleaner:environment:scan',
  ENVIRONMENT_CLEAN: 'cleaner:environment:clean',

  // Cleaner shared
  CLEANER_OPEN_LOCATION: 'cleaner:open-location',

  // Registry
  REGISTRY_SCAN: 'cleaner:registry:scan',
  REGISTRY_FIX: 'cleaner:registry:fix',
  REGISTRY_SCAN_CANCEL: 'cleaner:registry:scan:cancel',
  REGISTRY_FIX_CANCEL: 'cleaner:registry:fix:cancel',
  REGISTRY_SET_TWEAK_IGNORED: 'cleaner:registry:tweak:set-ignored',

  // Context Menu Cleaner (Windows shell extensions / right-click verbs)
  CONTEXT_MENU_SCAN: 'cleaner:context-menu:scan',
  CONTEXT_MENU_SCAN_CANCEL: 'cleaner:context-menu:scan:cancel',
  CONTEXT_MENU_APPLY: 'cleaner:context-menu:apply',
  CONTEXT_MENU_APPLY_PROGRESS: 'cleaner:context-menu:apply:progress',

  // Startup
  STARTUP_LIST: 'startup:list',
  STARTUP_TOGGLE: 'startup:toggle',
  STARTUP_DELETE: 'startup:delete',
  STARTUP_BOOT_TRACE: 'startup:boot-trace',
  STARTUP_SAFETY_FETCH: 'startup:safety:fetch',

  // Debloater
  DEBLOATER_SCAN: 'debloater:scan',
  DEBLOATER_REMOVE: 'debloater:remove',
  DEBLOATER_REMOVE_PROGRESS: 'debloater:remove:progress',

  // Duplicate Finder
  DUPLICATES_SCAN: 'duplicates:scan',
  DUPLICATES_DELETE: 'duplicates:delete',
  DUPLICATES_CANCEL: 'duplicates:cancel',
  DUPLICATES_PROGRESS: 'duplicates:progress',
  DUPLICATES_SELECT_DIR: 'duplicates:select-dir',
  DUPLICATES_OPEN_LOCATION: 'duplicates:open-location',

  // Disk analyzer
  DISK_ANALYZE: 'disk:analyze',
  DISK_DRIVES: 'disk:drives',
  DISK_FILE_TYPES: 'disk:file-types',

  // Disk repair (SFC/DISM/CHKDSK)
  DISK_REPAIR_SFC: 'disk:repair:sfc',
  DISK_REPAIR_DISM: 'disk:repair:dism',
  DISK_REPAIR_CHKDSK: 'disk:repair:chkdsk',
  DISK_REPAIR_PROGRESS: 'disk:repair:progress',

  // Disk maintenance (SSD TRIM)
  DISK_TRIM_LIST: 'disk:trim:list',
  DISK_TRIM_RUN: 'disk:trim:run',
  DISK_TRIM_PROGRESS: 'disk:trim:progress',

  // Network cleanup
  NETWORK_SCAN: 'cleaner:network:scan',
  NETWORK_CLEAN: 'cleaner:network:clean',

  // Progress events (main -> renderer)
  SCAN_PROGRESS: 'scan:progress',
  REGISTRY_FIX_PROGRESS: 'registry:fix:progress',

  // Settings
  SETTINGS_GET: 'settings:get',
  SETTINGS_SET: 'settings:set',
  SETTINGS_SELECT_BACKUP_DIR: 'settings:select-backup-dir',
  SETTINGS_OPEN_BACKUP_DIR: 'settings:open-backup-dir',

  // System
  ELEVATION_CHECK: 'elevation:check',
  ELEVATION_RELAUNCH: 'elevation:relaunch',
  RESTORE_POINT_CREATE: 'system:restore-point:create',
  RESTORE_POINT_LIST: 'system:restore-point:list',
  RESTORE_POINT_DELETE: 'system:restore-point:delete',
  RESTORE_POINT_RESTORE: 'system:restore-point:restore',
  RESTORE_POINT_ENABLE_PROTECTION: 'system:restore-point:enable-protection',

  // Scheduled scans (legacy single-schedule)
  SCHEDULE_NEXT_SCAN: 'schedule:next-scan',
  SCHEDULE_SCAN_COMPLETE: 'schedule:scan-complete',

  // Multi-schedule
  SCHEDULE_RUN_TRIGGER: 'schedule:run-trigger',
  SCHEDULE_RUN_COMPLETE: 'schedule:run-complete',

  // Settings apply (renderer -> main)
  SETTINGS_APPLY_STARTUP: 'settings:apply-startup',
  SETTINGS_APPLY_TRAY: 'settings:apply-tray',

  // Scan history
  HISTORY_GET: 'history:get',
  HISTORY_ADD: 'history:add',
  HISTORY_CLEAR: 'history:clear',

  // Malware scanner
  MALWARE_SCAN: 'malware:scan',
  MALWARE_QUARANTINE: 'malware:quarantine',
  MALWARE_DELETE: 'malware:delete',
  MALWARE_RESTORE: 'malware:restore',
  MALWARE_PROGRESS: 'malware:progress',
  MALWARE_QUARANTINE_LIST: 'malware:quarantine:list',
  MALWARE_IGNORE: 'malware:ignore',
  MALWARE_ALLOWLIST_LIST: 'malware:allowlist:list',
  MALWARE_ALLOWLIST_REMOVE: 'malware:allowlist:remove',
  MALWARE_YARA_INFO: 'malware:yara:info',
  MALWARE_YARA_UPDATE: 'malware:yara:update',
  MALWARE_YARA_COMPILE_PROGRESS: 'malware:yara:compile-progress',

  // Compliance Auditor
  COMPLIANCE_SCAN: 'compliance:scan',
  COMPLIANCE_APPLY: 'compliance:apply',
  COMPLIANCE_REVERT: 'compliance:revert',
  COMPLIANCE_PROGRESS: 'compliance:progress',

  // Privacy Shield
  PRIVACY_SCAN: 'privacy:scan',
  PRIVACY_APPLY: 'privacy:apply',
  PRIVACY_REVERT: 'privacy:revert',
  PRIVACY_PROGRESS: 'privacy:progress',

  // Driver Manager
  DRIVER_SCAN: 'driver:scan',
  DRIVER_CLEAN: 'driver:clean',
  DRIVER_PROGRESS: 'driver:progress',
  DRIVER_UPDATE_SCAN: 'driver:update:scan',
  DRIVER_UPDATE_INSTALL: 'driver:update:install',
  DRIVER_UPDATE_PROGRESS: 'driver:update:progress',

  // Program Uninstaller
  UNINSTALLER_LIST: 'uninstaller:list',
  UNINSTALLER_UNINSTALL: 'uninstaller:uninstall',
  UNINSTALLER_FORCE_REMOVE: 'uninstaller:force-remove',
  UNINSTALLER_PROGRESS: 'uninstaller:progress',
  PROGRAM_SAFETY_FETCH: 'program:safety:fetch',

  // Onboarding
  ONBOARDING_GET: 'onboarding:get',
  ONBOARDING_SET: 'onboarding:set',

  // Performance Monitor
  PERF_QUICK_STATS: 'perf:quick-stats',
  PERF_GET_SYSTEM_INFO: 'perf:system-info',
  PERF_START_MONITORING: 'perf:start',
  PERF_STOP_MONITORING: 'perf:stop',
  PERF_SNAPSHOT: 'perf:snapshot',
  PERF_PROCESS_LIST: 'perf:process-list',
  PERF_KILL_PROCESS: 'perf:kill',
  PERF_DISK_HEALTH: 'perf:disk-health',

  // Auto-updater
  UPDATER_CHECK: 'updater:check',
  UPDATER_DOWNLOAD: 'updater:download',
  UPDATER_INSTALL: 'updater:install',
  UPDATER_GET_STATUS: 'updater:get-status',
  UPDATER_STATUS: 'updater:status',

  // Service Manager
  SERVICE_SCAN: 'service:scan',
  SERVICE_APPLY: 'service:apply',
  SERVICE_PROGRESS: 'service:progress',

  // Firewall Audit (Windows-only)
  FIREWALL_SCAN: 'firewall:scan',
  FIREWALL_APPLY: 'firewall:apply',
  FIREWALL_PROGRESS: 'firewall:progress',

  // Software Updater
  SOFTWARE_UPDATE_CHECK: 'software-update:check',
  SOFTWARE_UPDATE_RUN: 'software-update:run',
  SOFTWARE_UPDATE_PROGRESS: 'software-update:progress',

  // History push events (main -> renderer)
  HISTORY_CHANGED: 'history:changed',

  // Large File Finder
  LARGE_FILES_SCAN: 'large-files:scan',
  LARGE_FILES_CANCEL: 'large-files:cancel',
  LARGE_FILES_PROGRESS: 'large-files:progress',
  LARGE_FILES_SELECT_DIR: 'large-files:select-dir',
  LARGE_FILES_DELETE: 'large-files:delete',
  LARGE_FILES_OPEN_LOCATION: 'large-files:open-location',

  // Empty Folder Cleaner
  EMPTY_FOLDERS_SCAN: 'empty-folders:scan',
  EMPTY_FOLDERS_CANCEL: 'empty-folders:cancel',
  EMPTY_FOLDERS_PROGRESS: 'empty-folders:progress',
  EMPTY_FOLDERS_SELECT_DIR: 'empty-folders:select-dir',
  EMPTY_FOLDERS_DELETE: 'empty-folders:delete',
  EMPTY_FOLDERS_OPEN_LOCATION: 'empty-folders:open-location',

  // File Shredder
  SHREDDER_SELECT_FILES: 'shredder:select-files',
  SHREDDER_SELECT_FOLDERS: 'shredder:select-folders',
  SHREDDER_SHRED: 'shredder:shred',
  SHREDDER_CANCEL: 'shredder:cancel',
  SHREDDER_PROGRESS: 'shredder:progress',
  SHREDDER_OPEN_LOCATION: 'shredder:open-location',

  // Game Mode
  GAME_MODE_ACTIVATE: 'game-mode:activate',
  GAME_MODE_DEACTIVATE: 'game-mode:deactivate',
  GAME_MODE_STATUS: 'game-mode:status',
  GAME_MODE_PROGRESS: 'game-mode:progress',
  GAME_MODE_AUTO_EVENT: 'game-mode:auto-event',
  GAME_MODE_RUN_AUDIT: 'game-mode:run-audit',

  // Platform
  PLATFORM_INFO: 'platform:info',

  // Window controls
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',

  // Windows Tweaks
  WINDOWS_TWEAKS_LIST: 'windows-tweaks:list',
  WINDOWS_TWEAKS_APPLY: 'windows-tweaks:apply',
  WINDOWS_TWEAKS_APPLY_PROGRESS: 'windows-tweaks:apply:progress',
  WINDOWS_TWEAKS_REVERT: 'windows-tweaks:revert',
  WINDOWS_TWEAKS_REVERT_PROGRESS: 'windows-tweaks:revert:progress',
  WINDOWS_TWEAKS_STATUS: 'windows-tweaks:status',
  WINDOWS_TWEAKS_SET_DNS: 'windows-tweaks:set-dns',
  WINDOWS_TWEAKS_GET_DNS: 'windows-tweaks:get-dns',

  // Benchmark
  BENCHMARK_RUN: 'benchmark:run',
  BENCHMARK_PROGRESS: 'benchmark:progress',
  BENCHMARK_CANCEL: 'benchmark:cancel',

  // License / Activation
  LICENSE_ACTIVATE: 'license:activate',
  LICENSE_STATUS: 'license:status',
  LICENSE_GET_HWID: 'license:get-hwid',

  // Memory Optimizer
  MEMORY_INFO: 'memory:info',
  MEMORY_OPTIMIZE: 'memory:optimize',
  MEMORY_PROGRESS: 'memory:progress',

  // Power Plans
  POWER_PLANS_LIST: 'power-plans:list',
  POWER_PLANS_ACTIVATE: 'power-plans:activate',
  POWER_PLANS_CREATE: 'power-plans:create',
  POWER_PLANS_DELETE: 'power-plans:delete',
} as const
