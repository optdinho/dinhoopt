import { randomUUID } from 'node:crypto'
import { IPC } from '@shared/channels'
import { applyIgnoredTweaks } from '@shared/registry-tweaks'
import type { RegistryEntry } from '@shared/types'
import { ipcMain } from 'electron'
import { validateStringArray } from '../../services/ipc-validation'
import { getLogger } from '../../services/logger.service'
import { collectBackupTargets, fixRegistryEntries, scanRegistry } from '../../services/registry-cleaner.service'
import { getSettings, updateRegistryIgnoredTweaks } from '../../services/settings-store'
import type { WindowGetter } from '../index'
import { cleanupScanSessions, state } from './state'

export { scanRegistry, collectBackupTargets, fixRegistryEntries }

export function registerRegistryCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.REGISTRY_SCAN, async (): Promise<RegistryEntry[]> => {
    if (process.platform !== 'win32') {
      getLogger().warning('registry-cleaner', 'Registry scan skipped — not Windows')
      return []
    }

    getLogger().info('registry-cleaner', 'Scanning registry for issues...')
    state.scanAbort?.abort()
    state.scanAbort = new AbortController()
    const { signal } = state.scanAbort

    let entries: RegistryEntry[]
    try {
      entries = await scanRegistry(signal)
    } catch (err: unknown) {
      if (signal.aborted) {
        getLogger().info('registry-cleaner', 'Registry scan cancelled')
        return []
      }
      const message = err instanceof Error ? err.message : 'Unknown error'
      getLogger().error('registry-cleaner', `Registry scan failed: ${message}`)
      throw err
    } finally {
      if (state.scanAbort?.signal === signal) state.scanAbort = null
    }

    applyIgnoredTweaks(entries, getSettings().registryIgnoredTweaks ?? [])

    const sessionMap = new Map<string, RegistryEntry>()
    for (const entry of entries) {
      sessionMap.set(entry.id, entry)
    }
    const scanId = randomUUID()
    state.scanSessions.set(scanId, sessionMap)
    cleanupScanSessions()

    getLogger().success('registry-cleaner', `Registry scan complete — ${entries.length} issues found`)
    return entries
  })

  ipcMain.handle(
    IPC.REGISTRY_FIX,
    async (
      _event,
      entryIds: string[],
    ): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> => {
      if (process.platform !== 'win32') return { fixed: 0, failed: 0, failures: [] }
      const valid = validateStringArray(entryIds)
      if (!valid) {
        getLogger().warning('registry-cleaner', 'Fix called with invalid entry IDs')
        return { fixed: 0, failed: 0, failures: [] }
      }

      getLogger().info('registry-cleaner', `Fixing ${valid.length} registry issue(s)...`)
      state.fixAbort?.abort()
      state.fixAbort = new AbortController()
      const { signal } = state.fixAbort

      const entriesToFix: RegistryEntry[] = []
      for (const id of valid) {
        for (const session of state.scanSessions.values()) {
          const entry = session.get(id)
          if (entry) {
            entriesToFix.push(entry)
            break
          }
        }
      }

      try {
        const result = await fixRegistryEntries(
          entriesToFix,
          (current, total, currentEntry) => {
            const win = getWindow()
            if (win && !win.isDestroyed())
              win.webContents.send(IPC.REGISTRY_FIX_PROGRESS, { current, total, currentEntry })
          },
          signal,
        )
        getLogger().success('registry-cleaner', `Fix complete — ${result.fixed} fixed, ${result.failed} failed`)
        return result
      } catch (err: unknown) {
        if (signal.aborted) {
          getLogger().info('registry-cleaner', 'Registry fix cancelled')
          return { fixed: 0, failed: 0, failures: [{ issue: 'Cancelled', reason: 'Operation was cancelled by user' }] }
        }
        getLogger().error(
          'registry-cleaner',
          `Registry fix failed: ${err instanceof Error ? err.message : String(err)}`,
        )
        throw err
      } finally {
        if (state.fixAbort?.signal === signal) state.fixAbort = null
      }
    },
  )

  ipcMain.handle(IPC.REGISTRY_SET_TWEAK_IGNORED, (_event, signatures: string[], ignored: boolean) => {
    const valid = validateStringArray(signatures, 200, 1024)
    if (!valid || typeof ignored !== 'boolean') return
    updateRegistryIgnoredTweaks(valid, ignored)
  })

  ipcMain.handle(IPC.REGISTRY_SCAN_CANCEL, () => {
    state.scanAbort?.abort()
    state.scanAbort = null
  })

  ipcMain.handle(IPC.REGISTRY_FIX_CANCEL, () => {
    state.fixAbort?.abort()
    state.fixAbort = null
  })
}
