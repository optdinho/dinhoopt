// @vitest-environment jsdom

import type { ClipsConfig } from '@shared/types/clips'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GameSection } from './ClipsConfigGame'
import type { ClipsState } from './useClipsState'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('framer-motion', async () => (await import('../../../../test-motion-mock')).motionMock)

const baseConfig: ClipsConfig = {
  replayTimeSeconds: 150,
  micEnabled: true,
  audioLoopback: false,
  fps: 60,
  width: 1920,
  height: 1080,
  bitrateKbps: 50000,
  cq: 20,
  maxrateKbps: 40000,
  bufsizeKbps: 80000,
  bframes: 2,
  lookahead: 16,
  encoderPreset: 'p4',
  outputDirectory: 'C:\\clips',
  forceSoftware: false,
  hotkeys: [{ id: 'hk1', vk: 112, modifiers: [], action: 'saveClip', replayDurationSeconds: 60, enabled: true }],
  pushToTalk: 'off',
  pushToTalkKeys: [],
  gameDetection: true,
  gameAudioOnly: false,
  selectedAudioSessions: [],
  useExcludeMode: false,
  excludeProcessId: 0,
  autoCleanupEnabled: true,
  autoCleanupThresholdGB: 100,
  replayBufferMode: 'disk',
}

const status: ClipsState['status'] = {
  running: false,
  capturing: false,
  uptime: 0,
  fps: 60,
  replayTimeSeconds: 150,
  replayBufferBytes: 0,
}

const t = ((key: string) => key) as unknown as ClipsState['t']

function renderGame(overrides: { rebindingId?: string | null; setRebindingId?: ClipsState['setRebindingId'] } = {}) {
  return render(
    <GameSection
      config={baseConfig}
      status={status}
      rebindingId={overrides.rebindingId ?? null}
      setRebindingId={overrides.setRebindingId ?? vi.fn()}
      handleConfigUpdate={vi.fn()}
      addHotkey={vi.fn()}
      removeHotkey={vi.fn()}
      updateHotkey={vi.fn()}
      setProcesses={vi.fn()}
      setShowProcPicker={vi.fn()}
      t={t}
    />,
  )
}

describe('GameSection — action select options', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('offers only engine-supported actions (no pushToTalk)', () => {
    renderGame()

    // The hotkey list is collapsed by default — open it first.
    fireEvent.click(screen.getByRole('button', { name: 'hotkeys' }))

    const actionSelect = screen.getByDisplayValue('actionSaveClipLabel')
    const values = Array.from(actionSelect.querySelectorAll('option')).map((o) => o.getAttribute('value'))

    expect(values).toEqual(['saveClip', 'screenshot', 'toggleMic'])
  })
})

/**
 * Regressão: os chips de atalho eram `disabled` durante o rebind. O Chromium
 * suprime os eventos de mouse em controlos desativados, portanto o clique do
 * meio dado no próprio chip (o gesto natural) não produzia `mousedown` e o
 * atalho nunca era gravado. O chip tem de continuar a receber eventos.
 */
describe('GameSection — hotkey chip during rebind', () => {
  it('starts the rebind when the chip is clicked', () => {
    const setRebindingId = vi.fn()
    renderGame({ setRebindingId })

    fireEvent.click(screen.getByRole('button', { name: 'hotkeys' }))
    fireEvent.click(screen.getByRole('button', { name: 'F1' }))

    expect(setRebindingId).toHaveBeenCalledWith('hk1')
  })

  it('keeps the active chip enabled so mouse events still reach the window', () => {
    const setRebindingId = vi.fn()
    renderGame({ rebindingId: 'hk1', setRebindingId })

    fireEvent.click(screen.getByRole('button', { name: 'hotkeys' }))
    const chip = screen.getByRole('button', { name: '...' })

    expect((chip as HTMLButtonElement).disabled).toBe(false)
    expect(chip.getAttribute('aria-disabled')).toBe('true')
  })

  it('shows the rebind hint while listening', () => {
    renderGame({ rebindingId: 'hk1' })

    fireEvent.click(screen.getByRole('button', { name: 'hotkeys' }))

    expect(screen.getByText('rebindHint')).toBeTruthy()
  })

  it('does not restart the rebind when another chip is clicked mid-rebind', () => {
    const setRebindingId = vi.fn()
    renderGame({ rebindingId: 'hk1', setRebindingId })

    fireEvent.click(screen.getByRole('button', { name: 'hotkeys' }))
    fireEvent.click(screen.getByRole('button', { name: '...' }))

    expect(setRebindingId).not.toHaveBeenCalled()
  })
})
