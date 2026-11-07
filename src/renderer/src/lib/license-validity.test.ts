import { describe, expect, it } from 'vitest'
import { getLicenseExpiry } from './license-validity'

/** `now` local, dia 7 de novembro de 2026, ao meio-dia. */
const NOW = new Date(2026, 10, 7, 12, 0, 0)

describe('getLicenseExpiry', () => {
  it('returns null without an expiry date', () => {
    expect(getLicenseExpiry(null, NOW)).toBeNull()
    expect(getLicenseExpiry(undefined, NOW)).toBeNull()
    expect(getLicenseExpiry('', NOW)).toBeNull()
  })

  it('returns null for an unparseable date', () => {
    expect(getLicenseExpiry('not-a-date', NOW)).toBeNull()
  })

  it('returns null for an impossible calendar date instead of rolling over', () => {
    expect(getLicenseExpiry('2026-02-30', NOW)).toBeNull()
    expect(getLicenseExpiry('2026-13-01', NOW)).toBeNull()
  })

  it('counts calendar days for a date-only value', () => {
    const expiry = getLicenseExpiry('2026-11-23', NOW)
    expect(expiry?.daysLeft).toBe(16)
    expect(expiry?.expiresAt.getFullYear()).toBe(2026)
    expect(expiry?.expiresAt.getMonth()).toBe(10)
    expect(expiry?.expiresAt.getDate()).toBe(23)
  })

  it('does not shift a date-only value by the timezone', () => {
    // Meia-noite UTC de 1 de janeiro continua a ser 1 de janeiro localmente.
    const expiry = getLicenseExpiry('2026-01-01', new Date(2025, 11, 31, 23, 30))
    expect(expiry?.daysLeft).toBe(1)
    expect(expiry?.expiresAt.getDate()).toBe(1)
  })

  it('handles month and year rollover', () => {
    expect(getLicenseExpiry('2027-01-02', new Date(2026, 11, 30, 9))?.daysLeft).toBe(3)
  })

  it('counts days for a full ISO timestamp in local calendar days', () => {
    const instant = new Date('2026-11-23T12:00:00.000Z')
    const now = new Date(instant.getFullYear(), instant.getMonth(), instant.getDate() - 16, 12)
    const expiry = getLicenseExpiry(instant.toISOString(), now)
    expect(expiry?.daysLeft).toBe(16)
  })

  it('reports 0 on the expiry day and negative values once expired', () => {
    expect(getLicenseExpiry('2026-11-07', NOW)?.daysLeft).toBe(0)
    expect(getLicenseExpiry('2026-11-06', NOW)?.daysLeft).toBe(-1)
    expect(getLicenseExpiry('2026-10-24', NOW)?.daysLeft).toBe(-14)
  })

  it('assigns the renewal warning tones', () => {
    expect(getLicenseExpiry('2026-11-23', NOW)?.tone).toBe('ok')
    expect(getLicenseExpiry('2026-11-14', NOW)?.tone).toBe('warning')
    expect(getLicenseExpiry('2026-11-10', NOW)?.tone).toBe('critical')
    expect(getLicenseExpiry('2026-11-07', NOW)?.tone).toBe('critical')
    expect(getLicenseExpiry('2026-11-06', NOW)?.tone).toBe('critical')
  })
})
