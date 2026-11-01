// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

const mocks = vi.hoisted(() => ({
  checkStatus: vi.fn(),
  getHwid: vi.fn(),
  activate: vi.fn(),
  openExternal: vi.fn(),
}))

vi.mock('../stores/license-store', () => ({
  useLicenseStore: () => ({
    hwid: 'HWID-TEST',
    isActivating: false,
    error: null,
    getHwid: mocks.getHwid,
    activate: mocks.activate,
    checkStatus: mocks.checkStatus,
  }),
}))

import LicenseGate from './LicenseGate'

describe('LicenseGate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getHwid.mockResolvedValue('HWID-TEST')
    window.dinho = { openExternal: mocks.openExternal } as unknown as typeof window.dinho
  })

  it('refreshes the license status and unlocks without reopening the app', async () => {
    mocks.checkStatus.mockResolvedValueOnce({ valid: false, reason: 'not yet' }).mockResolvedValueOnce({ valid: true })

    render(
      <LicenseGate>
        <div>APP CONTENT</div>
      </LicenseGate>,
    )

    const refreshButton = await screen.findByText('refreshStatus')
    fireEvent.click(refreshButton)

    expect(await screen.findByText('APP CONTENT')).toBeTruthy()
    expect(mocks.checkStatus).toHaveBeenCalledTimes(2)
  })

  it('shows a notice when the license is still not valid after refreshing', async () => {
    mocks.checkStatus.mockResolvedValue({ valid: false, reason: 'still invalid' })

    render(
      <LicenseGate>
        <div>APP CONTENT</div>
      </LicenseGate>,
    )

    fireEvent.click(await screen.findByText('refreshStatus'))

    expect(await screen.findByText('still invalid')).toBeTruthy()
    expect(screen.queryByText('APP CONTENT')).toBeNull()
  })

  it('opens the renewal site when clicking renew now', async () => {
    mocks.checkStatus.mockResolvedValue({ valid: false, reason: 'no license' })

    render(
      <LicenseGate>
        <div>APP CONTENT</div>
      </LicenseGate>,
    )

    fireEvent.click(await screen.findByText('renewNow'))

    expect(mocks.openExternal).toHaveBeenCalledWith('https://dinhooptimizer.netlify.app/')
  })
})
