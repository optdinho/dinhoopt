// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockSetProgress = vi.fn()
const mockStore = {
  setProgress: mockSetProgress,
  getState: vi.fn(() => ({ setProgress: mockSetProgress })),
}

vi.mock('@/stores/updater-store', () => ({
  useUpdaterStore: { getState: () => mockStore },
}))

import { useUpdaterProgress } from './useUpdaterProgress'

describe('useUpdaterProgress', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('subscribes to onSoftwareUpdateProgress on mount', () => {
    window.dinho = {
      onSoftwareUpdateProgress: vi.fn(() => vi.fn()),
    } as never

    renderHook(() => useUpdaterProgress())

    expect(window.dinho.onSoftwareUpdateProgress).toHaveBeenCalledTimes(1)
  })

  it('calls setProgress when progress data arrives', () => {
    let handler: (data: unknown) => void
    window.dinho = {
      onSoftwareUpdateProgress: vi.fn((cb: (data: unknown) => void) => {
        handler = cb
        return vi.fn()
      }),
    } as never

    renderHook(() => useUpdaterProgress())

    handler!({ percent: 50, current: 'Downloading...' })

    expect(mockSetProgress).toHaveBeenCalledWith({ percent: 50, current: 'Downloading...' })
  })

  it('calls cleanup on unmount', () => {
    const cleanup = vi.fn()
    window.dinho = {
      onSoftwareUpdateProgress: vi.fn(() => cleanup),
    } as never

    const { unmount } = renderHook(() => useUpdaterProgress())

    unmount()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })
})
