// ─── Game Mode Audit ──────────────────────────────────────────

export interface GameModeAuditCheck {
  id: string
  name: string
  description: string
  severity: 'info' | 'warning' | 'error'
  category: 'service' | 'process' | 'registry' | 'anti-cheat' | 'platform' | 'restore'
  passed: boolean
  details: string
  remediation?: string
}

export interface GameModeAuditReport {
  timestamp: string
  phase: 'pre-activation' | 'post-activation' | 'pre-deactivation' | 'post-restore'
  checks: GameModeAuditCheck[]
  summary: { passed: number; warnings: number; errors: number }
}

// ─── Game Mode ──────────────────────────────────────────────

export type GameModeOptimizationId =
  | 'svc-wsearch'
  | 'svc-sysmain'
  | 'svc-wuauserv'
  | 'svc-spooler'
  | 'svc-diagtrack'
  | 'proc-kill-browsers'
  | 'proc-kill-chat'
  | 'proc-kill-updaters'
  | 'proc-kill-custom'
  | 'proc-kill-background'
  | 'mem-clear-standby'
  | 'mem-empty-working-set'
  | 'sys-focus-assist'
  | 'sys-power-plan'
  | 'sys-prevent-sleep'
  | 'sys-disable-game-bar'
  | 'sys-disable-fse-opt'
  | 'sys-disable-transparency'
  | 'sys-timer-resolution'
  | 'cpu-game-priority'
  | 'net-flush-dns'
  | 'net-disable-nagle'

export type GameModeCategory = 'services' | 'processes' | 'memory' | 'system' | 'network'

export interface DirectStorageStatus {
  supported: boolean
  nvmeHealthy: boolean
  nvmeDrives: Array<{ model: string; health: 'Healthy' | 'Caution' | 'Bad' | 'Unknown'; type: string }>
}

export interface GameProfile {
  /** Display name for this profile (e.g. "CS2", "FiveM") */
  gameName: string
  /** Optimizations to enable when this game is detected */
  enabledOptimizations: GameModeOptimizationId[]
}

export interface GameModeConfig {
  enabledOptimizations: GameModeOptimizationId[]
  customProcessKillList: string[]
  /** Automatically activate Game Mode when a game process is detected */
  autoDetect: boolean
  /** Automatically deactivate Game Mode when the detected game exits */
  autoDeactivate: boolean
  /** User-specified game executable names to watch for (e.g. "mygame.exe") */
  customGameProcesses: string[]
  /** Per-game profiles — keyed by process name (e.g. "cs2.exe") */
  gameProfiles: Record<string, GameProfile>
}

export interface GameModeSnapshot {
  activatedAt: string
  // True while Game Mode is actively applied. Set to false when deactivation
  // runs but leaves unrestored items — the snapshot is kept so the user can
  // retry restoration without losing the captured pre-Game-Mode state.
  active: boolean
  services: Array<{ name: string; originalStartType: string; wasRunning: boolean }>
  killedProcesses: Array<{ pid: number; name: string }>
  originalPowerPlanGuid: string | null
  originalFocusAssistState: number | null
  powerSaveBlockerId: number | null
  originalTimerResolution: number | null
  nagleInterfaces: Array<{ path: string; originalTcpNoDelay: number | null; originalTcpAckFrequency: number | null }>
  registryTweaks: Array<{ path: string; name: string; originalValue: number | null }>
  gameProcessPriorities: Array<{ name: string; pid: number; originalPriority: string }>
}

export interface GameModeActivateResult {
  succeeded: number
  failed: number
  errors: Array<{ optimizationId: string; reason: string }>
  snapshot: GameModeSnapshot | null
}

export interface GameModeDeactivateResult {
  restored: number
  failed: number
  errors: Array<{ optimizationId: string; reason: string }>
}

export interface GameModeProgress {
  phase: 'activating' | 'deactivating'
  current: number
  total: number
  currentLabel: string
}

export interface GameModeStatus {
  active: boolean
  activatedAt: string | null
  /** True when a previous deactivation left items unrestored. The toggle is
   * not "on", but a cleanup retry is available. */
  pendingRestore: boolean
}
