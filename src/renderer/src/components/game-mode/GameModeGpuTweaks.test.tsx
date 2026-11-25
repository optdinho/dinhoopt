// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { GameModeGpuTweaks } from './GameModeGpuTweaks'

const { vbsGet, vbsSet, hagsGet, hagsSet } = vi.hoisted(() => ({
  vbsGet: vi.fn(),
  vbsSet: vi.fn(),
  hagsGet: vi.fn(),
  hagsSet: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('framer-motion', async () => (await import('../../../../test-motion-mock')).motionMock)

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))

beforeEach(() => {
  vi.clearAllMocks()
  vbsGet.mockResolvedValue({ enabled: false })
  vbsSet.mockResolvedValue({ success: true })
  hagsGet.mockResolvedValue({ enabled: false, state: 'unknown' })
  hagsSet.mockResolvedValue({ success: true })
  Object.defineProperty(window, 'dinho', {
    configurable: true,
    value: {
      gamingVbsGet: vbsGet,
      gamingVbsSet: vbsSet,
      gamingHagsGet: hagsGet,
      gamingHagsSet: hagsSet,
    },
  })
})

describe('GameModeGpuTweaks — HAGS unknown state', () => {
  it('does not show an absent registry value as enabled', async () => {
    render(<GameModeGpuTweaks />)
    await waitFor(() => expect(screen.getByText('hagsUnknownBadge')).toBeTruthy())
    expect(screen.getAllByRole('button')[1]?.style.background).toBe('var(--bg-active)')
  })

  it('still writes enable on the first click from unknown', async () => {
    render(<GameModeGpuTweaks />)
    await waitFor(() => expect(screen.getByText('hagsUnknownBadge')).toBeTruthy())

    fireEvent.click(screen.getAllByRole('button')[1] as HTMLElement)
    await waitFor(() => expect(hagsSet).toHaveBeenCalledWith(true))
  })

  it('hides the badge and shows the on state when the registry says 0x2', async () => {
    hagsGet.mockResolvedValue({ enabled: true, state: 'on' })
    render(<GameModeGpuTweaks />)

    await waitFor(() => expect(screen.getAllByRole('button')[1]?.style.background).toBe('rgb(139, 92, 246)'))
    expect(screen.queryByText('hagsUnknownBadge')).toBeNull()
  })
})
