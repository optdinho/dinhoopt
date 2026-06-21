// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { toast } from 'sonner'
import { useIpcScan } from './useIpcScan'

describe('useIpcScan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with loading false', () => {
    const { result } = renderHook(() => useIpcScan({ scanFn: vi.fn(), onResult: vi.fn() }))

    expect(result.current.loading).toBe(false)
  })

  it('sets loading true during scan', async () => {
    const scanFn = vi.fn().mockResolvedValue([])
    const { result } = renderHook(() => useIpcScan({ scanFn, onResult: vi.fn() }))

    let promise: Promise<void>
    act(() => {
      promise = result.current.scan()
    })

    expect(result.current.loading).toBe(true)

    await act(async () => {
      await promise!
    })
  })

  it('sets loading false after success', async () => {
    const { result } = renderHook(() => useIpcScan({ scanFn: vi.fn().mockResolvedValue([]), onResult: vi.fn() }))

    await act(async () => {
      await result.current.scan()
    })

    expect(result.current.loading).toBe(false)
  })

  it('calls onResult with scan result', async () => {
    const onResult = vi.fn()
    const { result } = renderHook(() => useIpcScan({ scanFn: vi.fn().mockResolvedValue(['item']), onResult }))

    await act(async () => {
      await result.current.scan()
    })

    expect(onResult).toHaveBeenCalledWith(['item'])
  })

  it('calls resetState before scan', async () => {
    const resetState = vi.fn()
    const { result } = renderHook(() =>
      useIpcScan({
        scanFn: vi.fn().mockResolvedValue([]),
        onResult: vi.fn(),
        resetState,
      }),
    )

    await act(async () => {
      await result.current.scan()
    })

    expect(resetState).toHaveBeenCalledTimes(1)
  })

  it('shows success toast when onSuccessToast is set', async () => {
    const { result } = renderHook(() =>
      useIpcScan({
        scanFn: vi.fn().mockResolvedValue([]),
        onResult: vi.fn(),
        onSuccessToast: 'Scan complete',
      }),
    )

    await act(async () => {
      await result.current.scan()
    })

    expect(toast.success).toHaveBeenCalledWith('Scan complete')
  })

  it('shows error toast when scan fails with errorKey', async () => {
    const t = vi.fn((key: string) => key)
    const { result } = renderHook(() =>
      useIpcScan({
        scanFn: vi.fn().mockRejectedValue(new Error('fail')),
        onResult: vi.fn(),
        errorKey: 'scanError',
        t,
      }),
    )

    await act(async () => {
      await result.current.scan()
    })

    expect(t).toHaveBeenCalledWith('scanError.scanFailedToast')
    expect(t).toHaveBeenCalledWith('scanError.scanFailedDescription')
    expect(toast.error).toHaveBeenCalled()
  })

  it('calls onError when scan fails', async () => {
    const onError = vi.fn()
    const err = new Error('scan error')
    const { result } = renderHook(() =>
      useIpcScan({
        scanFn: vi.fn().mockRejectedValue(err),
        onResult: vi.fn(),
        onError,
      }),
    )

    await act(async () => {
      await result.current.scan()
    })

    expect(onError).toHaveBeenCalledWith(err)
  })

  it('uses external setLoading when provided', async () => {
    const setLoading = vi.fn()
    const { result } = renderHook(() =>
      useIpcScan({
        scanFn: vi.fn().mockResolvedValue([]),
        onResult: vi.fn(),
        setLoading,
      }),
    )

    await act(async () => {
      await result.current.scan()
    })

    expect(setLoading).toHaveBeenCalledWith(true)
    expect(setLoading).toHaveBeenCalledWith(false)
    expect(result.current.loading).toBe(false)
  })
})
