// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
}))

import { toast } from 'sonner'
import { useIpcAction } from './useIpcAction'

describe('useIpcAction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('starts with loading false', () => {
    const { result } = renderHook(() => useIpcAction({ actionFn: vi.fn() }))

    expect(result.current.loading).toBe(false)
  })

  it('sets loading true during execution', async () => {
    const actionFn = vi.fn().mockResolvedValue('ok')

    const { result } = renderHook(() => useIpcAction({ actionFn }))

    let promise: Promise<unknown>
    act(() => {
      promise = result.current.execute()
    })

    expect(result.current.loading).toBe(true)

    await act(async () => {
      await promise!
    })
  })

  it('sets loading false after success', async () => {
    const actionFn = vi.fn().mockResolvedValue('ok')

    const { result } = renderHook(() => useIpcAction({ actionFn }))

    await act(async () => {
      await result.current.execute()
    })

    expect(result.current.loading).toBe(false)
  })

  it('calls onResult with the action result', async () => {
    const onResult = vi.fn()

    const { result } = renderHook(() => useIpcAction({ actionFn: vi.fn().mockResolvedValue('result-value'), onResult }))

    await act(async () => {
      await result.current.execute()
    })

    expect(onResult).toHaveBeenCalledWith('result-value')
  })

  it('calls onStart before execution', async () => {
    const onStart = vi.fn()
    const actionFn = vi.fn().mockResolvedValue('ok')

    const { result } = renderHook(() => useIpcAction({ actionFn, onStart }))

    await act(async () => {
      await result.current.execute()
    })

    expect(onStart).toHaveBeenCalledTimes(1)
  })

  it('shows success toast when onSuccessToast is set', async () => {
    const { result } = renderHook(() =>
      useIpcAction({
        actionFn: vi.fn().mockResolvedValue('ok'),
        onSuccessToast: 'Operation complete',
      }),
    )

    await act(async () => {
      await result.current.execute()
    })

    expect(toast.success).toHaveBeenCalledWith('Operation complete')
  })

  it('shows error toast when action fails with errorKey', async () => {
    const t = vi.fn((key: string) => key)
    const { result } = renderHook(() =>
      useIpcAction({
        actionFn: vi.fn().mockRejectedValue(new Error('fail')),
        errorKey: 'myError',
        t,
      }),
    )

    await act(async () => {
      await result.current.execute()
    })

    expect(t).toHaveBeenCalledWith('myError.actionFailedToast')
    expect(t).toHaveBeenCalledWith('myError.actionFailedDescription')
    expect(toast.error).toHaveBeenCalled()
  })

  it('calls onError when action fails', async () => {
    const onError = vi.fn()
    const err = new Error('custom error')

    const { result } = renderHook(() =>
      useIpcAction({
        actionFn: vi.fn().mockRejectedValue(err),
        onError,
      }),
    )

    await act(async () => {
      await result.current.execute()
    })

    expect(onError).toHaveBeenCalledWith(err)
  })

  it('uses external setLoading when provided', async () => {
    const setLoading = vi.fn()

    const { result } = renderHook(() =>
      useIpcAction({
        actionFn: vi.fn().mockResolvedValue('ok'),
        setLoading,
      }),
    )

    await act(async () => {
      await result.current.execute()
    })

    expect(setLoading).toHaveBeenCalledWith(true)
    expect(setLoading).toHaveBeenCalledWith(false)
    expect(result.current.loading).toBe(false)
  })

  it('returns undefined from execute on error', async () => {
    const { result } = renderHook(() =>
      useIpcAction({
        actionFn: vi.fn().mockRejectedValue(new Error('fail')),
      }),
    )

    let returned: unknown
    await act(async () => {
      returned = await result.current.execute()
    })

    expect(returned).toBeUndefined()
  })
})
