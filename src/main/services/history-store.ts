import { IPC } from '@shared/channels'
import type { ScanHistoryEntry } from '@shared/types'
import { BrowserWindow } from 'electron'
import { createJsonStore } from './store-base'

const MAX_HISTORY = 100

const store = createJsonStore<ScanHistoryEntry[]>({
  name: 'history.json',
  defaults: [],
  devSuffix: 'Kudu-Dev',
})

export function getHistory(): ScanHistoryEntry[] {
  try {
    const data = store.load()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

let writeLock: Promise<void> = Promise.resolve()

export function addHistoryEntry(entry: ScanHistoryEntry): void {
  const prev = writeLock
  let unlock: () => void
  writeLock = new Promise<void>((r) => {
    unlock = r
  })
  prev.then(() => {
    try {
      const history = store.load()
      history.unshift(entry)
      if (history.length > MAX_HISTORY) history.length = MAX_HISTORY
      store.save(history)
      const win = BrowserWindow.getAllWindows()[0]
      if (win && !win.isDestroyed()) win.webContents.send(IPC.HISTORY_CHANGED)
    } finally {
      unlock!()
    }
  })
}

export function clearHistory(): void {
  store.save([])
}
