import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  attachMouseNavGuard,
  consumeUndo,
  pendingAfterInput,
  type RendererInputEvent,
  XNAV_WINDOW_MS,
} from './mouse-back-forward-guard'

/**
 * The guard is detect-and-undo: preventDefault on `input-event` cannot block the
 * navigation (Electron discards the return of Emit), so these tests cover the two
 * pure decisions (record a pending X press / decide whether to undo an in-page
 * navigation) and the wiring that applies them on a fake webContents.
 */

function createFakeWebContents() {
  const listeners = new Map<string, Array<(...args: unknown[]) => void>>()
  const on = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    listeners.set(event, [...(listeners.get(event) ?? []), listener])
  })
  const removeListener = vi.fn((event: string, listener: (...args: unknown[]) => void) => {
    listeners.set(
      event,
      (listeners.get(event) ?? []).filter((l) => l !== listener),
    )
  })
  const goBack = vi.fn()
  const goForward = vi.fn()
  const emit = (event: string, ...args: unknown[]): void => {
    for (const listener of [...(listeners.get(event) ?? [])]) listener(...args)
  }
  return {
    on,
    removeListener,
    goBack,
    goForward,
    navigationHistory: { goBack, goForward },
    emitInput: (event: unknown, input: RendererInputEvent) => emit('input-event', event, input),
    emitNavigate: (isMainFrame = true) => emit('did-navigate-in-page', {}, 'file:///app/index.html#step1', isMainFrame),
    listenerCount: (event: string) => (listeners.get(event) ?? []).length,
  }
}

describe('mouse-back-forward-guard: pendingAfterInput (pure)', () => {
  const t = 1_000

  it('records a pending back press on mouseDown with the runtime button string', () => {
    expect(pendingAfterInput(null, { type: 'mouseDown', button: 'back' }, t)).toEqual({
      button: 'back',
      at: t,
    })
  })

  it('records a pending forward press on mouseDown', () => {
    expect(pendingAfterInput(null, { type: 'mouseDown', button: 'forward' }, t)).toEqual({
      button: 'forward',
      at: t,
    })
  })

  it('also accepts the xbutton1/xbutton2 spellings (defensive: never observed, cheap to match)', () => {
    expect(pendingAfterInput(null, { type: 'mouseDown', button: 'xbutton1' }, t)).toEqual({
      button: 'back',
      at: t,
    })
    expect(pendingAfterInput(null, { type: 'mouseDown', button: 'xbutton2' }, t)).toEqual({
      button: 'forward',
      at: t,
    })
  })

  it.each([{ button: 'left' }, { button: 'middle' }, { button: 'right' }, {}])(
    'does not record a pending for a non-X input ($button)',
    (input: Omit<RendererInputEvent, 'type'>) => {
      expect(pendingAfterInput(null, { type: 'mouseDown', ...input }, t)).toBeNull()
    },
  )

  it('does not record on mouseUp: the pending is armed on the down only', () => {
    expect(pendingAfterInput(null, { type: 'mouseUp', button: 'back' }, t)).toBeNull()
  })

  it('refreshes the timestamp of an existing pending on a repeated X mouseDown', () => {
    const previous = { button: 'back' as const, at: t }
    expect(pendingAfterInput(previous, { type: 'mouseDown', button: 'back' }, t + 50)).toEqual({
      button: 'back',
      at: t + 50,
    })
  })

  it('keeps an existing pending on unrelated input (navigation lands after mouseUp)', () => {
    const previous = { button: 'back' as const, at: t }
    expect(pendingAfterInput(previous, { type: 'keyDown' }, t + 10)).toBe(previous)
    expect(pendingAfterInput(previous, { type: 'mouseUp', button: 'back' }, t + 20)).toBe(previous)
  })
})

describe('mouse-back-forward-guard: consumeUndo (pure)', () => {
  const at = 1_000
  const freshBack = { button: 'back' as const, at }
  const freshForward = { button: 'forward' as const, at }

  it('fresh back press → undo action goForward (XButton1 navigated back, so go forward again)', () => {
    expect(consumeUndo(freshBack, at + 10, true)).toBe('goForward')
  })

  it('fresh forward press → undo action goBack (XButton2 navigated forward, so go back again)', () => {
    expect(consumeUndo(freshForward, at + 10, true)).toBe('goBack')
  })

  it('no pending press → no undo (legitimate navigation is left alone)', () => {
    expect(consumeUndo(null, at + 10, true)).toBeNull()
  })

  it('expired pending → no undo (a later legitimate navigation must not be undone)', () => {
    expect(consumeUndo(freshBack, at + XNAV_WINDOW_MS + 1, true)).toBeNull()
    expect(consumeUndo(freshForward, at + XNAV_WINDOW_MS + 1, true)).toBeNull()
  })

  it('pending exactly at the window edge still undoes (expiry is strictly beyond the window)', () => {
    expect(consumeUndo(freshBack, at + XNAV_WINDOW_MS, true)).toBe('goForward')
  })

  it('sub-frame navigation → no undo (the guard only owns main-frame hash navigation)', () => {
    expect(consumeUndo(freshBack, at + 10, false)).toBeNull()
  })
})

