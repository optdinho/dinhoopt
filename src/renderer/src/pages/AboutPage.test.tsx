// @vitest-environment jsdom

import type { UpdateStatus } from '@shared/types'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  status: { state: 'idle' } as UpdateStatus,
  updaterInstall: vi.fn(),
  updaterCheck: vi.fn(),
  updaterDownload: vi.fn(),
}))

vi.mock('@/stores/app-update-store', () => ({
  useAppUpdateStore: (selector: (s: { status: UpdateStatus }) => unknown) => selector({ status: mocks.status }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
  }),
}))

vi.mock('@/assets/logo.png', () => ({ default: 'logo.png' }))

// Injected by electron.vite.config.ts `define`; vitest does not apply it.
;(globalThis as unknown as { __APP_VERSION__: string }).__APP_VERSION__ = '0.0.0-test'

import { AboutPage } from './AboutPage'

;(window as unknown as { dinho: unknown }).dinho = {
  updaterInstall: mocks.updaterInstall,
  updaterCheck: mocks.updaterCheck,
  updaterDownload: mocks.updaterDownload,
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.status = { state: 'idle' }
})

describe('AboutPage update section', () => {
  it('offers a check button while idle', () => {
    render(<AboutPage />)
    expect(screen.getByText('checkForUpdates')).not.toBeNull()
  })

  it('offers a download button when an update is available', () => {
    mocks.status = { state: 'available', version: '2.0.0' }
    render(<AboutPage />)
    expect(screen.getByText('download')).not.toBeNull()
  })

  it('offers restart-and-install once the download finishes', () => {
    mocks.status = { state: 'downloaded', version: '2.0.0' }
    render(<AboutPage />)
    expect(screen.getByText('restartAndInstall:{"version":"2.0.0"}')).not.toBeNull()
  })

  it('explains that a deferred install is waiting on the app being busy', () => {
    mocks.status = {
      state: 'deferred',
      version: '2.0.0',
      deferredReasons: [{ key: 'recording', label: 'busyClipRecording' }],
    }
    render(<AboutPage />)
    expect(screen.getByTestId('update-deferred')).not.toBeNull()
    expect(screen.getByText('updateDeferredBody:{"version":"2.0.0"}')).not.toBeNull()
  })

  it('does not offer restart-and-install while deferred, so the user cannot force the kill', () => {
    mocks.status = {
      state: 'deferred',
      version: '2.0.0',
      deferredReasons: [{ key: 'recording', label: 'busyClipRecording' }],
    }
    render(<AboutPage />)
    expect(screen.queryByText('restartAndInstall:{"version":"2.0.0"}')).toBeNull()
  })

  it('translates each busy reason through its i18n label', () => {
    mocks.status = {
      state: 'deferred',
      version: '2.0.0',
      deferredReasons: [
        { key: 'recording', label: 'busyClipRecording' },
        { key: 'malwareScan', label: 'busyMalwareScan' },
      ],
    }
    render(<AboutPage />)
    expect(screen.getByText('busyClipRecording')).not.toBeNull()
    expect(screen.getByText('busyMalwareScan')).not.toBeNull()
  })

  it('still renders when deferred with no reason reported', () => {
    mocks.status = { state: 'deferred', version: '2.0.0' }
    render(<AboutPage />)
    expect(screen.getByTestId('update-deferred')).not.toBeNull()
  })

  it('shows the error and a retry button on failure', () => {
    mocks.status = { state: 'error', error: 'sem rede' }
    render(<AboutPage />)
    expect(screen.getByText('sem rede')).not.toBeNull()
    expect(screen.getByText('retry')).not.toBeNull()
  })
})
