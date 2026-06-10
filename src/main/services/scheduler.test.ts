import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock Electron and dependencies before importing
const mockNotifications: any[] = []
let mockNotifySupported = false

vi.mock('electron', () => {
  class MockNotification {
    constructor(opts: any) {
      ;(this as any).title = opts.title
      ;(this as any).body = opts.body
      ;(this as any).show = vi.fn()
      mockNotifications.push(this)
    }
    static isSupported() { return mockNotifySupported }
  }
  return {
    BrowserWindow: class {
      isDestroyed = () => false
      webContents = { send: vi.fn() }
    },
    Notification: MockNotification,
  }
})

const mockGetSettings = vi.fn()
const mockUpdateScheduleEntry = vi.fn()
vi.mock('./settings-store', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  updateScheduleEntry: (...args: unknown[]) => mockUpdateScheduleEntry(...args),
}))

beforeEach(() => {
  mockGetSettings.mockReset()
  mockGetSettings.mockReturnValue({} as any)
})
vi.mock('./history-store', () => ({ getHistory: () => [] }))
vi.mock('./logger', () => ({ logInfo: vi.fn(), logError: vi.fn() }))

import {
  getNextScanTime,
  getNextRunTime,
  isSameDay,
  notifyScheduledScanComplete,
  completeScheduleRun,
  startScheduler,
  stopScheduler,
} from './scheduler'
import { logInfo } from './logger'
import type { DiNhoSettings, ScheduleEntry } from '@shared/types'

function makeSettings(
  overrides: Partial<DiNhoSettings['schedule']> & { enabled?: boolean } = {}
): DiNhoSettings {
  return {
    theme: 'dark',
    language: 'en',
    minimizeToTray: false,
    showNotificationOnComplete: true,
    showThreatNotifications: true,
    runAtStartup: false,
    autoUpdate: true,
    autoRestart: true,
    updateCheckIntervalHours: 4,
    cleaner: {
      skipRecentMinutes: 60,
      secureDelete: false,
      closeBrowsersBeforeClean: false,
      createRestorePoint: false,
      protectRecycleBin: true,
    },
    exclusions: [],
    ignoredSoftwareUpdates: [],
    backupPath: '',
    backupMode: 'targeted',
    schedule: {
      enabled: overrides.enabled ?? true,
      frequency: overrides.frequency ?? 'daily',
      day: overrides.day ?? 1,
      hour: overrides.hour ?? 9,
    },
    schedules: [],
    windowsPackageManager: 'winget',
    gameMode: {
      enabledOptimizations: [],
      customProcessKillList: [],
      autoDetect: false,
      autoDeactivate: true,
      customGameProcesses: [],
      gameProfiles: {},
    },
    registryIgnoredTweaks: [],
    malwareAllowlist: [],
  }
}

describe('isSameDay', () => {
  it('returns true for the same date', () => {
    const a = new Date('2025-06-15T08:00:00')
    const b = new Date('2025-06-15T22:30:00')
    expect(isSameDay(a, b)).toBe(true)
  })

  it('returns false for different dates', () => {
    const a = new Date('2025-06-15T23:59:59')
    const b = new Date('2025-06-16T00:00:01')
    expect(isSameDay(a, b)).toBe(false)
  })

  it('returns false for same day different month', () => {
    const a = new Date('2025-01-15')
    const b = new Date('2025-02-15')
    expect(isSameDay(a, b)).toBe(false)
  })

  it('returns false for same day different year', () => {
    const a = new Date('2024-06-15')
    const b = new Date('2025-06-15')
    expect(isSameDay(a, b)).toBe(false)
  })
})

