import type { ScheduleEntry } from '@shared/types'
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getNextRunTime } from './schedules-utils'

function makeEntry(overrides: Partial<ScheduleEntry> = {}): ScheduleEntry {
  return {
    id: 'test',
    name: 'Test',
    enabled: true,
    frequency: 'daily',
    day: 1,
    hour: 8,
    tasks: [],
    autoApply: false,
    lastRunAt: null,
    lastRunStatus: 'never',
    createdAt: '2026-01-01',
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

  describe('daily', () => {
    it('returns same day when run time is in the future', () => {
      vi.setSystemTime(new Date(2026, 5, 21, 10, 0, 0))
      const result = getNextRunTime(makeEntry({ frequency: 'daily', hour: 12, minute: 0 }))
      expect(result!.getTime()).toBe(new Date(2026, 5, 21, 12, 0, 0).getTime())
    })

    it('returns next day when run time has already passed', () => {
      vi.setSystemTime(new Date(2026, 5, 21, 14, 0, 0))
      const result = getNextRunTime(makeEntry({ frequency: 'daily', hour: 8, minute: 0 }))
      expect(result!.getTime()).toBe(new Date(2026, 5, 22, 8, 0, 0).getTime())
    })

    it('defaults minute to 0 when minute is not provided', () => {
      vi.setSystemTime(new Date(2026, 5, 21, 10, 0, 0))
      const result = getNextRunTime(makeEntry({ frequency: 'daily', hour: 12 }))
      expect(result!.getHours()).toBe(12)
      expect(result!.getMinutes()).toBe(0)
    })
  })

  describe('weekly', () => {
    it('advances to the correct day of the week', () => {
      vi.setSystemTime(new Date(2026, 5, 21, 10, 0, 0)) // Sunday
      const result = getNextRunTime(
        makeEntry({ frequency: 'weekly', day: 1, hour: 8, minute: 0 }), // Monday
      )
      expect(result!.getTime()).toBe(new Date(2026, 5, 22, 8, 0, 0).getTime())
    })

    it('wraps to next week when the scheduled day has already passed', () => {
      vi.setSystemTime(new Date(2026, 5, 21, 10, 0, 0)) // Sunday, scheduled Sunday 08:00
      const result = getNextRunTime(makeEntry({ frequency: 'weekly', day: 0, hour: 8, minute: 0 }))
      expect(result!.getTime()).toBe(new Date(2026, 5, 28, 8, 0, 0).getTime())
    })
  })

  describe('monthly', () => {
    it('returns same month when run time is still in the future', () => {
      vi.setSystemTime(new Date(2026, 2, 15, 7, 0, 0)) // March 15 07:00
      const result = getNextRunTime(makeEntry({ frequency: 'monthly', day: 15, hour: 8, minute: 0 }))
      expect(result!.getTime()).toBe(new Date(2026, 2, 15, 8, 0, 0).getTime())
    })

    it('advances to next month when run time has already passed', () => {
      vi.setSystemTime(new Date(2026, 2, 31, 10, 0, 0)) // March 31 10:00
      const result = getNextRunTime(makeEntry({ frequency: 'monthly', day: 15, hour: 8, minute: 0 }))
      expect(result!.getTime()).toBe(new Date(2026, 3, 15, 8, 0, 0).getTime())
    })

    it('clamps day to the last day of the month (e.g., day 31 on Feb 28)', () => {
      vi.setSystemTime(new Date(2026, 1, 28, 10, 0, 0)) // Feb 28 10:00
      const result = getNextRunTime(makeEntry({ frequency: 'monthly', day: 31, hour: 8, minute: 0 }))
      expect(result!.getTime()).toBe(new Date(2026, 2, 31, 8, 0, 0).getTime())
    })

    it('handles day 31 on a 30-day month without advancing unnecessarily', () => {
      vi.setSystemTime(new Date(2026, 3, 30, 7, 0, 0)) // April 30 07:00
      const result = getNextRunTime(makeEntry({ frequency: 'monthly', day: 31, hour: 8, minute: 0 }))
      // April max = 30, clamped to 30 → April 30 08:00
      expect(result!.getTime()).toBe(new Date(2026, 3, 30, 8, 0, 0).getTime())
    })
  })
})
