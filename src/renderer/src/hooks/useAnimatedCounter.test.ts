// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAnimatedCounter } from './useAnimatedCounter'

describe('useAnimatedCounter', () => {
  let rafCallbacks: Array<FrameRequestCallback>

  beforeEach(() => {
    rafCallbacks = []
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      rafCallbacks.push(cb)
      return rafCallbacks.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(vi.fn())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts at 0', () => {
    const { result } = renderHook(() => useAnimatedCounter(100))
    expect(result.current).toBe(0)
  })

  it('animates toward target value', () => {
    const { result } = renderHook(() => useAnimatedCounter(100, 800))

    // First frame: sets startTime, elapsed = 0, value stays 0
    act(() => {
      rafCallbacks[0]?.(100)
    })

    // Second frame: elapsed = 900 - 100 = 800 → progress = 1 → value = 100
    act(() => {
      rafCallbacks[1]?.(900)
    })

    expect(result.current).toBe(100)
  })

  it('interpolates mid-animation', () => {
    const { result } = renderHook(() => useAnimatedCounter(100, 800))

    // First frame: sets startTime = 100
    act(() => {
      rafCallbacks[0]?.(100)
    })

    // Second frame: elapsed = 500 - 100 = 400 → progress = 0.5 → value ≈ 87.5
    act(() => {
      rafCallbacks[1]?.(500)
    })

    expect(result.current).toBeGreaterThan(0)
    expect(result.current).toBeLessThan(100)
  })

  it('cancels animation frame on unmount', () => {
    const { unmount } = renderHook(() => useAnimatedCounter(100))

    unmount()

    expect(window.cancelAnimationFrame).toHaveBeenCalled()
  })
})
