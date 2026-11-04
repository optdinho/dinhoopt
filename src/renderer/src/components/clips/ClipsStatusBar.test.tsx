// @vitest-environment jsdom

import type { ClipsEngineStatus } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ClipsStatusBar } from './ClipsStatusBar'
import type { ClipsState } from './useClipsState'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('framer-motion', async () => (await import('../../../../test-motion-mock')).motionMock)

const t = ((key: string) => key) as unknown as ClipsState['t']

const baseStatus: ClipsEngineStatus = {
  running: true,
  capturing: false,
  uptime: 0,
  fps: 60,
  replayTimeSeconds: 120,
}

function renderBar(overrides: Partial<ClipsState> = {}) {
  const props = {
    status: baseStatus,
    statusLoaded: true,
    starting: false,
    stopping: false,
    loading: false,
    estimatedRamMB: 0,
    handleStartRecording: vi.fn(),
    handleStopRecording: vi.fn(),
    handleSaveClip: vi.fn(),
    t,
    ...overrides,
  } as unknown as ClipsState
  return render(<ClipsStatusBar {...props} />)
}

describe('ClipsStatusBar — loading and engine state', () => {
  it('shows skeletons until the status has loaded', () => {
    const { container } = renderBar({ statusLoaded: false })
    expect(screen.queryByText('recordingStatus')).toBeNull()
    expect(container.querySelectorAll('.animate-shimmer').length).toBeGreaterThan(0)
  })

  it('reports a stopped engine and offers to start recording', () => {
    const handleStartRecording = vi.fn()
    renderBar({ status: { ...baseStatus, running: false }, handleStartRecording })

    expect(screen.getByText('stopped')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'startRecording' }))
    expect(handleStartRecording).toHaveBeenCalledTimes(1)
  })

  it('reports an idle running engine without the capture-target chip', () => {
    renderBar({ status: { ...baseStatus, running: true, capturing: false, captureMode: 'desktop' } })
    expect(screen.getByText('idle')).toBeTruthy()
    expect(screen.queryByText('captureModeDesktop')).toBeNull()
  })

  it('reports recording and offers stop + save', () => {
    const handleStopRecording = vi.fn()
    const handleSaveClip = vi.fn()
    renderBar({
      status: { ...baseStatus, capturing: true, uptime: 65 },
      handleStopRecording,
      handleSaveClip,
    })

    expect(screen.getByText('recording')).toBeTruthy()
    expect(screen.getByText('1minutes 5seconds')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'stopRecording' }))
    fireEvent.click(screen.getByRole('button', { name: 'saveClip' }))
    expect(handleStopRecording).toHaveBeenCalledTimes(1)
    expect(handleSaveClip).toHaveBeenCalledTimes(1)
  })

  it('hides the timer while the engine is stopped or uptime is zero', () => {
    renderBar({ status: { ...baseStatus, running: true, uptime: 0 } })
    expect(screen.queryByText('0seconds')).toBeNull()
  })

  it('shows a disabled "stopping" button while the engine shuts down', () => {
    renderBar({ status: { ...baseStatus, capturing: true }, stopping: true })
    const button = screen.getByRole('button', { name: 'stoppingRecording' })
    expect(button).toHaveProperty('disabled', true)
  })

  it('shows the starting state on the start button', () => {
    renderBar({ status: { ...baseStatus, running: false }, starting: true })
    expect(screen.getByText('startingRecording')).toBeTruthy()
  })
})

describe('ClipsStatusBar — telemetry chips', () => {
  it('renders fps, replay time, backend/encoder and game while running', () => {
    renderBar({
      status: {
        ...baseStatus,
        capturing: true,
        captureBackend: 'WGC',
        encoder: 'av1_nvenc',
        currentGame: 'FiveM',
      },
    })

    expect(screen.getByText('fps: 60')).toBeTruthy()
    expect(screen.getByText('replayTime: 2min')).toBeTruthy()
    expect(screen.getByText('WGC')).toBeTruthy()
    expect(screen.getByText('av1_nvenc')).toBeTruthy()
    expect(screen.getByText('FiveM')).toBeTruthy()
  })

  it('labels desktop and window capture targets', () => {
    renderBar({ status: { ...baseStatus, capturing: true, captureMode: 'desktop' } })
    expect(screen.getByText('captureModeDesktop')).toBeTruthy()
  })

  it('falls back to the estimated RAM when the buffer size is unknown', () => {
    renderBar({ estimatedRamMB: 512 })
    expect(screen.getByText('~512megabytes')).toBeTruthy()
  })

  it('prefers the real buffer size over the estimate', () => {
    renderBar({
      estimatedRamMB: 512,
      status: { ...baseStatus, replayBufferBytes: 1024 * 1024 * 700 },
    })
    expect(screen.getByText('700megabytes')).toBeTruthy()
    expect(screen.queryByText('~512megabytes')).toBeNull()
  })

  it('shows engine memory and the microphone meter when available', () => {
    renderBar({ status: { ...baseStatus, memoryMB: 480, micLevel: 0.8 } })
    expect(screen.getByText('memoryMB: 480 megabytes')).toBeTruthy()
    expect(screen.getByTitle('micLevel')).toBeTruthy()
  })
})

describe('ClipsStatusBar — alerts', () => {
  it('surfaces crash recovery, audio fallback, low disk and watchdog failures', () => {
    renderBar({
      status: {
        ...baseStatus,
        lastCrashRecovered: true,
        audioFallback: true,
        diskSpaceOk: false,
        watchdogOk: false,
      },
    })

    expect(screen.getByText('crashRecovered')).toBeTruthy()
    expect(screen.getByText('audioFallbackWarning')).toBeTruthy()
    expect(screen.getByText('lowDisk')).toBeTruthy()
    expect(screen.getByText('watchdogFailed')).toBeTruthy()
  })

  it('hides the watchdog alert when the engine is not running', () => {
    renderBar({ status: { ...baseStatus, running: false, watchdogOk: false } })
    expect(screen.queryByText('watchdogFailed')).toBeNull()
  })

  it('shows no alerts when everything is healthy', () => {
    renderBar({ status: { ...baseStatus, diskSpaceOk: true, watchdogOk: true } })
    expect(screen.queryByText('crashRecovered')).toBeNull()
    expect(screen.queryByText('lowDisk')).toBeNull()
  })
})
