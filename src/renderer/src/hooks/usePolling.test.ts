// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { usePolling } from './usePolling'

describe('usePolling', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('fetches data on mount', async () => {
    const fetcher = vi.fn().mockResolvedValue('hello')
    const { result } = renderHook(() => usePolling(fetcher, 1000))

    await vi.waitFor(() => {
      expect(result.current.data).toBe('hello')
    })
    expect(result.current.error).toBe(false)
    expect(result.current.loading).toBe(false)
  })

  it('sets error when fetcher rejects', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('fail'))
    const { result } = renderHook(() => usePolling(fetcher, 1000))

    await vi.waitFor(() => {
      expect(result.current.error).toBe(true)
    })
    expect(result.current.loading).toBe(false)
  })

  it('polls at the given interval', async () => {
    const fetcher = vi.fn().mockResolvedValue('data')
    renderHook(() => usePolling(fetcher, 1000))

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(fetcher).toHaveBeenCalledTimes(2)

    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('pauses polling when page is hidden', async () => {
    const fetcher = vi.fn().mockResolvedValue('data')
    renderHook(() => usePolling(fetcher, 1000))

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', writable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(fetcher).toHaveBeenCalledTimes(1)

    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true })
    document.dispatchEvent(new Event('visibilitychange'))

    await act(() => vi.advanceTimersByTimeAsync(1000))
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('refresh forces a new fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue('data')
    const { result } = renderHook(() => usePolling(fetcher, 10000))

    await vi.waitFor(() => {
      expect(result.current.data).toBe('data')
    })
    expect(fetcher).toHaveBeenCalledTimes(1)

    await act(() => result.current.refresh())
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('cleans up interval on unmount', async () => {
    const fetcher = vi.fn().mockResolvedValue('data')
    const { unmount } = renderHook(() => usePolling(fetcher, 1000))

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    unmount()

    await act(() => vi.advanceTimersByTimeAsync(5000))
    expect(fetcher).toHaveBeenCalledTimes(1)
  })

  it('skips .then update when unmounted before fetch resolves', async () => {
    let deferredResolve!: (v: string) => void
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          deferredResolve = resolve
        }),
    )
    const { result, unmount } = renderHook(() => usePolling(fetcher, 10000))

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    unmount()

    deferredResolve('data')

    await vi.waitFor(() => {
      expect(result.current.data).toBeUndefined()
    })
    expect(result.current.error).toBe(false)
    expect(result.current.loading).toBe(true)
  })

  it('skips .catch update when unmounted before fetch rejects', async () => {
    let deferredReject!: (e: Error) => void
    const fetcher = vi.fn(
      () =>
        new Promise<string>((_, reject) => {
          deferredReject = reject
        }),
    )
    const { result, unmount } = renderHook(() => usePolling(fetcher, 10000))

    await vi.waitFor(() => {
      expect(fetcher).toHaveBeenCalledTimes(1)
    })

    unmount()

    deferredReject(new Error('fail'))

    await vi.waitFor(() => {
      expect(result.current.error).toBe(false)
    })
    expect(result.current.data).toBeUndefined()
    expect(result.current.loading).toBe(true)
  })
})
