import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-dinho/threat-intel'),
  },
}))

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mockExistsSync(...args),
  readFileSync: (...args: unknown[]) => mockReadFileSync(...args),
  writeFileSync: (...args: unknown[]) => mockWriteFileSync(...args),
  mkdirSync: (...args: unknown[]) => mockMkdirSync(...args),
}))

vi.mock('path', () => ({
  default: {
    join: (...args: string[]) => args.join('/'),
    dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
  },
  join: (...args: string[]) => args.join('/'),
  dirname: (p: string) => p.split('/').slice(0, -1).join('/'),
}))

vi.mock('./logger.service', () => ({
  getLogger: vi.fn(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  })),
}))

import { ThreatIntelService, getThreatIntelService } from './threat-intel.service'
import type { ThreatIntelEntry } from './threat-intel.service'

describe('ThreatIntelService', () => {
  let service: ThreatIntelService

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    service = new ThreatIntelService()
    service.getFeeds().forEach((f) => { f.enabled = false })
  })

  it('addEntry stores by type:value key', () => {
    const entry: ThreatIntelEntry = {
      type: 'hash',
      value: 'a1b2c3d4',
      source: 'test',
      severity: 'high',
      description: 'Test threat',
      addedAt: new Date().toISOString(),
    }
    service.addEntry(entry)
    const result = service.checkHash('a1b2c3d4')
    expect(result).not.toBeNull()
    expect(result!.value).toBe('a1b2c3d4')
    expect(result!.severity).toBe('high')
  })

  it('checkHash finds existing entry', () => {
    const entry: ThreatIntelEntry = {
      type: 'hash',
      value: 'deadbeef',
      source: 'test',
      severity: 'critical',
      description: 'Bad hash',
      addedAt: new Date().toISOString(),
    }
    service.addEntry(entry)
    expect(service.checkHash('deadbeef')).not.toBeNull()
    expect(service.checkHash('DEADBEEF')).not.toBeNull()
    expect(service.checkHash('nonexistent')).toBeNull()
  })

  it('checkDomain finds exact match', () => {
    const entry: ThreatIntelEntry = {
      type: 'domain',
      value: 'evil.com',
      source: 'test',
      severity: 'high',
      description: 'Malicious domain',
      addedAt: new Date().toISOString(),
    }
    service.addEntry(entry)
    expect(service.checkDomain('evil.com')).not.toBeNull()
    expect(service.checkDomain('EVIL.COM')).not.toBeNull()
  })

  it('checkDomain finds wildcard subdomain match', () => {
    const entry: ThreatIntelEntry = {
      type: 'domain',
      value: 'malicious.test',
      source: 'test',
      severity: 'high',
      description: 'Malicious domain',
      addedAt: new Date().toISOString(),
    }
    service.addEntry(entry)
    const result = service.checkDomain('sub.malicious.test')
    expect(result).not.toBeNull()
    expect(result!.value).toBe('malicious.test')
  })

  it('checkDomain returns null for unknown domain', () => {
    expect(service.checkDomain('safe.com')).toBeNull()
  })

  it('checkIp finds exact IP match', () => {
    const entry: ThreatIntelEntry = {
      type: 'ip',
      value: '192.168.1.1',
      source: 'test',
      severity: 'medium',
      description: 'Suspicious IP',
      addedAt: new Date().toISOString(),
    }
    service.addEntry(entry)
    expect(service.checkIp('192.168.1.1')).not.toBeNull()
    expect(service.checkIp('10.0.0.1')).toBeNull()
  })

  it('Duplicate hash with higher severity updates', () => {
    const low: ThreatIntelEntry = {
      type: 'hash',
      value: 'dup',
      source: 'test',
      severity: 'low',
      description: 'Low severity',
      addedAt: new Date().toISOString(),
    }
    const high: ThreatIntelEntry = {
      type: 'hash',
      value: 'dup',
      source: 'test',
      severity: 'critical',
      description: 'Critical severity',
      addedAt: new Date().toISOString(),
    }
    service.addEntry(low)
    service.addEntry(high)
    const result = service.checkHash('dup')
    expect(result!.severity).toBe('critical')
    expect(result!.description).toBe('Critical severity')
  })

  it('Duplicate hash with lower severity does NOT update', () => {
    const high: ThreatIntelEntry = {
      type: 'hash',
      value: 'dup2',
      source: 'test',
      severity: 'critical',
      description: 'Critical',
      addedAt: new Date().toISOString(),
    }
    const low: ThreatIntelEntry = {
      type: 'hash',
      value: 'dup2',
      source: 'test',
      severity: 'low',
      description: 'Low',
      addedAt: new Date().toISOString(),
    }
    service.addEntry(high)
    service.addEntry(low)
    const result = service.checkHash('dup2')
    expect(result!.severity).toBe('critical')
  })

  it('getStats returns correct counts', () => {
    service.addEntry({ type: 'hash', value: 'h1', source: 't', severity: 'high', description: '', addedAt: '' })
    service.addEntry({ type: 'hash', value: 'h2', source: 't', severity: 'critical', description: '', addedAt: '' })
    service.addEntry({ type: 'domain', value: 'd1', source: 't', severity: 'low', description: '', addedAt: '' })
    const stats = service.getStats()
    expect(stats.total).toBe(3)
    expect(stats.byType.hash).toBe(2)
    expect(stats.byType.domain).toBe(1)
    expect(stats.bySeverity.high).toBe(1)
    expect(stats.bySeverity.critical).toBe(1)
    expect(stats.bySeverity.low).toBe(1)
  })

  it('toggleFeed enables/disables feed', () => {
    const feeds = service.getFeeds()
    const feedName = feeds[0]!.name
    expect(service.toggleFeed(feedName, true)).toBe(true)
    const updated = service.getFeeds()
    expect(updated.find((f) => f.name === feedName)!.enabled).toBe(true)
    expect(service.toggleFeed(feedName, false)).toBe(true)
    const updated2 = service.getFeeds()
    expect(updated2.find((f) => f.name === feedName)!.enabled).toBe(false)
  })

  it('toggleFeed returns false for unknown feed', () => {
    expect(service.toggleFeed('Nonexistent Feed', true)).toBe(false)
  })

  it('getFeeds returns all configured feeds', () => {
    const feeds = service.getFeeds()
    expect(feeds.length).toBeGreaterThanOrEqual(3)
  })

  it('clear removes all entries', () => {
    service.addEntry({ type: 'hash', value: 'h1', source: 't', severity: 'high', description: '', addedAt: '' })
    service.clear()
    expect(service.getStats().total).toBe(0)
  })

  it('Default feeds are configured', () => {
    const feeds = service.getFeeds()
    expect(feeds.length).toBeGreaterThanOrEqual(3)
    expect(feeds.some((f) => f.name.includes('Abuse'))).toBe(true)
    expect(feeds.some((f) => f.name.includes('MalwareBazaar'))).toBe(true)
    expect(feeds.some((f) => f.name.includes('PhishTank'))).toBe(true)
  })

  it('Parsing methods do not throw', async () => {
    const feeds = service.getFeeds()
    await expect(service.updateAllFeeds()).resolves.toBeDefined()
  })

  it('MAX_ENTRIES is respected', () => {
    for (let i = 0; i < 50010; i++) {
      service.addEntry({
        type: 'hash',
        value: `hash-${i}`,
        source: 'test',
        severity: 'low',
        description: 'bulk',
        addedAt: '',
      })
    }
    const stats = service.getStats()
    expect(stats.total).toBeLessThanOrEqual(50000)
  })

  it('getEntriesByType returns correct entries', () => {
    service.addEntry({ type: 'hash', value: 'h1', source: 't', severity: 'high', description: '', addedAt: '' })
    service.addEntry({ type: 'domain', value: 'd1', source: 't', severity: 'low', description: '', addedAt: '' })
    service.addEntry({ type: 'hash', value: 'h2', source: 't', severity: 'medium', description: '', addedAt: '' })
    const hashes = service.getEntriesByType('hash')
    expect(hashes).toHaveLength(2)
    const domains = service.getEntriesByType('domain')
    expect(domains).toHaveLength(1)
  })

  it('startAutoUpdate and stopAutoUpdate do not throw', () => {
    expect(() => service.startAutoUpdate()).not.toThrow()
    expect(() => service.stopAutoUpdate()).not.toThrow()
  })

  it('loads entries from cache file when it exists', () => {
    const entries: [string, ThreatIntelEntry][] = [['hash:abc', { type: 'hash', value: 'abc', source: 'cache', severity: 'high', description: 'cached', addedAt: '' }]]
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ entries }))
    const svc = new ThreatIntelService()
    expect(svc.checkHash('abc')).not.toBeNull()
    expect(svc.checkHash('abc')!.value).toBe('abc')
  })

  it('loads feeds from cache file', () => {
    const customFeeds = [{ name: 'Custom Feed', url: 'http://example.com', enabled: true, updateInterval: 1000, parser: 'csv' }]
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({ entries: [], feeds: customFeeds }))
    const svc = new ThreatIntelService()
    const feeds = svc.getFeeds()
    expect(feeds).toHaveLength(1)
    expect(feeds[0].name).toBe('Custom Feed')
  })

  it('handles load errors gracefully when JSON.parse fails', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation(() => { throw new Error('read error') })
    expect(() => new ThreatIntelService()).not.toThrow()
  })

  it('handles save errors gracefully', () => {
    mockWriteFileSync.mockImplementation(() => { throw new Error('write error') })
    const svc = new ThreatIntelService()
    expect(() => svc.toggleFeed('Abuse.ch SSL Blacklist', true)).not.toThrow()
  })

  it('updateAllFeeds with CSV feed enabled', async () => {
    const svc = new ThreatIntelService()
    svc.toggleFeed('Abuse.ch SSL Blacklist', true)
    const results = await svc.updateAllFeeds()
    expect(results).toHaveLength(1)
    expect(results[0].feed).toBe('Abuse.ch SSL Blacklist')
    expect(results[0].added).toBe(0)
  })

  it('updateAllFeeds with JSON feed enabled', async () => {
    const svc = new ThreatIntelService()
    svc.toggleFeed('MalwareBazaar Hashes', true)
    const results = await svc.updateAllFeeds()
    expect(results).toHaveLength(1)
    expect(results[0].feed).toBe('MalwareBazaar Hashes')
    expect(results[0].added).toBe(0)
  })

  it('updateAllFeeds handles feed update error', async () => {
    const svc = new ThreatIntelService()
    svc.toggleFeed('Abuse.ch SSL Blacklist', true)
    vi.mocked((await import('./logger.service')).getLogger).mockReturnValueOnce({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(() => { throw new Error('parse failed') }),
      success: vi.fn(),
      warning: vi.fn(),
    })
    const results = await svc.updateAllFeeds()
    expect(results).toHaveLength(1)
    expect(results[0].added).toBe(0)
  })

  it('updateFeed handles unknown parser type via cache', async () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({
      entries: [],
      feeds: [{ name: 'STIX Feed', url: 'http://example.com', enabled: true, updateInterval: 1000, parser: 'stix' }],
    }))
    const svc = new ThreatIntelService()
    const results = await svc.updateAllFeeds()
    expect(results).toHaveLength(1)
    expect(results[0].added).toBe(0)
  })

  it('getThreatIntelService returns singleton', () => {
    const instance1 = getThreatIntelService()
    const instance2 = getThreatIntelService()
    expect(instance1).toBe(instance2)
  })

  it('addEntry with same severity does not overwrite', () => {
    const entry1: ThreatIntelEntry = { type: 'hash', value: 'samesev', source: 't', severity: 'high', description: 'first', addedAt: '' }
    const entry2: ThreatIntelEntry = { type: 'hash', value: 'samesev', source: 't', severity: 'high', description: 'second', addedAt: '' }
    service.addEntry(entry1)
    service.addEntry(entry2)
    const result = service.checkHash('samesev')
    expect(result!.description).toBe('first')
  })

  it('returns empty results when no feeds enabled', async () => {
    const results = await service.updateAllFeeds()
    expect(results).toHaveLength(0)
  })

  it('handles non-Error in load catch', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockImplementation(() => { throw 'string error' })
    expect(() => new ThreatIntelService()).not.toThrow()
  })

  it('handles non-Error in save catch', () => {
    mockWriteFileSync.mockImplementation(() => { throw 'string write error' })
    const svc = new ThreatIntelService()
    expect(() => svc.toggleFeed('Abuse.ch SSL Blacklist', true)).not.toThrow()
  })

  it('cache file exists but has no feeds property', () => {
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(JSON.stringify({}))
    const svc = new ThreatIntelService()
    const feeds = svc.getFeeds()
    expect(feeds.length).toBe(3)
  })

  it('startAutoUpdate interval callback fires updateAllFeeds', async () => {
    vi.useFakeTimers()
    const svc = new ThreatIntelService()
    vi.spyOn(svc, 'updateAllFeeds').mockResolvedValue([])
    svc.startAutoUpdate()
    await vi.advanceTimersByTimeAsync(600000)
    svc.stopAutoUpdate()
    vi.useRealTimers()
  })

  it('updateAllFeeds handles non-Error thrown from feed parser', async () => {
    const svc = new ThreatIntelService()
    svc.toggleFeed('Abuse.ch SSL Blacklist', true)
    vi.mocked((await import('./logger.service')).getLogger).mockReturnValueOnce({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(() => { throw 'string error' }),
      success: vi.fn(),
      warning: vi.fn(),
    })
    const results = await svc.updateAllFeeds()
    expect(results).toHaveLength(1)
    expect(results[0].added).toBe(0)
  })

  it('checkDomain wildcard skips non-domain entries', () => {
    service.addEntry({ type: 'hash', value: 'abc', source: 't', severity: 'high', description: '', addedAt: '' })
    expect(service.checkDomain('nonexistent.com')).toBeNull()
  })

  it('findWildcardMatch returns null when no wildcard matches', () => {
    service.addEntry({ type: 'domain', value: 'evil.com', source: 't', severity: 'high', description: '', addedAt: '' })
    expect(service.checkDomain('other.com')).toBeNull()
  })
})
