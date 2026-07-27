import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { DisabledEntry } from './types'

function getDisabledFilePath(): string {
  const dir = app.isPackaged ? app.getPath('userData') : join(app.getPath('userData'), 'Kudu-Dev')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'disabled-startups.json')
}

function readDisabledEntries(): DisabledEntry[] {
  try {
    const filePath = getDisabledFilePath()
    if (existsSync(filePath)) {
      return JSON.parse(readFileSync(filePath, 'utf-8'))
    }
  } catch {
    /* corrupt file, return empty */
  }
  return []
}

function writeDisabledEntries(entries: DisabledEntry[]): void {
  writeFileSync(getDisabledFilePath(), JSON.stringify(entries, null, 2), 'utf-8')
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