describe('mouse-back-forward-guard: attachMouseNavGuard (wiring)', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('fresh X press + did-navigate-in-page → undoes with the right direction (back press)', () => {
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    fake.emitInput({}, { type: 'mouseDown', button: 'back' })
    fake.emitNavigate(true)

    expect(fake.goForward).toHaveBeenCalledTimes(1)
    expect(fake.goBack).not.toHaveBeenCalled()
  })

  it('fresh X press + did-navigate-in-page → undoes with the right direction (forward press)', () => {
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    fake.emitInput({}, { type: 'mouseDown', button: 'forward' })
    fake.emitNavigate(true)

    expect(fake.goBack).toHaveBeenCalledTimes(1)
    expect(fake.goForward).not.toHaveBeenCalled()
  })

  it('expired pending → does not undo', () => {
    vi.useFakeTimers()
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    fake.emitInput({}, { type: 'mouseDown', button: 'back' })
    vi.advanceTimersByTime(XNAV_WINDOW_MS + 1)
    fake.emitNavigate(true)

    expect(fake.goForward).not.toHaveBeenCalled()
    expect(fake.goBack).not.toHaveBeenCalled()
  })

  it('no pending press → does not undo (programmatic/keyboard navigation is untouched)', () => {
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    fake.emitNavigate(true)

    expect(fake.goForward).not.toHaveBeenCalled()
    expect(fake.goBack).not.toHaveBeenCalled()
  })

  it('non-X input event → no pending is created → navigation is not undone', () => {
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    fake.emitInput({}, { type: 'mouseDown', button: 'left' })
    fake.emitNavigate(true)

    expect(fake.goForward).not.toHaveBeenCalled()
    expect(fake.goBack).not.toHaveBeenCalled()
  })

  it('never suppresses the input event: preventDefault is not called (it would be a no-op anyway)', () => {
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    const event = { preventDefault: vi.fn() }
    fake.emitInput(event, { type: 'mouseDown', button: 'back' })

    expect(event.preventDefault).not.toHaveBeenCalled()
    // the page still gets its mousedown/auxclick — nothing is swallowed on the way in
    expect(fake.listenerCount('input-event')).toBe(1)
  })

  it('sub-frame navigation is not undone, and the pending survives for the main frame', () => {
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    fake.emitInput({}, { type: 'mouseDown', button: 'back' })
    fake.emitNavigate(false)
    expect(fake.goForward).not.toHaveBeenCalled()

    fake.emitNavigate(true)
    expect(fake.goForward).toHaveBeenCalledTimes(1)
  })

  it('consumes the pending after undoing: our own goForward re-emits and must not loop', () => {
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    fake.emitInput({}, { type: 'mouseDown', button: 'back' })
    fake.emitNavigate(true)
    fake.emitNavigate(true) // the undo's own navigation, seen by the same listener

    expect(fake.goForward).toHaveBeenCalledTimes(1)
    expect(fake.goBack).not.toHaveBeenCalled()
  })

  it('drops an expired pending at consume time so a later navigation is not undone', () => {
    vi.useFakeTimers()
    const fake = createFakeWebContents()
    attachMouseNavGuard(fake)

    fake.emitInput({}, { type: 'mouseDown', button: 'back' })
    vi.advanceTimersByTime(XNAV_WINDOW_MS + 1)
    fake.emitNavigate(true) // expires + drops the pending
    vi.advanceTimersByTime(10)
    fake.emitNavigate(true) // legit navigation right after: still untouched

    expect(fake.goForward).not.toHaveBeenCalled()
    expect(fake.goBack).not.toHaveBeenCalled()
  })

  it('dispose removes both listeners and clears the pending', () => {
    const fake = createFakeWebContents()
    const dispose = attachMouseNavGuard(fake)

    fake.emitInput({}, { type: 'mouseDown', button: 'back' })
    dispose()

    expect(fake.listenerCount('input-event')).toBe(0)
    expect(fake.listenerCount('did-navigate-in-page')).toBe(0)

    fake.emitNavigate(true)
    expect(fake.goForward).not.toHaveBeenCalled()
    expect(fake.goBack).not.toHaveBeenCalled()
  })
})