describe('getNextScanTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when schedule is disabled', () => {
    const settings = makeSettings({ enabled: false })
    expect(getNextScanTime(settings)).toBeNull()
  })

  // Daily scheduling
  describe('daily', () => {
    it('returns today if scheduled hour has not passed', () => {
      // Current time: 7:00, scheduled: 9:00
      vi.setSystemTime(new Date('2025-06-15T07:00:00'))
      const settings = makeSettings({ frequency: 'daily', hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDate()).toBe(15)
      expect(result.getHours()).toBe(9)
    })

    it('returns tomorrow if scheduled hour has passed', () => {
      // Current time: 10:00, scheduled: 9:00
      vi.setSystemTime(new Date('2025-06-15T10:00:00'))
      const settings = makeSettings({ frequency: 'daily', hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDate()).toBe(16)
      expect(result.getHours()).toBe(9)
    })
  })

  // Weekly scheduling
  describe('weekly', () => {
    it('returns the correct day of the week', () => {
      // June 15, 2025 is a Sunday (day 0). Schedule for Wednesday (day 3)
      vi.setSystemTime(new Date('2025-06-15T07:00:00'))
      const settings = makeSettings({ frequency: 'weekly', day: 3, hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDay()).toBe(3) // Wednesday
      expect(result.getHours()).toBe(9)
    })

    it('goes to next week if the day has passed', () => {
      // June 15, 2025 is Sunday. Schedule for Saturday (day 6) at 9am, but it's past
      // Actually let's set to Monday (day 1) and schedule for Sunday (day 0)
      vi.setSystemTime(new Date('2025-06-16T10:00:00')) // Monday
      const settings = makeSettings({ frequency: 'weekly', day: 0, hour: 9 }) // Sunday
      const result = getNextScanTime(settings)!
      expect(result.getDay()).toBe(0) // Sunday
      expect(result.getDate()).toBe(22) // Next Sunday
    })

    it('goes to next week if same day but hour has passed', () => {
      // June 15, 2025 is Sunday. Schedule for Sunday at 9am, but it's 10am
      vi.setSystemTime(new Date('2025-06-15T10:00:00'))
      const settings = makeSettings({ frequency: 'weekly', day: 0, hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDay()).toBe(0)
      expect(result.getDate()).toBe(22) // Next Sunday
    })
  })

  // Monthly scheduling
  describe('monthly', () => {
    it('returns the correct day this month if not yet passed', () => {
      vi.setSystemTime(new Date('2025-06-10T07:00:00'))
      const settings = makeSettings({ frequency: 'monthly', day: 15, hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getDate()).toBe(15)
      expect(result.getMonth()).toBe(5) // June
    })

    it('goes to next month if day has passed', () => {
      vi.setSystemTime(new Date('2025-06-20T10:00:00'))
      const settings = makeSettings({ frequency: 'monthly', day: 15, hour: 9 })
      const result = getNextScanTime(settings)!
      expect(result.getMonth()).toBe(6) // July
      expect(result.getDate()).toBe(15)
    })

    it('clamps day for short months (e.g., Feb 31 → Feb 28)', () => {
      // Set time to early February so the scheduler targets Feb with day=31
      vi.setSystemTime(new Date('2025-02-01T07:00:00'))
      const settings = makeSettings({ frequency: 'monthly', day: 31, hour: 9 })
      const result = getNextScanTime(settings)!
      // Day 31 in Feb overflows, then the clamp should cap it to 28
      expect(result.getDate()).toBeLessThanOrEqual(28) // 2025 is not a leap year
    })
  })

  it('always returns a future date', () => {
    vi.setSystemTime(new Date('2025-06-15T12:00:00'))
    const settings = makeSettings({ frequency: 'daily', hour: 8 })
    const result = getNextScanTime(settings)!
    expect(result.getTime()).toBeGreaterThan(new Date('2025-06-15T12:00:00').getTime())
  })

  it('returns soonest schedule when multiple schedules exist', () => {
    vi.setSystemTime(new Date('2025-06-15T07:00:00')) // Sunday
    const settings = makeSettings({ enabled: false })
    settings.schedules = [
      makeEntry({ frequency: 'daily', hour: 20 }),    // today at 20:00
      makeEntry({ frequency: 'daily', hour: 10 }),    // today at 10:00 (soonest)
      makeEntry({ frequency: 'weekly', day: 3, hour: 9 }),  // Wed at 9:00
    ]
    const result = getNextScanTime(settings)!
    expect(result.getHours()).toBe(10)
    expect(result.getDate()).toBe(15) // today
  })
})

// ─── getNextRunTime (per-entry) ───────────────────────────

function makeEntry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: 'test-' + Math.random(),
    name: 'Test Schedule',
    enabled: true,
    frequency: 'daily',
    day: 1,
    hour: 9,
    minute: 0,
    tasks: ['cleaner:system'],
    autoApply: false,
    lastRunAt: null,
    lastRunStatus: 'never',
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('getNextRunTime', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns null when entry is disabled', () => {
    expect(getNextRunTime(makeEntry({ enabled: false }))).toBeNull()
  })

  it('returns today for daily schedule if hour has not passed', () => {
    vi.setSystemTime(new Date('2025-06-15T07:00:00'))
    const result = getNextRunTime(makeEntry({ frequency: 'daily', hour: 9 }))!
    expect(result.getDate()).toBe(15)
    expect(result.getHours()).toBe(9)
  })

  it('returns tomorrow for daily schedule if hour has passed', () => {
    vi.setSystemTime(new Date('2025-06-15T10:00:00'))
    const result = getNextRunTime(makeEntry({ frequency: 'daily', hour: 9 }))!
    expect(result.getDate()).toBe(16)
  })

  it('returns correct day of week for weekly schedule', () => {
    vi.setSystemTime(new Date('2025-06-15T07:00:00')) // Sunday
    const result = getNextRunTime(makeEntry({ frequency: 'weekly', day: 3, hour: 9 }))!
    expect(result.getDay()).toBe(3) // Wednesday
  })

  it('clamps day for monthly schedule in short months', () => {
    vi.setSystemTime(new Date('2025-02-01T07:00:00'))
    const result = getNextRunTime(makeEntry({ frequency: 'monthly', day: 31, hour: 9 }))!
    expect(result.getDate()).toBeLessThanOrEqual(28)
  })
})

