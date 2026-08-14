function sendLog(level: string, message: string): void {
  window.dinho?.log?.(level, message)
}

interface RendererErrorInfo {
  componentStack?: string
}

const logger = {
  error: (context: string, message: string, err?: unknown) => {
    let detail = err instanceof Error ? err.message : ''
    if (!detail && err && typeof err === 'object' && 'componentStack' in err) {
      const info = err as RendererErrorInfo
      const stack = info.componentStack?.replace(/\n\s*/g, ' | ').trim()
      detail = stack ? `componentStack: ${stack}` : String(err)
    }
    if (!detail) detail = err ? String(err) : ''
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
