/**
 * Mouse4/Mouse5 (XButton1/XButton2) navigation guard — detect-and-undo.
 *
 * The renderer uses HashRouter; a stray XButton press navigates history, unmounting the
 * React app mid-operation (e.g. during a clip save).
 *
 * ⚠️ WHY NOT preventDefault: `event.preventDefault()` inside `webContents.on('input-event')`
 * is a **no-op** in Electron — the return value of `Emit("input-event")` is discarded
 * (electron_api_web_contents.cc:4600-4604). Proven by an A/B probe with REAL Win32
 * XBUTTON1 clicks (mouse_event, `%TEMP%\opencode\probe-xnav\`, 2026-10-20): the baseline
 * navigates (`#step2 → #step1`) and the guard navigates the same way. `before-mouse-event`
 * preventDefault doesn't help either: it suppresses the renderer's mousedown but the
 * navigation still happens. (The 2026-10-19 docstring claiming empirical verification was
 * wrong: `webContents.sendInputEvent({button:'xbutton1'})` reaches the handler as
 * `button:'left'`, so preventDefault was never even called by that "test".)
 *
 * WHAT THIS GUARD DOES INSTEAD:
 *  1. `input-event` — on `mouseDown` with an X button, record a pending press
 *     (`pendingAfterInput`). Nothing is suppressed: the page keeps receiving
 *     mousedown/auxclick button 3/4, which the clips hotkey rebind relies on.
 *  2. `did-navigate-in-page` — if a pending press exists and is fresh
 *     (`consumeUndo`, `XNAV_WINDOW_MS`), the navigation that just happened is assumed to
 *     be the XButton's and is undone: back press (XButton1) → `navigationHistory.goForward()`,
 *     forward press (XButton2) → `navigationHistory.goBack()`. The pending is consumed first
 *     so the undo's own navigation doesn't loop.
 *
 * LIMITATIONS (by design — undetectable from the main process):
 *  - Only in-page (hash) navigations on the main frame within `XNAV_WINDOW_MS` of the
 *    press are undone; full navigations and sub-frames are ignored.
 *  - If an X press produces NO navigation (e.g. no history to go back to) and a legitimate
 *    navigation (link, keyboard, router) happens inside the same window, that navigation is
 *    wrongly undone — a sub-second race that cannot be distinguished from the XButton's own
 *    navigation, because Electron's `input-event` carries no "will navigate" signal.
 *  - Synthetic `sendInputEvent({button:'xbutton1'})` reaches this handler as `button:'left'`
 *    (Electron's own mapping) and therefore exercises NOTHING — validate with real clicks only.
 *
 * Button strings: real clicks deliver `button: 'back' | 'forward'` on `input-event`
 * (observed in the probe); `xbutton1`/`xbutton2` are accepted defensively, never observed.
 *
 * Empirical validation: probe mode `mitigation` in `%TEMP%\opencode\probe-xnav\`
 * (real XBUTTON1 click must leave the hash put; programmatic `history.back()` must navigate).
 */

/** Payload of a mouse `input-event` as delivered at runtime (Electron's InputEvent typings omit `button`). */
export interface RendererInputEvent {
  type?: string
  button?: string
}

/** Which side button was pressed. */
export type XnavButton = 'back' | 'forward'

/** A not-yet-consumed XButton press awaiting the navigation it may cause. */
export interface PendingXnav {
  button: XnavButton
  at: number
}

/**
 * Max age of a pending press for its navigation to still be attributed to it.
 * The probe shows Chromium commits the hash navigation within a few ms of mouseUp,
 * so this is generous; it is also the guard's whole race window (see LIMITATIONS).
 */
export const XNAV_WINDOW_MS = 700

/** Undo action to run: `'goForward'` undoes a back (XButton1) press, `'goBack'` a forward one. */
export type UndoAction = 'goBack' | 'goForward'

