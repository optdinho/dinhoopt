import { app, type BrowserWindow } from 'electron'
import { getLogger } from './logger.service'

/**
 * Attaches listeners that record renderer-side failures to the log file.
 *
 * Issue #148: a user reported a completely black window on Windows 11 with no
 * UI ever loading. The packaged app produced zero on-disk evidence — the
 * borderless frame meant there was no menu to open DevTools, and the only
 * visible error (in PowerShell) was a downstream "Render frame was disposed"
 * from the auto-updater trying to push to an already-dead renderer.
 *
 * These listeners capture the actual cause (renderer crash, preload throw,
 * resource load failure, hang) into %APPDATA%/DiNho/logs/dinho.log so future
 * reports come with diagnostic data attached. In packaged builds we also pop
 * DevTools detached on a crash so the user can grab the console output.
 */
export function attachRendererDiagnostics(win: BrowserWindow): void {
  const wc = win.webContents

  wc.on('render-process-gone', (_event, details) => {
    getLogger().error(
      'RendererDiagnostics',
      `Renderer process gone: reason=${details.reason} exitCode=${details.exitCode}`,
    )
    if (app.isPackaged && !wc.isDestroyed() && !wc.isDevToolsOpened()) {
      try {
        wc.openDevTools({ mode: 'detach' })
      } catch {
        /* DevTools may be unavailable */
      }
    }
  })

  wc.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    // Ignore -3 (ABORTED) — fired routinely when navigation is replaced
    if (errorCode === -3) return
    const msg = `Renderer load failed: code=${errorCode} desc=${errorDescription} url=${validatedURL} mainFrame=${isMainFrame}`
    getLogger().error('RendererDiagnostics', msg)
  })

  wc.on('preload-error', (_event, preloadPath, error) => {
    getLogger().error(
      'RendererDiagnostics',
      `Preload error in ${preloadPath}:`,
      error instanceof Error ? error.message : String(error ?? ''),
    )
  })

  wc.on('did-finish-load', () => {
    getLogger().info('RendererDiagnostics', 'Renderer finished loading')
  })

  win.on('unresponsive', () => {
    getLogger().error('RendererDiagnostics', 'Renderer became unresponsive')
  })

  win.on('responsive', () => {
    getLogger().info('RendererDiagnostics', 'Renderer responsive again')
  })

  // Forward renderer console warnings/errors to the main log. We only capture
  // warning/error to avoid drowning the log.
  wc.on('console-message', (details) => {
    if (details.level !== 'error' && details.level !== 'warning') return
    const label = details.level === 'error' ? 'error' : 'warn'
    getLogger().error(
      'RendererDiagnostics',
      `Renderer console.${label}: ${details.message} (${details.sourceId}:${details.lineNumber})`,
    )
  })
}
