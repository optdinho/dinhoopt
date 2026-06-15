import { app } from 'electron'
import { initAutoUpdater } from './services/auto-updater'
import { setDaemonMode } from './services/logger'

function log(msg: string): void {
  const ts = new Date().toISOString()
  process.stdout.write(`[${ts}] ${msg}\n`)
}

export async function runDaemon(): Promise<void> {
  setDaemonMode(true)

  log(`DiNho daemon v${app.getVersion()} starting`)
  log(`Platform: ${process.platform} (${process.arch})`)
  log(`PID: ${process.pid}`)

  initAutoUpdater({ daemon: true })

  const shutdown = (): void => {
    log('Shutting down...')
    log('Goodbye.')
    app.exit(0)
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)

  setInterval(
    () => {
      log('Heartbeat — daemon running')
    },
    5 * 60 * 1000,
  )

  log('Daemon running. Press Ctrl+C to stop.')
}
