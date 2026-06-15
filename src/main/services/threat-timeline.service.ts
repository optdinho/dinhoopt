import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getLogger } from './logger.service'

export interface TimelineEntry {
  id: string
  threatName: string
  severity: string
  filePath: string
  detectedAt: string
  action: 'quarantined' | 'skipped' | 'restored' | 'deleted'
  scanId: string
}

const TIMELINE_FILE = 'threat-timeline.json'
const MAX_ENTRIES = 1000

export class ThreatTimelineService {
  private filePath: string
  private entries: TimelineEntry[] = []

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, TIMELINE_FILE)
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = readFileSync(this.filePath, 'utf-8')
        this.entries = JSON.parse(data)
      }
    } catch {
      this.entries = []
    }
  }

  private save(): void {
    try {
      this.entries = this.entries.slice(0, MAX_ENTRIES)
      const dir = path.dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2))
    } catch (err: unknown) {
      getLogger().error('Failed to save threat timeline', err instanceof Error ? err.message : String(err))
    }
  }

  addEntry(
    threat: { name: string; severity: string; filePath: string },
    action: TimelineEntry['action'],
    scanId: string,
  ): void {
    const entry: TimelineEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      threatName: threat.name,
      severity: threat.severity,
      filePath: threat.filePath,
      detectedAt: new Date().toISOString(),
      action,
      scanId,
    }
    this.entries.unshift(entry)
    this.save()
  }

  getEntries(limit = 50, offset = 0): TimelineEntry[] {
    return this.entries.slice(offset, offset + limit)
  }

  getBySeverity(severity: string): TimelineEntry[] {
    return this.entries.filter((e) => e.severity === severity)
  }

  getByDateRange(from: string, to: string): TimelineEntry[] {
    return this.entries.filter((e) => e.detectedAt >= from && e.detectedAt <= to)
  }

  getStats(): { total: number; bySeverity: Record<string, number>; byAction: Record<string, number> } {
    const bySeverity: Record<string, number> = {}
    const byAction: Record<string, number> = {}
    for (const e of this.entries) {
      bySeverity[e.severity] = (bySeverity[e.severity] || 0) + 1
      byAction[e.action] = (byAction[e.action] || 0) + 1
    }
    return { total: this.entries.length, bySeverity, byAction }
  }

  clear(): void {
    this.entries = []
    this.save()
  }
}

let _instance: ThreatTimelineService | null = null
export function getThreatTimelineService(): ThreatTimelineService {
  if (!_instance) _instance = new ThreatTimelineService()
  return _instance
}
