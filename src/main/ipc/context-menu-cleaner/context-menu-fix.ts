import type {
  ContextMenuAction,
  ContextMenuApplyProgress,
  ContextMenuApplyRequest,
  ContextMenuApplyResult,
  ContextMenuEntry,
} from '@shared/types'
import { getLogger } from '../../services/logger.service'
import {
  type DisabledStateFile,
  readDisabledState,
  writeDisabledState,
  backupShellExtensionHives,
  applyOne,
  labelForAction,
} from './context-menu-constants'

// ── Apply ────────────────────────────────────────────────────────────

export async function applyContextMenu(
  requests: ContextMenuApplyRequest[],
  scanSession: Map<string, ContextMenuEntry>,
  onProgress?: (p: ContextMenuApplyProgress) => void,
  signal?: AbortSignal,
): Promise<ContextMenuApplyResult> {
  const total = requests.length
  const result: ContextMenuApplyResult = { succeeded: 0, failed: 0, errors: [], updates: [] }
  getLogger().info('context-menu-cleaner', `Applying ${total} context menu changes`)
  if (total === 0) return result

  onProgress?.({ current: 0, total, currentLabel: 'Backing up registry…' })
  await backupShellExtensionHives(signal)

  const disabled = readDisabledState()

  for (let i = 0; i < requests.length; i++) {
    if (signal?.aborted) break
    const req = requests[i]!
    const entry = scanSession.get(req.entryId) ?? null
    onProgress?.({
      current: i + 1,
      total,
      currentLabel: entry
        ? `${labelForAction(req.action)} ${entry.displayName}`
        : `${labelForAction(req.action)} (unknown)`,
    })
    if (!entry) {
      result.failed++
      result.errors.push({
        entryId: req.entryId,
        displayName: '(unknown)',
        reason: 'Entry not found — re-scan and try again.',
      })
      continue
    }

    const outcome = await applyOne(entry, req.action, signal)
    if (outcome.ok) {
      result.succeeded++
      entry.status = outcome.newStatus
      result.updates.push({ entryId: req.entryId, status: outcome.newStatus })
      if (req.action === 'disable') {
        disabled.entries[req.entryId] = {
          keyPath: entry.keyPath,
          originalName: entry.name,
          disabledAt: new Date().toISOString(),
          kind: entry.kind,
        }
      } else {
        delete disabled.entries[req.entryId]
        if (req.action === 'delete') scanSession.delete(req.entryId)
      }
    } else {
      result.failed++
      result.errors.push({ entryId: req.entryId, displayName: entry.displayName, reason: outcome.reason })
    }
  }

  try {
    writeDisabledState(disabled)
  } catch {
    /* skip */
  }
  getLogger().success('context-menu-cleaner', `Applied: ${result.succeeded} succeeded, ${result.failed} failed`)
  return result
}
