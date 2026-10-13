// @vitest-environment jsdom

import type { ClipsConfig } from '@shared/types/clips'
import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { QualitySection } from './ClipsConfigQuality'
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
  hotkeys: [],
  pushToTalk: 'off',
  pushToTalkKeys: [],
  gameDetection: false,
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

type Update = (partial: Partial<ClipsConfig>) => Promise<void>

function renderQuality(config: ClipsConfig, onChange?: Update) {
  return render(
    <QualitySection
      config={config}
      status={status}
      activeTip={null}
      setActiveTip={() => {}}
      gpuList={[]}
      estimatedRamMB={0}
      handleConfigUpdate={(partial) => (onChange ? onChange(partial) : Promise.resolve())}
      t={t}
    />,
  )
}

function Harness({ initial }: { initial: ClipsConfig }) {
  const [config, setConfig] = useState(initial)
  const handleConfigUpdate = (partial: Partial<ClipsConfig>) => {
    setConfig((prev) => ({ ...prev, ...partial }))
    return Promise.resolve()
  }
  return (
    <QualitySection
      config={config}
      status={status}
      activeTip={null}
      setActiveTip={() => {}}
      gpuList={[]}
      estimatedRamMB={0}
      handleConfigUpdate={handleConfigUpdate}
      t={t}
    />
  )
}

const slider = () => screen.queryByTestId('replay-time-slider')

describe('QualitySection — custom replay slider', () => {
  it('keeps the slider mounted when dragged onto a preset value and allows decreasing', () => {
    render(<Harness initial={{ ...baseConfig, replayTimeSeconds: 150 }} />)
    expect(slider()).not.toBeNull()

    fireEvent.change(slider()!, { target: { value: '120' } })
    expect(slider()).not.toBeNull()
    expect((slider() as HTMLInputElement).value).toBe('120')

    fireEvent.change(slider()!, { target: { value: '60' } })
    expect(slider()).not.toBeNull()
    expect((slider() as HTMLInputElement).value).toBe('60')

    fireEvent.change(slider()!, { target: { value: '300' } })
    expect(slider()).not.toBeNull()
  })

  it('does not persist on every drag tick — commits only once on pointer release', () => {
    const onUpdate = vi.fn()
    renderQuality({ ...baseConfig, replayTimeSeconds: 150 }, onUpdate)
    const el = slider()!

    fireEvent.change(el, { target: { value: '200' } })
    fireEvent.change(el, { target: { value: '300' } })
    fireEvent.change(el, { target: { value: '450' } })
    expect(onUpdate).not.toHaveBeenCalled()

    fireEvent.pointerUp(el)
    expect(onUpdate).toHaveBeenCalledTimes(1)
    expect(onUpdate).toHaveBeenCalledWith({ replayTimeSeconds: 450 })
  })

  it('commits once on keyboard release instead of per arrow key', () => {
    const onUpdate = vi.fn()
    renderQuality({ ...baseConfig, replayTimeSeconds: 150 }, onUpdate)
    const el = slider()!

    fireEvent.change(el, { target: { value: '155' } })
    fireEvent.keyUp(el, { key: 'ArrowRight' })
    fireEvent.change(el, { target: { value: '160' } })
    fireEvent.keyUp(el, { key: 'ArrowRight' })

    expect(onUpdate).toHaveBeenCalledTimes(2)
    expect(onUpdate).toHaveBeenLastCalledWith({ replayTimeSeconds: 160 })
  })
})

describe('QualitySection — RAM warning gating', () => {
  it('does not show the RAM warning in disk-only mode', () => {
    renderQuality({ ...baseConfig, replayTimeSeconds: 300, replayBufferMode: 'disk' })
    expect(screen.queryByText('replayRamWarning')).toBeNull()
  })

  it('shows the RAM warning in RAM mode above 5 minutes', () => {
    renderQuality({ ...baseConfig, replayTimeSeconds: 300, replayBufferMode: 'ram' })
    expect(screen.getByText('replayRamWarning')).toBeTruthy()
  })

  it('shows the RAM warning in hybrid mode above 5 minutes', () => {
    renderQuality({ ...baseConfig, replayTimeSeconds: 300, replayBufferMode: 'hybrid' })
    expect(screen.getByText('replayRamWarning')).toBeTruthy()
  })
})
