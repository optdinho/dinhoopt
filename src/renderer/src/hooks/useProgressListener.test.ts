// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useProgressListener } from './useProgressListener'

describe('useProgressListener', () => {
  it('calls subscribe on mount', () => {
    const handler = vi.fn()
    const subscribe = vi.fn(() => vi.fn())

    renderHook(() => useProgressListener(subscribe, handler))

    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledWith(handler)
  })

  it('calls cleanup function on unmount', () => {
    const cleanup = vi.fn()
    const subscribe = vi.fn(() => cleanup)

    const { unmount } = renderHook(() => useProgressListener(subscribe, vi.fn()))

    unmount()

    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it('re-subscribes when subscribe or handler changes', () => {
    const handler1 = vi.fn()
    const handler2 = vi.fn()
    const subscribe = vi.fn(() => vi.fn())

    const { rerender } = renderHook(({ sub, h }) => useProgressListener(sub, h), {
      initialProps: { sub: subscribe, h: handler1 },
    })

    expect(subscribe).toHaveBeenCalledTimes(1)

    rerender({ sub: subscribe, h: handler2 })

    expect(subscribe).toHaveBeenCalledTimes(2)
  })
})
