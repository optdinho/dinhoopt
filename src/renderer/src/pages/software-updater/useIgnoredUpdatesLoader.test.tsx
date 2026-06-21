// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockStore = {
  hasChecked: false,
  loading: false,
  loadIgnoredIds: vi.fn(),
  getState: vi.fn(),
}
mockStore.getState.mockReturnValue(mockStore)

vi.mock('@/stores/updater-store', () => ({
  useUpdaterStore: { getState: () => mockStore },
}))

import { useInitialLoader } from './useIgnoredUpdatesLoader'

describe('useInitialLoader', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStore.hasChecked = false
    mockStore.loading = false
  })

  it('loads ignored IDs from settings on mount', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: ['id1', 'id2'] }),
    } as never

    const onAutoCheck = vi.fn()
    renderHook(() => useInitialLoader(onAutoCheck))

    await vi.waitFor(() => {
      expect(window.dinho.settingsGet).toHaveBeenCalledTimes(1)
    })

    expect(mockStore.loadIgnoredIds).toHaveBeenCalledWith(['id1', 'id2'])
  })

  it('calls onAutoCheck when no ignored IDs and not yet checked', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: [] }),
    } as never

    const onAutoCheck = vi.fn()
    renderHook(() => useInitialLoader(onAutoCheck))

    await vi.waitFor(() => {
      expect(onAutoCheck).toHaveBeenCalledTimes(1)
    })
  })

  it('does not call onAutoCheck if already checked', async () => {
    mockStore.hasChecked = true

    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: [] }),
    } as never

    const onAutoCheck = vi.fn()
    renderHook(() => useInitialLoader(onAutoCheck))

    await vi.waitFor(() => {
      expect(window.dinho.settingsGet).toHaveBeenCalledTimes(1)
    })

    expect(onAutoCheck).not.toHaveBeenCalled()
  })

  it('does not call onAutoCheck if currently loading', async () => {
    mockStore.loading = true

    window.dinho = {
      settingsGet: vi.fn().mockResolvedValue({ ignoredSoftwareUpdates: [] }),
    } as never

    const onAutoCheck = vi.fn()
    renderHook(() => useInitialLoader(onAutoCheck))

    await vi.waitFor(() => {
      expect(window.dinho.settingsGet).toHaveBeenCalledTimes(1)
    })

    expect(onAutoCheck).not.toHaveBeenCalled()
  })

  it('handles settingsGet error gracefully', async () => {
    window.dinho = {
      settingsGet: vi.fn().mockRejectedValue(new Error('fail')),
    } as never

    const onAutoCheck = vi.fn()
    expect(() => {
      renderHook(() => useInitialLoader(onAutoCheck))
    }).not.toThrow()

    await vi.waitFor(() => {
      expect(window.dinho.settingsGet).toHaveBeenCalledTimes(1)
    })

    expect(onAutoCheck).not.toHaveBeenCalled()
  })
})
