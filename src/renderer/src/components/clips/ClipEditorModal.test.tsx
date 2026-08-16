// @vitest-environment jsdom

import type { ClipInfo, ClipTrimResult } from '@shared/types'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ClipEditorModal } from './ClipEditorModal'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  const icons = ['Combine', 'Maximize', 'Minimize', 'Pause', 'Play', 'Scissors', 'X']
  const iconMap: Record<string, any> = {}
  for (const name of icons) iconMap[name] = Icon
  return iconMap
})

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const mockGetEnhanceSupport = vi.fn()
const mockGetVideoUrl = vi.fn()
const mockTrim = vi.fn()

const makeDinho = () =>
  ({
    clipsGetEnhanceSupport: mockGetEnhanceSupport,
    clipsGetVideoUrl: mockGetVideoUrl,
    clipsTrimClip: mockTrim,
  }) as never

const clip: ClipInfo = {
  name: 'a.mp4',
  path: 'C:\\Clips\\a.mp4',
  size: 1234,
  createdAt: '2026-01-01T00:00:00.000Z',
  duration: 60,
}

describe('ClipEditorModal', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    window.dinho = makeDinho()
    mockGetEnhanceSupport.mockResolvedValue({ amd: false })
    mockGetVideoUrl.mockReturnValue('file:///clip.mp4')
    mockTrim.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
    delete (document as any).fullscreenElement
  })

  const renderModal = (overrides: { onClose?: () => void; onSave?: () => void } = {}) => {
    const onClose = overrides.onClose ?? vi.fn()
    const onSave = overrides.onSave ?? vi.fn()
    const utils = render(<ClipEditorModal clip={clip} onClose={onClose} onSave={onSave} />)
    return { onClose, onSave, ...utils }
  }

  it('clears the overlay timer when unmounted while fullscreen', async () => {
    Object.defineProperty(document, 'fullscreenElement', {
      get: () => document.body,
      configurable: true,
    })

    const { unmount } = renderModal()

    await act(async () => {
      document.dispatchEvent(new Event('fullscreenchange'))
    })

    const dialog = screen.getByRole('dialog')
    await act(async () => {
      fireEvent.mouseMove(dialog)
    })

    const timersBeforeUnmount = vi.getTimerCount()

    unmount()
    expect(vi.getTimerCount()).toBe(timersBeforeUnmount - 1)
  })

  it('does not call onSave when clipsTrimClip resolves after unmount', async () => {
    let resolveTrim!: (r: ClipTrimResult) => void
    mockTrim.mockReturnValue(new Promise<ClipTrimResult>((res) => (resolveTrim = res)))

    const { onSave, unmount } = renderModal()

    const trimButton = screen.getByRole('button', { name: /applyTrim/ })
    fireEvent.click(trimButton)

    await act(async () => {})

    unmount()

    await act(async () => {
      resolveTrim({ success: true })
      await Promise.resolve()
    })

    expect(onSave).not.toHaveBeenCalled()
  })
})
