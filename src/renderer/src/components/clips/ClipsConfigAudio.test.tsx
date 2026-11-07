// @vitest-environment jsdom

import type { ClipsConfig } from '@shared/types/clips'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioSection } from './ClipsConfigAudio'
import type { ClipsState } from './useClipsState'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('framer-motion', async () => (await import('../../../../test-motion-mock')).motionMock)

const config: ClipsConfig = {
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
  hotkeys: [],
  pushToTalk: 'hold',
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

function renderAudio(overrides: { rebindingId?: string | null; setRebindingId?: ClipsState['setRebindingId'] } = {}) {
  return render(
    <AudioSection
      config={config}
      status={status}
      activeTip={null}
      setActiveTip={vi.fn()}
      rebindingId={overrides.rebindingId ?? null}
      setRebindingId={overrides.setRebindingId ?? vi.fn()}
      micDevices={[]}
      loadingMicDevices={false}
      handleConfigUpdate={vi.fn()}
      t={t}
    />,
  )
}

/**
 * Mesma regressão dos chips de atalho: um chip `disabled` faz o Chromium
 * suprimir o `mousedown`, pelo que o clique do meio nunca seria capturado.
 */
describe('AudioSection — push-to-talk chip during rebind', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Promessa que nunca resolve: o efeito de sessões não faz setState a meio
    // do teste (evita updates fora de act e mantém o clique síncrono).
    window.dinho = { clipsGetAudioSessions: vi.fn(() => new Promise(() => {})) } as never
  })

  it('keeps the chip enabled and listens for the middle button', () => {
    const setRebindingId = vi.fn()
    renderAudio({ rebindingId: 'hk-ptt', setRebindingId })

    fireEvent.click(screen.getByRole('button', { name: /pushToTalk/ }))
    const chip = screen.getByRole('button', { name: '...' })

    expect((chip as HTMLButtonElement).disabled).toBe(false)
    expect(chip.getAttribute('aria-disabled')).toBe('true')
    expect(screen.getByText('rebindHint')).toBeTruthy()

    fireEvent.click(chip)
    expect(setRebindingId).not.toHaveBeenCalled()
  })

  it('starts the rebind when the chip is clicked', () => {
    const setRebindingId = vi.fn()
    renderAudio({ setRebindingId })

    fireEvent.click(screen.getByRole('button', { name: /pushToTalk/ }))
    fireEvent.click(screen.getByRole('button', { name: '+ pttKey' }))

    expect(setRebindingId).toHaveBeenCalledWith('hk-ptt')
  })
})
