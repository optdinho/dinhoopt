// ─── Performance Monitor ────────────────────────────────────
export interface PerfSystemInfo {
  cpuModel: string
  cpuCores: number
  cpuThreads: number
  totalMemBytes: number
  osVersion: string
  hostname: string
}

/** Lightweight stats for dashboard gauges — no systeminformation dependency */
export interface PerfQuickStats {
  cpuPercent: number
  memUsedBytes: number
  memTotalBytes: number
  memPercent: number
}

export interface PerfSnapshot {
  timestamp: number
  cpu: { overall: number; perCore: number[] }
  memory: { usedBytes: number; totalBytes: number; cachedBytes: number; percent: number }
  disk: { readBytesPerSec: number; writeBytesPerSec: number }
  network: { rxBytesPerSec: number; txBytesPerSec: number }
  uptime: number
}

export interface PerfProcess {
  pid: number
  name: string
  cpuPercent: number
  memBytes: number
  memPercent: number
  user: string
  started: string
  isStartupItem?: boolean
  startupItemName?: string
}

export interface PerfProcessList {
  timestamp: number
  processes: PerfProcess[]
  totalCount: number
}

export interface PerfKillResult {
  success: boolean
  error?: string
  requiresAdmin?: boolean
}

export interface DiskSmartInfo {
  device: string
  model: string
  type: 'SSD' | 'HDD' | 'NVMe' | 'Unknown'
  sizeBytes: number
  temperature: number | null
  healthStatus: 'Healthy' | 'Caution' | 'Bad' | 'Unknown'
  powerOnHours: number | null
  /** SSD/NVMe remaining life percentage (100 = new, 0 = worn out) */
  remainingLife: number | null
  readErrors: number | null
  writeErrors: number | null
  reallocatedSectors: number | null
  smartAttributes: SmartAttribute[]
}

export interface SmartAttribute {
  id: number
  name: string
  value: number
  worst: number
  thresh: number
  raw: number
}

// ─── Benchmark ──────────────────────────────────────────────

export type BenchmarkScoreClass = 'S' | 'A' | 'B' | 'C' | 'D'

export interface BenchmarkProgress {
  step: number
  totalSteps: number
  label: string
  detail: string
}

// ─── Memory Optimizer ────────────────────────────────────
export interface MemoryInfo {
  totalBytes: number
  availableBytes: number
  usedBytes: number
  usedPercent: number
  cachedBytes: number
}

export interface MemoryProcess {
  pid: number
  name: string
  workingSetBytes: number
}

export interface MemoryOptimizeStep {
  name: string
  success: boolean
  freedBytes: number
  error?: string
}

export interface MemoryOptimizeProgress {
  step: number
  totalSteps: number
  label: string
  detail: string
}

export interface MemoryOptimizeResult {
  success: boolean
  freedBytes: number
  steps: MemoryOptimizeStep[]
  error?: string
}

export interface BenchmarkResult {
  score: number
  scoreClass: BenchmarkScoreClass
  details: {
    cpu: { score: number; detail: string }
    ram: { score: number; detail: string }
    network: { score: number; detail: string; jitter?: number }
    latencyDpc: { score: number; detail: string }
    temperature: { score: number; detail: string }
    tweakBonus: { score: number; applied: number; total: number }
    powerBonus: { score: number; plan: string }
  }
  completedAt: string
}
