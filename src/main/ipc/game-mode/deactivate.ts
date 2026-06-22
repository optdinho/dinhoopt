import type { GameModeDeactivateResult, GameModeProgress } from '@shared/types'
import { powerSaveBlocker } from 'electron'
import { getLogger } from '../../services/logger.service'
import { activePowerBlockerId, resetActivePowerBlockerId } from './activate'
import { restoreGamePriority, restoreRegistryTweaks } from './detection/library'
import { deleteSnapshot, readSnapshot, writeSnapshot } from './snapshot'
import { restoreFocusAssist, restoreNagle, restorePowerPlan, restoreService, restoreTimerResolution } from './tweaks'

export async function deactivateGameMode(onProgress: (p: GameModeProgress) => void): Promise<GameModeDeactivateResult> {
  getLogger().info('game-mode', 'Deactivating Game Mode')
  const snapshot = readSnapshot()
  if (!snapshot) {
    getLogger().warning('game-mode', 'No snapshot found — nothing to deactivate')
    return { restored: 0, failed: 0, errors: [] }
  }

  let restored = 0
  const errors: GameModeDeactivateResult['errors'] = []

  const residual: typeof snapshot = {
    ...snapshot,
    services: [...snapshot.services],
    killedProcesses: [...snapshot.killedProcesses],
    nagleInterfaces: [...snapshot.nagleInterfaces],
    registryTweaks: [...snapshot.registryTweaks],
    gameProcessPriorities: [...snapshot.gameProcessPriorities],
    originalTimerResolution: snapshot.originalTimerResolution,
  }

  const steps: Array<{ id: string; fn: () => Promise<void>; clear: () => void }> = []

  for (const svc of snapshot.services) {
    steps.push({
      id: `svc-restore-${svc.name}`,
      fn: () => restoreService(svc),
      clear: () => {
        residual.services = residual.services.filter((s) => s.name !== svc.name)
      },
    })
  }

  if (snapshot.originalPowerPlanGuid) {
    steps.push({
      id: 'sys-power-plan',
      fn: () => restorePowerPlan(snapshot.originalPowerPlanGuid!),
      clear: () => {
        residual.originalPowerPlanGuid = null
      },
    })
  }

  if (snapshot.originalFocusAssistState !== null) {
    steps.push({
      id: 'sys-focus-assist',
      fn: () => restoreFocusAssist(snapshot.originalFocusAssistState),
      clear: () => {
        residual.originalFocusAssistState = null
      },
    })
  }

  if (snapshot.originalTimerResolution !== null) {
    steps.push({
      id: 'sys-timer-resolution',
      fn: () => restoreTimerResolution(snapshot.originalTimerResolution!),
      clear: () => {
        residual.originalTimerResolution = null
      },
    })
  }

  if (snapshot.powerSaveBlockerId !== null || activePowerBlockerId !== null) {
    steps.push({
      id: 'sys-prevent-sleep',
      fn: async () => {
        const id = activePowerBlockerId ?? snapshot.powerSaveBlockerId
        if (id !== null && powerSaveBlocker.isStarted(id)) {
          powerSaveBlocker.stop(id)
        }
        resetActivePowerBlockerId()
      },
      clear: () => {
        residual.powerSaveBlockerId = null
      },
    })
  }

  if (snapshot.nagleInterfaces.length > 0) {
    steps.push({
      id: 'net-disable-nagle',
      fn: () => restoreNagle(snapshot.nagleInterfaces),
      clear: () => {
        residual.nagleInterfaces = []
      },
    })
  }

  if (snapshot.gameProcessPriorities.length > 0) {
    steps.push({
      id: 'cpu-game-priority',
      fn: () => restoreGamePriority(snapshot.gameProcessPriorities),
      clear: () => {
        residual.gameProcessPriorities = []
      },
    })
  }

  if (snapshot.registryTweaks.length > 0) {
    steps.push({
      id: 'sys-registry-tweaks',
      fn: async () => {
        const r = await restoreRegistryTweaks(snapshot.registryTweaks)
        if (r.errors.length > 0) throw new Error(`${r.errors.length} registry value(s) failed to restore`)
      },
      clear: () => {
        residual.registryTweaks = []
      },
    })
  }

  const total = steps.length
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]
    if (!step) continue
    onProgress({ phase: 'deactivating', current: i + 1, total, currentLabel: step.id })
    try {
      await step.fn()
      step.clear()
      restored++
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'Unknown error'
      getLogger().error('game-mode', `Restoration "${step.id}" failed: ${reason}`)
      errors.push({ optimizationId: step.id, reason })
    }
  }

  if (errors.length === 0) {
    deleteSnapshot()
  } else {
    residual.active = false
    writeSnapshot(residual)
  }
  getLogger().success('game-mode', `Game Mode deactivated: ${restored} restored, ${errors.length} failed`)
  return { restored, failed: errors.length, errors }
}