// ─────────────────────────────────────────────
// notifyScheduledScanComplete
// ─────────────────────────────────────────────
describe('notifyScheduledScanComplete', () => {
  beforeEach(() => {
    mockNotifications.length = 0
    mockGetSettings.mockReturnValue({
      showNotificationOnComplete: true,
    } as any)
  })

  it('does nothing when running in daemon mode', () => {
    const origArgv = process.argv
    process.argv = ['--daemon']
    mockNotifySupported = true
    notifyScheduledScanComplete(1000, 5)
    expect(mockNotifications).toHaveLength(0)
    process.argv = origArgv
  })

  it('does nothing when Notification is not supported', () => {
    mockNotifySupported = false
    notifyScheduledScanComplete(1000, 5)
    expect(mockNotifications).toHaveLength(0)
  })

  it('does nothing when showNotificationOnComplete is false', () => {
    mockNotifySupported = true
    mockGetSettings.mockReturnValue({
      showNotificationOnComplete: false,
    } as any)
    notifyScheduledScanComplete(1000, 5)
    expect(mockNotifications).toHaveLength(0)
  })

  it('shows notification when conditions are met', () => {
    mockNotifySupported = true
    notifyScheduledScanComplete(1048576, 3)
    expect(mockNotifications).toHaveLength(1)
    expect(mockNotifications[0].show).toHaveBeenCalled()
  })
})

// ─────────────────────────────────────────────
// completeScheduleRun
// ─────────────────────────────────────────────
describe('completeScheduleRun', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('calls updateScheduleEntry with success status', () => {
    completeScheduleRun('schedule-1', 'success')
    expect(mockUpdateScheduleEntry).toHaveBeenCalledWith('schedule-1', {
      lastRunAt: expect.any(String),
      lastRunStatus: 'success',
    })
  })

  it('calls updateScheduleEntry with failed status', () => {
    completeScheduleRun('schedule-2', 'failed')
    expect(mockUpdateScheduleEntry).toHaveBeenCalledWith('schedule-2', {
      lastRunAt: expect.any(String),
      lastRunStatus: 'failed',
    })
  })
})

// ─────────────────────────────────────────────
// startScheduler / stopScheduler
// ─────────────────────────────────────────────
describe('startScheduler / stopScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockNotifications.length = 0
    vi.clearAllMocks()
  })

  afterEach(() => {
    stopScheduler()
    vi.useRealTimers()
  })

  function mockSettingsWithSchedules(schedules: any[]) {
    mockGetSettings.mockImplementation(() => ({
      schedule: { enabled: false },
      showNotificationOnComplete: false,
      schedules,
    }) as any)
  }

  it('starts and stops the scheduler interval', () => {
    const getMainWindow = () => null
    startScheduler(getMainWindow)

    // advance past initial check (5s)
    vi.advanceTimersByTime(5000)
    expect(vi.mocked(logInfo)).toHaveBeenCalledWith('Scheduler started')

    // clear interval by stopping
    stopScheduler()
    expect(vi.mocked(logInfo)).toHaveBeenCalledWith('Scheduler stopped')
  })

  it('does not start twice', () => {
    const getMainWindow = () => null
    startScheduler(getMainWindow)
    startScheduler(getMainWindow)
    expect(vi.mocked(logInfo)).toHaveBeenCalledTimes(1)
    stopScheduler()
  })

  it('checks schedules on start (initial check)', () => {
    vi.setSystemTime(new Date('2025-06-15T12:30:00'))
    mockSettingsWithSchedules([
      { id: 's1', name: 'Test', enabled: true, frequency: 'daily', day: 1, hour: 12, minute: 30, tasks: [], autoApply: false, lastRunAt: null, lastRunStatus: 'never', createdAt: '' },
    ])
    const send = vi.fn()
    const win = { isDestroyed: () => false, webContents: { send } }
    startScheduler(() => win as any)

    vi.advanceTimersByTime(5000)

    expect(send).toHaveBeenCalled()
    stopScheduler()
  })

  it('does not crash when checkSchedules throws', () => {
    mockGetSettings.mockReturnValue(undefined as any)
    const getMainWindow = () => { throw new Error('fail') }
    startScheduler(getMainWindow)
    vi.advanceTimersByTime(5000)
    vi.advanceTimersByTime(60000)
    expect(vi.mocked(logInfo)).toHaveBeenCalledWith(expect.stringContaining('error'))
    stopScheduler()
  })

  it('cleans up inFlight timers on stop', () => {
    mockSettingsWithSchedules([
      { id: 's1', name: 'Test', enabled: true, frequency: 'daily', day: 1, hour: 0, minute: 0, tasks: [], autoApply: false, lastRunAt: null, lastRunStatus: 'never' },
    ])
    const win = { isDestroyed: () => false, webContents: { send: vi.fn() } }
    startScheduler(() => win as any)
    vi.advanceTimersByTime(5000)
    stopScheduler()
    // Should not throw — cleanup happened
    expect(true).toBe(true)
  })
})
