// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  stopedServicesStatus: vi.fn(),
  stopedServicesSet: vi.fn(),
  stopedServicesSetAll: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
  load: vi.fn(),
  setService: vi.fn(),
  setAll: vi.fn(),
}))

const state = {
  services: [] as Array<{
    id: string
    name: string
    running: boolean
    startType: string
    found: boolean
  }>,
  loading: false,
  changing: false,
  error: null as string | null,
  lastResult: null as unknown,
  runningCount: 0,
  stoppedCount: 0,
  missingCount: 0,
  load: mocks.load,
  setService: mocks.setService,
  setAll: mocks.setAll,
  clearError: vi.fn(),
  clearLastResult: vi.fn(),
}

vi.mock('@/stores/stoped-store', () => ({
  useStopedStore: Object.assign((selector: (s: typeof state) => unknown) => selector(state), {
    getState: () => state,
  }),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key}:${JSON.stringify(opts)}` : key),
  }),
}))

vi.mock('sonner', () => ({
  toast: { success: mocks.toastSuccess, error: mocks.toastError },
}))

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: ({ title, description, action }: any) => (
    <div data-testid="page-header">
      <div>{title}</div>
      <div>{description}</div>
      {action}
    </div>
  ),
}))

import { StopedPage } from './StopedPage'

const ALL_IDS = ['PcaSvc', 'DPS', 'DiagTrack', 'SysMain', 'EventLog', 'ADPSvc', 'UmRdpService']

function makeServices() {
  return [
    { id: 'PcaSvc', name: 'PcaSvc', running: true, startType: 'Automatic', found: true },
    { id: 'DPS', name: 'DPS', running: false, startType: 'Disabled', found: true },
    { id: 'DiagTrack', name: 'DiagTrack', running: true, startType: 'Automatic', found: true },
    { id: 'SysMain', name: 'SysMain', running: true, startType: 'Automatic', found: true },
    { id: 'EventLog', name: 'EventLog', running: true, startType: 'Automatic', found: true },
    { id: 'ADPSvc', name: 'ADPSvc', running: true, startType: 'Automatic', found: true },
    { id: 'UmRdpService', name: 'UmRdpService', running: false, startType: 'Manual', found: false },
  ]
}

function toggleOf(id: string): HTMLButtonElement {
  return screen.getByTestId(`stoped-toggle-${id}`) as HTMLButtonElement
}

function isChecked(id: string): boolean {
  return toggleOf(id).getAttribute('aria-checked') === 'true'
}

beforeEach(() => {
  vi.clearAllMocks()
  state.services = makeServices()
  state.loading = false
  state.changing = false
  state.error = null
  state.lastResult = null
  state.runningCount = 5
  state.stoppedCount = 1
  state.missingCount = 1
})

describe('StopedPage', () => {
  it('loads service status on mount', () => {
    render(<StopedPage />)
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('renders the page header', () => {
    render(<StopedPage />)
    expect(screen.getByTestId('page-header')).not.toBeNull()
    expect(screen.getByText('pageTitle')).not.toBeNull()
  })

  it('renders a toggle for every service in the catalog', () => {
    render(<StopedPage />)
    for (const id of ALL_IDS) {
      expect(toggleOf(id)).not.toBeNull()
    }
  })

  it('reflects live status: running services show a checked toggle + RUN', () => {
    render(<StopedPage />)
    expect(isChecked('PcaSvc')).toBe(true)
    expect(screen.getByTestId('stoped-status-PcaSvc').textContent).toBe('statusRunning')
  })

  it('reflects live status: stopped services show an unchecked toggle + STOPED', () => {
    render(<StopedPage />)
    expect(isChecked('DPS')).toBe(false)
    expect(screen.getByTestId('stoped-status-DPS').textContent).toBe('statusStopped')
  })

  it('toggling ON dispatches setService with the desired state', async () => {
    mocks.setService.mockResolvedValue({ success: true, changed: ['DPS'], failed: [], rebootRequired: true })
    render(<StopedPage />)
    fireEvent.click(toggleOf('DPS'))
    await waitFor(() => expect(mocks.setService).toHaveBeenCalledWith('DPS', true))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('toggleSuccess'))
  })

  it('toggling OFF dispatches setService with false', async () => {
    mocks.setService.mockResolvedValue({ success: true, changed: ['PcaSvc'], failed: [], rebootRequired: true })
    render(<StopedPage />)
    fireEvent.click(toggleOf('PcaSvc'))
    await waitFor(() => expect(mocks.setService).toHaveBeenCalledWith('PcaSvc', false))
  })

  it('toasts an error when a toggle change fails', async () => {
    mocks.setService.mockResolvedValue({
      success: false,
      error: 'Access is denied',
      changed: [],
      failed: [],
      rebootRequired: false,
    })
    render(<StopedPage />)
    fireEvent.click(toggleOf('DPS'))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('Access is denied'))
  })

  it('disables toggles for services missing from this Windows install', () => {
    render(<StopedPage />)
    expect(toggleOf('UmRdpService').disabled).toBe(true)
  })

  it('does not dispatch a change when clicking a missing service toggle', () => {
    render(<StopedPage />)
    fireEvent.click(toggleOf('UmRdpService'))
    expect(mocks.setService).not.toHaveBeenCalled()
  })

  it('marks missing services with a badge', () => {
    render(<StopedPage />)
    expect(screen.getByText('missing')).not.toBeNull()
  })

  it('renders the STOPAR and DESESTOPAR bulk buttons', () => {
    render(<StopedPage />)
    expect(screen.getByText('stopAll')).not.toBeNull()
    expect(screen.getByText('startAll')).not.toBeNull()
  })

  it('STOPAR disables every service at once', async () => {
    mocks.setAll.mockResolvedValue({ success: true, changed: ['PcaSvc'], failed: [], rebootRequired: true })
    render(<StopedPage />)
    fireEvent.click(screen.getByText('stopAll'))
    await waitFor(() => expect(mocks.setAll).toHaveBeenCalledWith(false))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('stopAllSuccess'))
  })

  it('DESESTOPAR enables every service at once', async () => {
    mocks.setAll.mockResolvedValue({ success: true, changed: ['PcaSvc'], failed: [], rebootRequired: true })
    render(<StopedPage />)
    fireEvent.click(screen.getByText('startAll'))
    await waitFor(() => expect(mocks.setAll).toHaveBeenCalledWith(true))
    await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith('startAllSuccess'))
  })

  it('toasts an error when a bulk change fails', async () => {
    mocks.setAll.mockResolvedValue({ success: false, error: 'boom', changed: [], failed: [], rebootRequired: false })
    render(<StopedPage />)
    fireEvent.click(screen.getByText('startAll'))
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith('boom'))
  })

  it('shows the restart-required notice after a change', () => {
    state.lastResult = { success: true, changed: ['DPS', 'PcaSvc'], failed: [], rebootRequired: true }
    render(<StopedPage />)
    expect(screen.getByText('restartRequiredTitle')).not.toBeNull()
    expect(screen.getByText('restartRequiredBody')).not.toBeNull()
    expect(screen.getByText(/DPS, PcaSvc/)).not.toBeNull()
  })

  it('lists per-service failures in the restart notice', () => {
    state.lastResult = {
      success: true,
      changed: ['PcaSvc'],
      failed: [{ id: 'DPS', error: 'Access is denied' }],
      rebootRequired: true,
    }
    render(<StopedPage />)
    expect(screen.getByText(/DPS: Access is denied/)).not.toBeNull()
  })

  it('hides the restart notice when there is no result', () => {
    render(<StopedPage />)
    expect(screen.queryByText('restartRequiredTitle')).toBeNull()
  })

  it('shows an error banner when loading fails', () => {
    state.error = 'ipc down'
    render(<StopedPage />)
    expect(screen.getByText(/ipc down/)).not.toBeNull()
  })

  it('disables every toggle while a change is in flight', () => {
    state.changing = true
    render(<StopedPage />)
    for (const id of ALL_IDS) {
      expect(toggleOf(id).disabled, id).toBe(true)
    }
  })

  it('disables every toggle while loading', () => {
    state.loading = true
    render(<StopedPage />)
    for (const id of ALL_IDS) {
      expect(toggleOf(id).disabled, id).toBe(true)
    }
  })

  it('shows the running/stopped counters', () => {
    render(<StopedPage />)
    expect(screen.getByText(/runningCount/)).not.toBeNull()
    expect(screen.getByText(/stoppedCount/)).not.toBeNull()
  })

  it('re-triggers a status refresh via the refresh button', () => {
    render(<StopedPage />)
    mocks.load.mockClear()
    fireEvent.click(screen.getByTestId('stoped-refresh'))
    expect(mocks.load).toHaveBeenCalledTimes(1)
  })

  it('shows a loading indicator before any status is known', () => {
    state.services = []
    state.loading = true
    render(<StopedPage />)
    expect(screen.getByText('loading')).not.toBeNull()
  })

  it('shows an empty-state message when no services come back', () => {
    state.services = []
    state.loading = false
    render(<StopedPage />)
    expect(screen.getByText('noServices')).not.toBeNull()
  })
})
