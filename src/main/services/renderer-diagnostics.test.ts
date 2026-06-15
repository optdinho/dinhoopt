import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  webContentsOn: vi.fn(),
  winOn: vi.fn(),
  isDestroyed: vi.fn(),
  isDevToolsOpened: vi.fn(),
  openDevTools: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  appIsPackaged: true,
}))

vi.mock('./logger', () => ({
  logError: (...args: unknown[]) => mocks.logError(...args),
  logInfo: (...args: unknown[]) => mocks.logInfo(...args),
}))

vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return mocks.appIsPackaged
    },
    set isPackaged(v: boolean) {
      mocks.appIsPackaged = v
    },
  },
}))

import { app } from 'electron'
import { attachRendererDiagnostics } from './renderer-diagnostics'

function createMockWin() {
  return {
    webContents: {
      on: mocks.webContentsOn,
      isDestroyed: mocks.isDestroyed,
      isDevToolsOpened: mocks.isDevToolsOpened,
      openDevTools: mocks.openDevTools,
    },
    on: mocks.winOn,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.isDestroyed.mockReturnValue(false)
  mocks.isDevToolsOpened.mockReturnValue(false)
  mocks.appIsPackaged = true
})

describe('attachRendererDiagnostics', () => {
  it('attaches event listeners to webContents', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    expect(mocks.webContentsOn).toHaveBeenCalledWith('render-process-gone', expect.any(Function))
    expect(mocks.webContentsOn).toHaveBeenCalledWith('did-fail-load', expect.any(Function))
    expect(mocks.webContentsOn).toHaveBeenCalledWith('preload-error', expect.any(Function))
    expect(mocks.webContentsOn).toHaveBeenCalledWith('did-finish-load', expect.any(Function))
    expect(mocks.webContentsOn).toHaveBeenCalledWith('console-message', expect.any(Function))
  })

  it('attaches unresponsive handlers to the window', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    expect(mocks.winOn).toHaveBeenCalledWith('unresponsive', expect.any(Function))
    expect(mocks.winOn).toHaveBeenCalledWith('responsive', expect.any(Function))
  })

  it('logs render-process-gone event', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining('crashed'))
  })

  it('ignores did-fail-load with error code -3 (ABORTED)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'did-fail-load')?.[1]
    handler({}, -3, 'Aborted', 'about:blank', true)

    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('logs non-aborted did-fail-load errors', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'did-fail-load')?.[1]
    handler({}, -6, 'Connection refused', 'http://example.com', true)

    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining('-6'))
  })

  it('opens DevTools on renderer crash in packaged build', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })

  it('does not open DevTools if already opened', () => {
    mocks.isDevToolsOpened.mockReturnValue(true)
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.openDevTools).not.toHaveBeenCalled()
  })

  it('does not open DevTools if webContents is destroyed', () => {
    mocks.isDestroyed.mockReturnValue(true)
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.openDevTools).not.toHaveBeenCalled()
  })

  it('silently catches openDevTools exceptions', () => {
    mocks.openDevTools.mockImplementation(() => {
      throw new Error('DevTools unavailable')
    })
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    expect(() => handler({}, { reason: 'crashed', exitCode: 1 })).not.toThrow()
  })

  it('does not open DevTools when app is not packaged', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    vi.mocked(app).isPackaged = false
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.openDevTools).not.toHaveBeenCalled()
  })

  it('logs preload-error event', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'preload-error')?.[1]
    handler({}, '/path/to/preload.js', new Error('preload failed'))

    expect(mocks.logError).toHaveBeenCalledWith(expect.stringContaining('/path/to/preload.js'), expect.any(Error))
  })

  it('logs did-finish-load event', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'did-finish-load')?.[1]
    handler()

    expect(mocks.logInfo).toHaveBeenCalledWith('Renderer finished loading')
  })

  it('logs unresponsive event', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.winOn.mock.calls.find((c: string[]) => c[0] === 'unresponsive')?.[1]
    handler()

    expect(mocks.logError).toHaveBeenCalledWith('Renderer became unresponsive')
  })

  it('logs responsive event', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.winOn.mock.calls.find((c: string[]) => c[0] === 'responsive')?.[1]
    handler()

    expect(mocks.logInfo).toHaveBeenCalledWith('Renderer responsive again')
  })

  it('logs renderer console errors (level 3)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'console-message')?.[1]
    handler({}, 3, 'Something went wrong', 42, 'http://example.com/app.js')

    expect(mocks.logError).toHaveBeenCalledWith(
      expect.stringContaining('Renderer console.error: Something went wrong'),
    )
  })

  it('logs renderer console warnings (level 2)', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'console-message')?.[1]
    handler({}, 2, 'Deprecation warning', 10, 'http://example.com/app.js')

    expect(mocks.logError).toHaveBeenCalledWith(
      expect.stringContaining('Renderer console.warn: Deprecation warning'),
    )
  })

  it('ignores console-message with level < 2', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'console-message')?.[1]
    handler({}, 1, 'Info message', 5, 'http://example.com/app.js')

    expect(mocks.logError).not.toHaveBeenCalled()
  })
})
