function sendLog(level: string, message: string): void {
  window.dinho?.log?.(level, message)
}

const logger = {
  error: (context: string, message: string, err?: unknown) => {
    const detail = err instanceof Error ? err.message : err ? String(err) : ''
    const msg = detail ? `${message} — ${detail}` : message
    sendLog('error', `[${context}] ${msg}`)
  },
  warn: (context: string, message: string) => {
    sendLog('warn', `[${context}] ${message}`)
  },
  info: (context: string, message: string) => {
    sendLog('info', `[${context}] ${message}`)
  },
}
export default logger
