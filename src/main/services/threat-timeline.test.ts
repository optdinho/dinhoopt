import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockExistsSync = vi.fn()
const mockReadFileSync = vi.fn()
const mockWriteFileSync = vi.fn()
const mockMkdirSync = vi.fn()

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-dinho/threat-timeline'),
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
  getLogger: () => ({
    error: vi.fn(),
  }),
}))

import { ThreatTimelineService, getThreatTimelineService } from './threat-timeline.service'

describe('ThreatTimelineService', () => {
  let service: ThreatTimelineService

  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    service = new ThreatTimelineService()
  })

  it('addEntry creates a new entry', () => {
    service.addEntry({ name: 'Test Threat', severity: 'high', filePath: 'C:\\test.exe' }, 'quarantined', 'scan-1')
    const entries = service.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.threatName).toBe('Test Threat')
    expect(entries[0]!.severity).toBe('high')
    expect(entries[0]!.action).toBe('quarantined')
  })

  it('getEntries returns entries newest first', () => {
    service.addEntry({ name: 'Threat 1', severity: 'low', filePath: 'C:\\a.exe' }, 'skipped', 'scan-1')
    service.addEntry({ name: 'Threat 2', severity: 'high', filePath: 'C:\\b.exe' }, 'deleted', 'scan-2')
    const entries = service.getEntries()
    expect(entries).toHaveLength(2)
    expect(entries[0]!.threatName).toBe('Threat 2')
    expect(entries[1]!.threatName).toBe('Threat 1')
  })

  it('getEntries respects limit', () => {
    for (let i = 0; i < 10; i++) {
      service.addEntry(
        { name: `Threat ${i}`, severity: 'medium', filePath: `C:\\${i}.exe` },
        'quarantined',
        `scan-${i}`,
      )
    }
    const entries = service.getEntries(3)
    expect(entries).toHaveLength(3)
  })

  it('getBySeverity returns filtered results', () => {
    service.addEntry({ name: 'High Threat', severity: 'high', filePath: 'C:\\a.exe' }, 'quarantined', 'scan-1')
    service.addEntry({ name: 'Low Threat', severity: 'low', filePath: 'C:\\b.exe' }, 'skipped', 'scan-2')
    service.addEntry({ name: 'High Threat 2', severity: 'high', filePath: 'C:\\c.exe' }, 'deleted', 'scan-3')
    const highEntries = service.getBySeverity('high')
    expect(highEntries).toHaveLength(2)
    for (const e of highEntries) {
      expect(e.severity).toBe('high')
    }
  })

  it('getByDateRange returns entries in range', () => {
    service.addEntry({ name: 'Threat', severity: 'high', filePath: 'C:\\a.exe' }, 'quarantined', 'scan-1')
    const now = new Date().toISOString()
    const entries = service.getByDateRange('2000-01-01', now)
    expect(entries.length).toBeGreaterThanOrEqual(1)
  })

  it('getStats returns correct counts', () => {
    service.addEntry({ name: 'T1', severity: 'high', filePath: 'C:\\a.exe' }, 'quarantined', 'scan-1')
    service.addEntry({ name: 'T2', severity: 'high', filePath: 'C:\\b.exe' }, 'deleted', 'scan-2')
    service.addEntry({ name: 'T3', severity: 'low', filePath: 'C:\\c.exe' }, 'quarantined', 'scan-3')
    const stats = service.getStats()
    expect(stats.total).toBe(3)
    expect(stats.bySeverity.high).toBe(2)
    expect(stats.bySeverity.low).toBe(1)
    expect(stats.byAction.quarantined).toBe(2)
    expect(stats.byAction.deleted).toBe(1)
  })

  it('clear removes all entries', () => {
    service.addEntry({ name: 'T1', severity: 'high', filePath: 'C:\\a.exe' }, 'quarantined', 'scan-1')
    service.clear()
    expect(service.getEntries()).toHaveLength(0)
  })

  it('MAX_ENTRIES is respected (adding 1001 keeps 1000)', () => {
    for (let i = 0; i < 1001; i++) {
      service.addEntry({ name: `Threat ${i}`, severity: 'low', filePath: `C:\\${i}.exe` }, 'quarantined', `scan-${i}`)
    }
    const entries = service.getEntries(2000)
    expect(entries).toHaveLength(1000)
  })

  it('Entry has unique ID', () => {
    service.addEntry({ name: 'T1', severity: 'high', filePath: 'C:\\a.exe' }, 'quarantined', 'scan-1')
    service.addEntry({ name: 'T2', severity: 'low', filePath: 'C:\\b.exe' }, 'skipped', 'scan-2')
    const entries = service.getEntries()
    expect(entries[0]!.id).not.toBe(entries[1]!.id)
  })

  it('empty timeline returns empty array', () => {
    expect(service.getEntries()).toEqual([])
    expect(service.getBySeverity('high')).toEqual([])
  })

  it('addEntry with empty name still works', () => {
    service.addEntry({ name: '', severity: 'medium', filePath: 'C:\\test.exe' }, 'restored', 'scan-1')
    const entries = service.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.threatName).toBe('')
  })

  it('loads entries from file when it exists', () => {
    const data = JSON.stringify([
      {
        id: '1',
        threatName: 'Saved Threat',
        severity: 'high',
        filePath: 'C:/saved.exe',
        detectedAt: '2025-01-01',
        action: 'quarantined',
        scanId: 'scan-1',
      },
    ])
    mockExistsSync.mockReturnValue(true)
    mockReadFileSync.mockReturnValue(data)
    const svc = new ThreatTimelineService()
    const entries = svc.getEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]!.threatName).toBe('Saved Threat')
  })

  it('creates directory during save when it does not exist', () => {
    mockExistsSync.mockReturnValue(false)
    service.addEntry({ name: 'New Threat', severity: 'high', filePath: 'C:\\test.exe' }, 'quarantined', 'scan-1')
    expect(mockMkdirSync).toHaveBeenCalled()
  })

  it('does not create directory during save when it already exists', () => {
    mockExistsSync.mockReturnValue(true)
    service.addEntry({ name: 'New Threat', severity: 'low', filePath: 'C:\\test.exe' }, 'skipped', 'scan-1')
    expect(mockMkdirSync).not.toHaveBeenCalled()
  })

  it('handles error during save gracefully', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw new Error('disk full')
    })
    service.addEntry({ name: 'Bad', severity: 'high', filePath: 'C:\\bad.exe' }, 'quarantined', 'scan-1')
    // Should not throw — error is caught and logged
    expect(service.getEntries()).toHaveLength(1)
  })

  it('handles non-Error throw during save gracefully', () => {
    mockWriteFileSync.mockImplementation(() => {
      throw 'string error'
    })
    service.addEntry({ name: 'Bad', severity: 'high', filePath: 'C:\\bad.exe' }, 'quarantined', 'scan-1')
    expect(service.getEntries()).toHaveLength(1)
  })
})

describe('getThreatTimelineService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockExistsSync.mockReturnValue(false)
    // Reset the singleton for each test
    vi.resetModules()
  })

  it('creates a new instance on first call and returns same on second', async () => {
    const mod = await import('./threat-timeline.service')
    const first = mod.getThreatTimelineService()
    const second = mod.getThreatTimelineService()
    expect(first).toBe(second)
  })
})
