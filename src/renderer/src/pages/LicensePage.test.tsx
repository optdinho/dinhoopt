// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const getHwid = vi.fn()
  return {
    getHwid,
    state: {
      hwid: 'HWID-TEST',
      isActivating: false,
      error: null,
      loading: false,
      getHwid,
      activate: vi.fn(),
      checkStatus: vi.fn(),
      status: null as { valid: boolean; reason?: string; expires_at?: string | null } | null,
    },
  }
})

vi.mock('@/stores/license-store', () => ({
  useLicenseStore: () => mocks.state,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
    i18n: { language: 'pt' },
  }),
}))

import { LicensePage } from './LicensePage'

const NOW = new Date(2026, 10, 7, 12, 0, 0)

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  mocks.state.status = null
})

afterEach(() => {
  vi.useRealTimers()
})

describe('LicensePage license expiry', () => {
  it('shows how many days are left and the exact date', () => {
    mocks.state.status = { valid: true, expires_at: '2026-11-23' }
    render(<LicensePage />)
    const card = screen.getByTestId('license-expiry')
    expect(card.getAttribute('data-tone')).toBe('ok')
    expect(screen.getByText('daysRemaining:{"count":16}')).not.toBeNull()
    expect(screen.getByText(/^expiresOn:/)).not.toBeNull()
  })

  it('warns when the license expires within a week', () => {
    mocks.state.status = { valid: true, expires_at: '2026-11-12' }
    render(<LicensePage />)
    expect(screen.getByTestId('license-expiry').getAttribute('data-tone')).toBe('warning')
    expect(screen.getByText('daysRemaining:{"count":5}')).not.toBeNull()
  })

  it('marks the last days as critical', () => {
    mocks.state.status = { valid: true, expires_at: '2026-11-09' }
    render(<LicensePage />)
    expect(screen.getByTestId('license-expiry').getAttribute('data-tone')).toBe('critical')
  })

  it('says it expires today on the last day', () => {
    mocks.state.status = { valid: true, expires_at: '2026-11-07' }
    render(<LicensePage />)
    expect(screen.getByText('expiresToday')).not.toBeNull()
  })

  it('labels an already expired date', () => {
    mocks.state.status = { valid: true, expires_at: '2026-11-01' }
    render(<LicensePage />)
    expect(screen.getByText('licenseExpired')).not.toBeNull()
    expect(screen.getByTestId('license-expiry').getAttribute('data-tone')).toBe('critical')
  })

  it('shows a lifetime label when the server sends no expiry', () => {
    mocks.state.status = { valid: true, expires_at: null }
    render(<LicensePage />)
    expect(screen.getByTestId('license-lifetime')).not.toBeNull()
    expect(screen.queryByTestId('license-expiry')).toBeNull()
  })

  it('hides both labels when the expiry is unknown', () => {
    mocks.state.status = { valid: true }
    render(<LicensePage />)
    expect(screen.queryByTestId('license-expiry')).toBeNull()
    expect(screen.queryByTestId('license-lifetime')).toBeNull()
  })
})
