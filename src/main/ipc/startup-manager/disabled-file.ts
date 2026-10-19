import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getLogger } from '../../services/logger.service'
import type { DisabledEntry } from './types'

function getDisabledFilePath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'Kudu-Dev')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'disabled-startups.json')
}

function isValidEntry(entry: unknown): entry is DisabledEntry {
  if (entry === null || typeof entry !== 'object') return false
  const e = entry as Record<string, unknown>
  return (
    typeof e.name === 'string' &&
    e.name.length > 0 &&
    typeof e.command === 'string' &&
    typeof e.location === 'string' &&
    typeof e.source === 'string'
  )
}

function readDisabledEntries(): DisabledEntry[] {
  try {
    const filePath = getDisabledFilePath()
    if (existsSync(filePath)) {
      const parsed: unknown = JSON.parse(readFileSync(filePath, 'utf-8'))
      if (!Array.isArray(parsed)) return []
      // Legacy files may hold the literal string 'undefined' from a bad interpolation
      return parsed
        .filter(isValidEntry)
        .map((entry) => (entry.command === 'undefined' ? { ...entry, command: '' } : entry))
    }
  } catch (err) {
    getLogger().warning('startup-manager', `Failed to read disabled-startups.json: ${String(err)}`)
  }
  return []
}

function writeDisabledEntries(entries: DisabledEntry[]): void {
  // Write to a temp file first so a crash mid-write can't truncate the JSON
  const filePath = getDisabledFilePath()
  const tmpPath = `${filePath}.tmp`
  writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8')
  renameSync(tmpPath, filePath)
}

// Mutex to serialize disabled-startups.json read/mutate/write operations
let disabledFileLock: Promise<void> = Promise.resolve()
function withDisabledFileLock<T>(fn: () => T): Promise<T> {
  const prev = disabledFileLock
  let resolve: () => void
  disabledFileLock = new Promise<void>((r) => {
    resolve = r
  })
  return prev.then(fn).finally(() => resolve!())
}

export { getDisabledFilePath, readDisabledEntries, withDisabledFileLock, writeDisabledEntries }
