// ─── Malware Scanner ────────────────────────────────────────

export interface MalwareThreat {
  id: string
  path: string
  fileName: string
  size: number
  detectionName: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  source: 'defender' | 'heuristic' | 'signature'
  details: string
  selected: boolean
}

export type MalwareScanStep =
  | 'init'
  | 'discovering'
  | 'signatures'
  | 'heuristics'
  | 'scripts'
  | 'system'
  | 'persistence'
  | 'defender'
  | 'complete'

export interface MalwareCategoryProgress {
  id: MalwareScanStep
  label: string
  status: 'pending' | 'running' | 'done' | 'skipped'
  /** 0-100 within this category */
  progress: number
  threatsFound: number
  itemsScanned: number
  totalItems: number
}

export interface MalwareScanProgress {
  phase: 'scanning' | 'quarantining' | 'deleting'
  step: MalwareScanStep
  stepLabel: string
  currentPath: string
  progress: number
  threatsFound: number
  filesScanned: number
  totalFiles: number
  engine: string
  completedSteps: string[]
  /** Per-category progress for the multi-phase UI */
  categories: MalwareCategoryProgress[]
}

export interface MalwareScanResult {
  threats: MalwareThreat[]
  filesScanned: number
  duration: number
  engines: string[]
  cancelled?: boolean
  scanId: string
}

export interface MalwareActionResult {
  succeeded: number
  failed: number
  errors: { path: string; reason: string }[]
}

// ─── Quarantine ─────────────────────────────────────────────

export interface QuarantinedItem {
  quarantinedPath: string
  originalPath: string
  originalFileName: string
  quarantinedAt: number
  size: number
  /** Why the file was flagged — captured at quarantine time (optional for legacy entries). */
  detectionName?: string
  severity?: 'critical' | 'high' | 'medium' | 'low'
  source?: 'defender' | 'heuristic' | 'signature'
  details?: string
}

/** A file the user marked as a false positive. Detections whose content hash
 *  matches `sha256` are suppressed on future scans. Path/fileName/detectionName
 *  are retained for display in the allowlist management UI only. */
export interface MalwareAllowlistEntry {
  sha256: string
  path: string
  fileName: string
  detectionName?: string
  addedAt: number
}

// ─── Scan Profiles ──────────────────────────────────────────

export interface ScanProfile {
  id: string
  name: string
  description: string
  icon: string
  scanDirs: string[]
  scanTypes: ('yara' | 'heuristic' | 'script' | 'persistence' | 'ads' | 'hosts')[]
  maxFileSize: number
  maxDepth: number
  duration: 'quick' | 'normal' | 'full'
}

/** Detection metadata passed alongside a path when quarantining, so the
 *  quarantine list can show why each file was flagged. */
export interface QuarantineMeta {
  path: string
  detectionName?: string
  severity?: 'critical' | 'high' | 'medium' | 'low'
  source?: 'defender' | 'heuristic' | 'signature'
  details?: string
}

// ─── YARA Rules ─────────────────────────────────────────────

export interface YaraRulesInfo {
  available: boolean
  engine: 'yara' | 'pending' | 'compiling'
  rulesLoaded: number
  version: string | null
  updatedAt: string | null
  source: 'cached' | 'none'
  cachedRules: number
  compileProgress: { loaded: number; total: number } | null
}

// ─── Memory Scanner ─────────────────────────────────────────

export interface ProcessInfo {
  pid: number
  name: string
  path: string
  cpu: number
  memory: number
  suspicious: boolean
  reason?: string
}

export interface MemoryScanResult {
  processes: ProcessInfo[]
  suspiciousCount: number
  timestamp: string
}

// ─── Threat Timeline ────────────────────────────────────────

export interface TimelineEntry {
  id: string
  threatName: string
  severity: string
  filePath: string
  detectedAt: string
  action: 'quarantined' | 'skipped' | 'restored' | 'deleted'
  scanId: string
}

// ─── Threat Intel ───────────────────────────────────────────

export interface ThreatIntelEntry {
  type: 'hash' | 'domain' | 'ip' | 'url' | 'registry'
  value: string
  source: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  addedAt: string
  expiresAt?: string
}

export interface ThreatIntelFeed {
  name: string
  url: string
  enabled: boolean
  updateInterval: number
  lastUpdated?: number
  parser: 'csv' | 'json' | 'stix' | 'text'
}

// ─── Exploit Detection ──────────────────────────────────────

export interface ExploitPattern {
  name: string
  description: string
  severity: 'medium' | 'high' | 'critical'
}

export interface ExploitMatch {
  pattern: ExploitPattern
  offset: number
  context: string
}

export interface ExploitScanResult {
  filePath: string
  matches: ExploitMatch[]
  riskScore: number
  isExploit: boolean
}
