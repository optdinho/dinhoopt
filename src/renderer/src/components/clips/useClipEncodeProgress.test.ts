// @vitest-environment jsdom

import type { ClipEncodeProgressEvent } from '@shared/types'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useClipEncodeProgress } from './useClipEncodeProgress'

const listeners: {
  trim: ((e: ClipEncodeProgressEvent) => void) | undefined
  merge: ((e: ClipEncodeProgressEvent) => void) | undefined
} = { trim: undefined, merge: undefined }

const mockTrimCancel = vi.fn()
const mockMergeCancel = vi.fn()

function event(over: Partial<ClipEncodeProgressEvent> = {}): ClipEncodeProgressEvent {
  return {
    jobKey: 'C:\\clips\\a.mp4',
    percent: 0,
    outTimeSeconds: 0,
    totalSeconds: 20,
    etaSeconds: null,
    speed: null,
    done: false,
    ...over,
  }
}

describe('useClipEncodeProgress', () => {
  beforeEach(() => {
    listeners.trim = undefined
    listeners.merge = undefined
    mockTrimCancel.mockReset().mockResolvedValue({ success: true })
    mockMergeCancel.mockReset().mockResolvedValue({ success: true })
    window.dinho = {
      clipsOnTrimProgress: (cb: (e: ClipEncodeProgressEvent) => void) => {
        listeners.trim = cb
        return () => {
          listeners.trim = undefined
        }
      },
      clipsOnMergeProgress: (cb: (e: ClipEncodeProgressEvent) => void) => {
        listeners.merge = cb
        return () => {
          listeners.merge = undefined
        }
      },
      clipsTrimCancel: mockTrimCancel,
      clipsMergeCancel: mockMergeCancel,
    } as never
  })

  it('starts idle and reports indeterminate progress while running', () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    expect(result.current.running).toBe(false)
    expect(result.current.percent).toBe(0)

    act(() => result.current.start({ kind: 'trim', clipPath: 'C:\\clips\\a.mp4' }))

    expect(result.current.running).toBe(true)
    expect(result.current.indeterminate).toBe(true)
    expect(result.current.percent).toBe(0)
  })

  it('tracks percent, eta and speed from trim events', () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    act(() => result.current.start({ kind: 'trim', clipPath: 'C:\\clips\\a.mp4' }))

    act(() => listeners.trim?.(event({ percent: 42.5, etaSeconds: 11.5, speed: 1.74 })))

    expect(result.current.percent).toBe(42.5)
    expect(result.current.etaSeconds).toBe(11.5)
    expect(result.current.speed).toBe(1.74)
    expect(result.current.indeterminate).toBe(false)
  })

  it('marks the bar indeterminate when the total duration is unknown', () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    act(() => result.current.start({ kind: 'merge', clipPaths: ['a.mp4', 'b.mp4'] }))

    act(() => listeners.merge?.(event({ jobKey: 'a.mp4|b.mp4', totalSeconds: 0, percent: 0 })))

    expect(result.current.indeterminate).toBe(true)
  })

  it('ignores events while no job is running', () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    act(() => listeners.trim?.(event({ percent: 90 })))
    expect(result.current.running).toBe(false)
    expect(result.current.percent).toBe(0)
  })

  it('ignores merge events while a trim is running and vice versa', () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    act(() => result.current.start({ kind: 'trim', clipPath: 'C:\\clips\\a.mp4' }))
    act(() => listeners.merge?.(event({ jobKey: 'a.mp4|b.mp4', percent: 77 })))
    expect(result.current.percent).toBe(0)
  })

  it('adopts the first job key and drops events from any other job', () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    act(() => result.current.start({ kind: 'trim', clipPath: 'C:\\clips\\a.mp4' }))

    act(() => listeners.trim?.(event({ jobKey: 'C:\\clips\\a.mp4', percent: 10 })))
    expect(result.current.percent).toBe(10)

    act(() => listeners.trim?.(event({ jobKey: 'C:\\clips\\other.mp4', percent: 99 })))
    expect(result.current.percent).toBe(10)
  })

  it('resets the adopted key so a second job is tracked again', () => {
    const { result } = renderHook(() => useClipEncodeProgress())

    act(() => result.current.start({ kind: 'trim', clipPath: 'C:\\clips\\a.mp4' }))
    act(() => listeners.trim?.(event({ jobKey: 'C:\\clips\\a.mp4', percent: 80 })))
    act(() => result.current.stop())
    expect(result.current.running).toBe(false)

    act(() => result.current.start({ kind: 'trim', clipPath: 'C:\\clips\\b.mp4' }))
    expect(result.current.percent).toBe(0)
    act(() => listeners.trim?.(event({ jobKey: 'C:\\clips\\b.mp4', percent: 5 })))
    expect(result.current.percent).toBe(5)
  })

  it('cancels the trim with the path the job was started with', async () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    act(() => result.current.start({ kind: 'trim', clipPath: 'C:\\clips\\a.mp4' }))

    await act(async () => {
      await result.current.cancel()
    })

    expect(mockTrimCancel).toHaveBeenCalledWith('C:\\clips\\a.mp4')
    expect(mockMergeCancel).not.toHaveBeenCalled()
  })

  it('cancels the merge with the exact selection it was started with', async () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    act(() => result.current.start({ kind: 'merge', clipPaths: ['b.mp4', 'a.mp4'] }))

    await act(async () => {
      await result.current.cancel()
    })

    expect(mockMergeCancel).toHaveBeenCalledWith(['b.mp4', 'a.mp4'])
    expect(mockTrimCancel).not.toHaveBeenCalled()
  })

  it('returns undefined when cancelling without a running job', async () => {
    const { result } = renderHook(() => useClipEncodeProgress())
    await expect(result.current.cancel()).resolves.toBeUndefined()
    expect(mockTrimCancel).not.toHaveBeenCalled()
  })

  it('unsubscribes both listeners on unmount', () => {
    const { unmount } = renderHook(() => useClipEncodeProgress())
    expect(listeners.trim).toBeTypeOf('function')
    expect(listeners.merge).toBeTypeOf('function')

    unmount()

    expect(listeners.trim).toBeUndefined()
    expect(listeners.merge).toBeUndefined()
  })

  it('survives a bridge without the progress methods', () => {
    window.dinho = {} as never
    const { result, unmount } = renderHook(() => useClipEncodeProgress())
    act(() => result.current.start({ kind: 'trim', clipPath: 'C:\\clips\\a.mp4' }))
    expect(result.current.running).toBe(true)
    expect(() => unmount()).not.toThrow()
  })
})
