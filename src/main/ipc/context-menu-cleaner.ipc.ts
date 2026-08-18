import { IPC } from '@shared/channels'
import type {
  ContextMenuApplyRequest,
  ContextMenuApplyResult,
  ContextMenuEntry,
  ContextMenuScanResult,
} from '@shared/types'
import { ipcMain } from 'electron'
import { getLogger } from '../services/logger.service'
import { applyContextMenu } from './context-menu-cleaner/context-menu-fix'
import { scanContextMenu } from './context-menu-cleaner/context-menu-scan'
import type { WindowGetter } from './index'

// ── Re-export for tests ─────────────────────────────────────────────

export { CLSID_SAFELIST, SCAN_ROOTS, VERB_SAFELIST } from './context-menu-cleaner/context-menu-constants'
export { applyContextMenu } from './context-menu-cleaner/context-menu-fix'
export {
  canonicalClsid,
  disabledNameFor,
  extractClsid,
  inferSource,
  isDisabledHandlerName,
  isProtectedClsid,
  isProtectedVerb,
  normalizeKeyPath,
  parentKeyOf,
  parseRegQueryBlocks,
  scanContextMenu,
} from './context-menu-cleaner/context-menu-scan'

// ── IPC registration ─────────────────────────────────────────────────

function isApplyRequestArray(input: unknown): input is ContextMenuApplyRequest[] {
  if (!Array.isArray(input)) return false
  return input.every(
    (r) =>
      r &&
      typeof r === 'object' &&
      typeof (r as ContextMenuApplyRequest).entryId === 'string' &&
      (r as ContextMenuApplyRequest).action !== undefined &&
      ['disable', 'enable', 'delete'].includes((r as ContextMenuApplyRequest).action),
  )
}

export function registerContextMenuCleanerIpc(getWindow: WindowGetter): void {
  // ── Closure-scoped state (per-registration, isolated from concurrent calls) ──
  let scanAbort: AbortController | null = null
  const scanSession: Map<string, ContextMenuEntry> = new Map()

  ipcMain.handle(IPC.CONTEXT_MENU_SCAN, async (): Promise<ContextMenuScanResult> => {
    if (process.platform !== 'win32') {
      return { entries: [], scanDuration: 0, scanned: 0 }
    }
    scanAbort?.abort()
    scanAbort = new AbortController()
    try {
      getLogger().info('context-menu-cleaner', 'IPC: scan requested')
      const result = await scanContextMenu(scanAbort.signal)
      getLogger().info('context-menu-cleaner', `IPC: scan returned ${result.entries.length} entries`)
      scanSession.clear()
      for (const e of result.entries) scanSession.set(e.id, e)
      return result
    } finally {
      scanAbort = null
    }
  })

  ipcMain.handle(IPC.CONTEXT_MENU_SCAN_CANCEL, async () => {
    getLogger().warning('context-menu-cleaner', 'Scan cancelled by user')
    scanAbort?.abort()
  })

  ipcMain.handle(IPC.CONTEXT_MENU_APPLY, async (_event, payload: unknown): Promise<ContextMenuApplyResult> => {
    getLogger().info('context-menu-cleaner', 'IPC: apply requested')
    if (process.platform !== 'win32') {
      getLogger().warning('context-menu-cleaner', 'Apply skipped — not on Windows')
      return { succeeded: 0, failed: 0, errors: [], updates: [] }
    }
    if (!isApplyRequestArray(payload)) {
      getLogger().warning('context-menu-cleaner', 'Apply failed — malformed payload')
      return {
        succeeded: 0,
        failed: 0,
        errors: [
          {
            entryId: '',
            displayName: '(invalid request)',
            reason: 'Malformed payload — expected an array of {entryId, action}.',
          },
        ],
        updates: [],
      }
    }
    return applyContextMenu(payload, scanSession, (progress) => {
      try {
        getWindow()?.webContents.send(IPC.CONTEXT_MENU_APPLY_PROGRESS, progress)
      } catch {
        /* skip */
      }
    })
  })
}
