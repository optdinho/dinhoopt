import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { getLogger } from './logger.service'

export interface ThreatIntelEntry {
  type: 'hash' | 'domain' | 'ip' | 'url' | 'registry'
  value: string
  source: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  addedAt: string
  expiresAt?: string
}

interface FeedSource {
  name: string
  url: string
  enabled: boolean
  updateInterval: number
  lastUpdated?: number
  parser: 'csv' | 'json' | 'stix' | 'text'
}

const DEFAULT_FEEDS: FeedSource[] = [
  {
    name: 'Abuse.ch SSL Blacklist',
    url: 'https://sslbl.abuse.ch/blacklist/sslblacklist.csv',
    enabled: false,
    updateInterval: 3600000,
    parser: 'csv',
  },
  {
    name: 'MalwareBazaar Hashes',
    url: 'https://mb-api.abuse.ch/api/v1/',
    enabled: false,
    updateInterval: 3600000,
    parser: 'json',
  },
  {
    name: 'PhishTank',
    url: 'http://data.phishtank.com/data/online-valid.csv',
    enabled: false,
    updateInterval: 3600000,
    parser: 'csv',
  },
]

const INTEL_FILE = 'threat-intel-cache.json'
const MAX_ENTRIES = 50000

export class ThreatIntelService {
  private entries: Map<string, ThreatIntelEntry> = new Map()
  private feeds: FeedSource[]
  private filePath: string
  private updateTimer: ReturnType<typeof setInterval> | null = null

  constructor() {
    const userDataPath = app.getPath('userData')
    this.filePath = path.join(userDataPath, INTEL_FILE)
    this.feeds = [...DEFAULT_FEEDS]
    this.load()
  }

  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = JSON.parse(readFileSync(this.filePath, 'utf-8'))
        this.entries = new Map(data.entries || [])
        if (data.feeds) this.feeds = data.feeds
      }
    } catch (err: unknown) {
      getLogger().error('Failed to load threat intel cache', err instanceof Error ? err.message : String(err))
    }
  }

  private save(): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
      const data = { entries: Array.from(this.entries.entries()), feeds: this.feeds }
      writeFileSync(this.filePath, JSON.stringify(data), 'utf-8')
    } catch (err: unknown) {
      getLogger().error('Failed to save threat intel cache', err instanceof Error ? err.message : String(err))
    }
  }

  startAutoUpdate(): void {
    this.stopAutoUpdate()
    this.updateTimer = setInterval(() => this.updateAllFeeds(), 600000)
    this.updateAllFeeds()
  }

  stopAutoUpdate(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer)
      this.updateTimer = null
    }
  }

  async updateAllFeeds(): Promise<{ feed: string; added: number }[]> {
    const results: { feed: string; added: number }[] = []
    for (const feed of this.feeds.filter((f) => f.enabled)) {
      try {
        const added = await this.updateFeed(feed)
        results.push({ feed: feed.name, added })
        feed.lastUpdated = Date.now()
      } catch (err: unknown) {
        getLogger().warning('threat-intel', `Failed to update feed: ${feed.name}`, err instanceof Error ? err.message : String(err))
        results.push({ feed: feed.name, added: 0 })
      }
    }
    this.save()
    return results
  }

  private async updateFeed(feed: FeedSource): Promise<number> {
    let count = 0
    switch (feed.parser) {
      case 'csv':
        count = await this.parseCsvFeed(feed)
        break
      case 'json':
        count = await this.parseJsonFeed(feed)
        break
      default:
        count = 0
    }
    this.trimEntries()
    return count
  }

  private async parseCsvFeed(feed: FeedSource): Promise<number> {
    getLogger().info('threat-intel', `Parsing CSV feed: ${feed.name}`)
    return 0
  }

  private async parseJsonFeed(feed: FeedSource): Promise<number> {
    getLogger().info('threat-intel', `Parsing JSON feed: ${feed.name}`)
    return 0
  }

  addEntry(entry: ThreatIntelEntry): void {
    const key = `${entry.type}:${entry.value.toLowerCase()}`
    const existing = this.entries.get(key)
    if (existing) {
      const severityOrder = ['low', 'medium', 'high', 'critical']
      if (severityOrder.indexOf(entry.severity) <= severityOrder.indexOf(existing.severity)) {
        return
      }
    }
    this.entries.set(key, entry)
    this.trimEntries()
  }

  private trimEntries(): void {
    if (this.entries.size > MAX_ENTRIES) {
      const entriesArray = Array.from(this.entries.entries())
      const toRemove = entriesArray.slice(0, this.entries.size - MAX_ENTRIES)
      for (const [key] of toRemove) this.entries.delete(key)
    }
  }

  checkHash(hash: string): ThreatIntelEntry | null {
    return this.entries.get(`hash:${hash.toLowerCase()}`) || null
  }

  checkDomain(domain: string): ThreatIntelEntry | null {
    const lower = domain.toLowerCase()
    return this.entries.get(`domain:${lower}`) || this.findWildcardMatch('domain', lower)
  }

  private findWildcardMatch(type: string, value: string): ThreatIntelEntry | null {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(`${type}:`)) {
        const pattern = key.slice(type.length + 1)
        if (value.endsWith(`.${pattern}`) || value === pattern) {
          return entry
        }
      }
    }
    return null
  }

  checkIp(ip: string): ThreatIntelEntry | null {
    return this.entries.get(`ip:${ip}`) || null
  }

  getEntriesByType(type: string): ThreatIntelEntry[] {
    return Array.from(this.entries.values()).filter((e) => e.type === type)
  }

  getStats(): { total: number; byType: Record<string, number>; bySeverity: Record<string, number> } {
    const byType: Record<string, number> = {}
    const bySeverity: Record<string, number> = {}
    for (const entry of this.entries.values()) {
      byType[entry.type] = (byType[entry.type] || 0) + 1
      bySeverity[entry.severity] = (bySeverity[entry.severity] || 0) + 1
    }
    return { total: this.entries.size, byType, bySeverity }
  }

  toggleFeed(name: string, enabled: boolean): boolean {
    const feed = this.feeds.find((f) => f.name === name)
    if (!feed) return false
    feed.enabled = enabled
    this.save()
    return true
  }

  getFeeds(): FeedSource[] {
    return [...this.feeds]
  }

  clear(): void {
    this.entries.clear()
    this.save()
  }
}

let _threatIntelInstance: ThreatIntelService | null = null
export function getThreatIntelService(): ThreatIntelService {
  if (!_threatIntelInstance) _threatIntelInstance = new ThreatIntelService()
  return _threatIntelInstance
}