const XNAV_BUTTONS: Readonly<Record<string, XnavButton>> = {
  back: 'back',
  forward: 'forward',
  xbutton1: 'back',
  xbutton2: 'forward',
}

function xnavButtonOf(button: string | undefined): XnavButton | null {
  if (button === undefined) return null
  return XNAV_BUTTONS[button] ?? null
}

/**
 * Pure: decide the pending state after an `input-event`.
 * Only `mouseDown` with an X button arms/refreshes the pending; every other input
 * (including the matching `mouseUp` — the navigation lands *after* mouseUp) keeps
 * the previous state untouched. No Electron, no clocks beyond the passed `now`.
 */
export function pendingAfterInput(
  previous: PendingXnav | null,
  input: RendererInputEvent,
  now: number,
): PendingXnav | null {
  if (input.type !== 'mouseDown') return previous
  const button = xnavButtonOf(input.button)
  if (button === null) return previous
  return { button, at: now }
}

/**
 * Pure: decide whether an in-page navigation just observed must be undone.
 *
 * Returns the history action to run (`'goForward'` for a back/XButton1 press,
 * `'goBack'` for a forward/XButton2 press), or `null` when the navigation must be
 * left alone: no pending press, pending older than `XNAV_WINDOW_MS`, or a sub-frame
 * navigation. Does not mutate anything — the caller consumes the pending.
 */
export function consumeUndo(pending: PendingXnav | null, now: number, isMainFrame: boolean): UndoAction | null {
  if (pending === null || !isMainFrame) return null
  if (now - pending.at > XNAV_WINDOW_MS) return null
  return pending.button === 'back' ? 'goForward' : 'goBack'
}

/**
 * Minimal structural surface of `Electron.WebContents` used by the guard — keeps this
 * module free of runtime Electron imports so the wiring is testable with a fake.
 */
export interface XnavGuardWebContents {
  on(event: 'input-event', listener: (event: unknown, input: RendererInputEvent) => void): unknown
  on(event: 'did-navigate-in-page', listener: (event: unknown, url: string, isMainFrame: boolean) => void): unknown
  removeListener(event: 'input-event', listener: (event: unknown, input: RendererInputEvent) => void): unknown
  removeListener(
    event: 'did-navigate-in-page',
    listener: (event: unknown, url: string, isMainFrame: boolean) => void,
  ): unknown
  /** Electron 44 deprecates `webContents.goBack/goForward` in favour of this history API. */
  navigationHistory: {
    goBack(): void
    goForward(): void
  }
}

/**
 * Attach the guard to a webContents. Returns a dispose that removes both listeners.
 *
 * Expiry is a timestamp comparison at consume time (no timers): a pending that never
 * sees a navigation simply stops qualifying after `XNAV_WINDOW_MS`.
 */
export function attachMouseNavGuard(webContents: XnavGuardWebContents): () => void {
  let pending: PendingXnav | null = null

  const onInput = (_event: unknown, input: RendererInputEvent): void => {
    // Detection only — no preventDefault(): Electron discards it (see module docstring).
    pending = pendingAfterInput(pending, input, Date.now())
  }

  const onNavigate = (_event: unknown, _url: string, isMainFrame: boolean): void => {
    const now = Date.now()
    const action = consumeUndo(pending, now, isMainFrame)
    if (action === null) {
      // Drop an expired pending so it can never colour a later legitimate navigation.
      if (pending !== null && now - pending.at > XNAV_WINDOW_MS) pending = null
      return
    }
    // Consume BEFORE navigating: our own goBack()/goForward() re-emits
    // did-navigate-in-page and must not be undone again (no ping-pong).
    pending = null
    if (action === 'goForward') webContents.navigationHistory.goForward()
    else webContents.navigationHistory.goBack()
  }

  webContents.on('input-event', onInput)
  webContents.on('did-navigate-in-page', onNavigate)

  return () => {
    webContents.removeListener('input-event', onInput)
    webContents.removeListener('did-navigate-in-page', onNavigate)
    pending = null
  }
}
