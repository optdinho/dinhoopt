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

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    error: (...args: unknown[]) => mocks.logError(...args),
    info: (...args: unknown[]) => mocks.logInfo(...args),
  }),
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
    attachRendererDiagnostics(createMockWin() as any)

    expect(mocks.webContentsOn).toHaveBeenCalledWith('render-process-gone', expect.any(Function))
    expect(mocks.webContentsOn).toHaveBeenCalledWith('did-fail-load', expect.any(Function))
    expect(mocks.webContentsOn).toHaveBeenCalledWith('preload-error', expect.any(Function))
    expect(mocks.webContentsOn).toHaveBeenCalledWith('did-finish-load', expect.any(Function))
    expect(mocks.webContentsOn).toHaveBeenCalledWith('console-message', expect.any(Function))
  })

  it('attaches unresponsive handlers to the window', () => {
    attachRendererDiagnostics(createMockWin() as any)

    expect(mocks.winOn).toHaveBeenCalledWith('unresponsive', expect.any(Function))
    expect(mocks.winOn).toHaveBeenCalledWith('responsive', expect.any(Function))
  })

  it('logs render-process-gone event', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.logError).toHaveBeenCalledWith('RendererDiagnostics', expect.stringContaining('crashed'))
  })

  it('ignores did-fail-load with error code -3 (ABORTED)', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'did-fail-load')?.[1]
    handler({}, -3, 'Aborted', 'about:blank', true)

    expect(mocks.logError).not.toHaveBeenCalled()
  })

  it('logs non-aborted did-fail-load errors', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'did-fail-load')?.[1]
    handler({}, -6, 'Connection refused', 'http://example.com', true)

    expect(mocks.logError).toHaveBeenCalledWith('RendererDiagnostics', expect.stringContaining('-6'))
  })

  it('opens DevTools on renderer crash in packaged build', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })

  it('does not open DevTools if already opened', () => {
    mocks.isDevToolsOpened.mockReturnValue(true)
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.openDevTools).not.toHaveBeenCalled()
  })

  it('does not open DevTools if webContents is destroyed', () => {
    mocks.isDestroyed.mockReturnValue(true)
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.openDevTools).not.toHaveBeenCalled()
  })

  it('silently catches openDevTools exceptions', () => {
    mocks.openDevTools.mockImplementation(() => {
      throw new Error('DevTools unavailable')
    })
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    expect(() => handler({}, { reason: 'crashed', exitCode: 1 })).not.toThrow()
  })

  it('does not open DevTools when app is not packaged', () => {
    Object.defineProperty(app, 'isPackaged', { value: false, writable: true, configurable: true })
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'render-process-gone')?.[1]
    handler({}, { reason: 'crashed', exitCode: 1 })

    expect(mocks.openDevTools).not.toHaveBeenCalled()
  })

  it('logs preload-error event', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'preload-error')?.[1]
    handler({}, '/path/to/preload.js', new Error('preload failed'))

    expect(mocks.logError).toHaveBeenCalledWith(
      'RendererDiagnostics',
      expect.stringContaining('/path/to/preload.js'),
      'preload failed',
    )
  })

  it('logs did-finish-load event', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'did-finish-load')?.[1]
    handler()

    expect(mocks.logInfo).toHaveBeenCalledWith('RendererDiagnostics', 'Renderer finished loading')
  })

  it('logs unresponsive event', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.winOn.mock.calls.find((c: string[]) => c[0] === 'unresponsive')?.[1]
    handler()

    expect(mocks.logError).toHaveBeenCalledWith('RendererDiagnostics', 'Renderer became unresponsive')
  })

  it('logs responsive event', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.winOn.mock.calls.find((c: string[]) => c[0] === 'responsive')?.[1]
    handler()

    expect(mocks.logInfo).toHaveBeenCalledWith('RendererDiagnostics', 'Renderer responsive again')
  })

  it('logs renderer console errors (level 3)', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'console-message')?.[1]
    handler({}, 3, 'Something went wrong', 42, 'http://example.com/app.js')

    expect(mocks.logError).toHaveBeenCalledWith(
      'RendererDiagnostics',
      expect.stringContaining('Renderer console.error: Something went wrong'),
    )
  })

  it('logs renderer console warnings (level 2)', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'console-message')?.[1]
    handler({}, 2, 'Deprecation warning', 10, 'http://example.com/app.js')

    expect(mocks.logError).toHaveBeenCalledWith(
      'RendererDiagnostics',
      expect.stringContaining('Renderer console.warn: Deprecation warning'),
    )
  })

  it('ignores console-message with level < 2', () => {
    attachRendererDiagnostics(createMockWin() as any)

    const handler = mocks.webContentsOn.mock.calls.find((c: string[]) => c[0] === 'console-message')?.[1]
    handler({}, 1, 'Info message', 5, 'http://example.com/app.js')

    expect(mocks.logError).not.toHaveBeenCalled()
  })
})
