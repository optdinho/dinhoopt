import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { IPC } from '@shared/channels'
import type { RegistryEntry } from '@shared/types'
import type { WindowGetter } from './index'
import { getSettings, updateRegistryIgnoredTweaks } from '../services/settings-store'
import { applyIgnoredTweaks } from '@shared/registry-tweaks'
import { validateStringArray } from '../services/ipc-validation'
import { scanRegistry, collectBackupTargets, fixRegistryEntries } from '../services/registry-cleaner.service'

export { scanRegistry, collectBackupTargets, fixRegistryEntries }

let scanAbort: AbortController | null = null
let fixAbort: AbortController | null = null

const scanSessions = new Map<string, Map<string, RegistryEntry>>()

export function registerRegistryCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.REGISTRY_SCAN, async (): Promise<RegistryEntry[]> => {
    if (process.platform !== 'win32') return []

    scanAbort?.abort()
    scanAbort = new AbortController()
    const { signal } = scanAbort

    let entries: RegistryEntry[]
    try {
      entries = await scanRegistry(signal)
    } catch (err: any) {
      if (signal.aborted) return []
      throw err
    } finally {
      if (scanAbort?.signal === signal) scanAbort = null
    }

    applyIgnoredTweaks(entries, getSettings().registryIgnoredTweaks ?? [])

    const sessionMap = new Map<string, RegistryEntry>()
    for (const entry of entries) {
      sessionMap.set(entry.id, entry)
    }
    const scanId = randomUUID()
    scanSessions.set(scanId, sessionMap)

    const sessionKeys = [...scanSessions.keys()]
    while (sessionKeys.length > 3) {
      scanSessions.delete(sessionKeys.shift()!)
    }

    return entries
  })

  ipcMain.handle(IPC.REGISTRY_FIX, async (_event, entryIds: string[]): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> => {
    if (process.platform !== 'win32') return { fixed: 0, failed: 0, failures: [] }
    const valid = validateStringArray(entryIds)
    if (!valid) return { fixed: 0, failed: 0, failures: [] }

    fixAbort?.abort()
    fixAbort = new AbortController()
    const { signal } = fixAbort

    const entriesToFix: RegistryEntry[] = []
    for (const id of valid) {
      for (const session of scanSessions.values()) {
        const entry = session.get(id)
        if (entry) { entriesToFix.push(entry); break }
      }
    }

    try {
      return await fixRegistryEntries(entriesToFix, (current, total, currentEntry) => {
        const win = getWindow()
        if (win && !win.isDestroyed()) win.webContents.send(IPC.REGISTRY_FIX_PROGRESS, { current, total, currentEntry })
      }, signal)
    } catch (err: any) {
      if (signal.aborted) return { fixed: 0, failed: 0, failures: [{ issue: 'Cancelled', reason: 'Operation was cancelled by user' }] }
      throw err
    } finally {
      if (fixAbort?.signal === signal) fixAbort = null
    }
  })

  ipcMain.handle(IPC.REGISTRY_SET_TWEAK_IGNORED, (_event, signatures: string[], ignored: boolean) => {
    const valid = validateStringArray(signatures, 200, 1024)
    if (!valid || typeof ignored !== 'boolean') return
    updateRegistryIgnoredTweaks(valid, ignored)
  })

  ipcMain.handle(IPC.REGISTRY_SCAN_CANCEL, () => {
    scanAbort?.abort()
    scanAbort = null
  })

  ipcMain.handle(IPC.REGISTRY_FIX_CANCEL, () => {
    fixAbort?.abort()
    fixAbort = null
  })
}
