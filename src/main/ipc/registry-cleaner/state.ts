import type { RegistryEntry } from '@shared/types'

interface RegistryCleanerState {
  scanAbort: AbortController | null
  fixAbort: AbortController | null
  scanSessions: Map<string, Map<string, RegistryEntry>>
}

export const state: RegistryCleanerState = {
  scanAbort: null,
  fixAbort: null,
  scanSessions: new Map(),
}

export function cleanupScanSessions(): void {
  const { scanSessions } = state
  const sessionKeys = [...scanSessions.keys()]
  while (sessionKeys.length > 3) {
    scanSessions.delete(sessionKeys.shift()!)
  }
}
