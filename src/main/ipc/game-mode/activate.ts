import { isGameCompatible } from '@shared/service-safety-kb'
import type { GameModeActivateResult, GameModeConfig, GameModeProgress, GameModeSnapshot } from '@shared/types'
import { powerSaveBlocker } from 'electron'
import { getPlatform } from '../../platform'
import { isAdmin } from '../../services/elevation'
import { getDetectedGame } from '../../services/game-detector'
import { getLogger } from '../../services/logger.service'
import {
  captureAndSetGamePriority,
  disableFullscreenOptimizations,
  disableGameBar,
  disableTransparency,
} from './detection/library'
import { BROWSER_PROCESSES, CHAT_PROCESSES, UPDATER_PROCESSES, killProcessesByName } from './detection/process'
import { SERVICE_MAP, writeSnapshot } from './snapshot'
import {
  applyTimerResolution,
  captureAndDisableService,
  capturePowerPlan,
  clearStandbyMemory,
  disableNagle,
  enableFocusAssist,
  setHighPerformancePlan,
} from './tweaks'

export let activePowerBlockerId: number | null = null

export function resetActivePowerBlockerId(): void {
  activePowerBlockerId = null
}

export async function activateGameMode(
  config: GameModeConfig,
  onProgress: (p: GameModeProgress) => void,
): Promise<GameModeActivateResult> {
  getLogger().info('game-mode', 'Activating Game Mode')
  const enabled = config.enabledOptimizations
  const total = enabled.length
  let succeeded = 0
  const errors: GameModeActivateResult['errors'] = []

  const snapshot: GameModeSnapshot = {
    activatedAt: new Date().toISOString(),
    active: true,
    services: [],
    killedProcesses: [],
    originalPowerPlanGuid: null,
    originalFocusAssistState: null,
    powerSaveBlockerId: null,
    originalTimerResolution: null,
    nagleInterfaces: [],
    registryTweaks: [],
    gameProcessPriorities: [],
  }

  const admin = isAdmin()

  for (let i = 0; i < enabled.length; i++) {
    const id = enabled[i]
    if (!id) continue
    onProgress({ phase: 'activating', current: i + 1, total, currentLabel: id })

    try {
      if (id in SERVICE_MAP) {
        if (!admin) throw new Error('Administrator privileges required')
        const serviceName = SERVICE_MAP[id] ?? ''
        if (!serviceName) continue
        const detectedGame = getDetectedGame()
        if (detectedGame && !isGameCompatible(serviceName, detectedGame)) {
          errors.push({
            optimizationId: id,
            reason: `Service ${serviceName} is incompatible with ${detectedGame} — skipped`,
          })
          continue
        }
        await captureAndDisableService(serviceName, snapshot)
        succeeded++
        writeSnapshot(snapshot)
        continue
      }

      if (id === 'proc-kill-browsers') {
        const r = await killProcessesByName(BROWSER_PROCESSES, snapshot)
        if (r.errors.length) throw new Error(r.errors[0])
        succeeded++
        continue
      }
      if (id === 'proc-kill-chat') {
        const r = await killProcessesByName(CHAT_PROCESSES, snapshot)
        if (r.errors.length) throw new Error(r.errors[0])
        succeeded++
        continue
      }
      if (id === 'proc-kill-updaters') {
        const r = await killProcessesByName(UPDATER_PROCESSES, snapshot)
        if (r.errors.length) throw new Error(r.errors[0])
        succeeded++
        continue
      }
      if (id === 'proc-kill-custom') {
        if (config.customProcessKillList.length > 0) {
          const r = await killProcessesByName(config.customProcessKillList, snapshot)
          if (r.errors.length) throw new Error(r.errors[0])
        }
        succeeded++
        continue
      }

      if (id === 'mem-clear-standby') {
        await clearStandbyMemory()
        succeeded++
        continue
      }

      if (id === 'sys-focus-assist') {
        await enableFocusAssist(snapshot)
        succeeded++
        writeSnapshot(snapshot)
        continue
      }
      if (id === 'sys-power-plan') {
        await capturePowerPlan(snapshot)
        await setHighPerformancePlan()
        succeeded++
        writeSnapshot(snapshot)
        continue
      }
      if (id === 'sys-prevent-sleep') {
        activePowerBlockerId = powerSaveBlocker.start('prevent-display-sleep')
        snapshot.powerSaveBlockerId = activePowerBlockerId
        succeeded++
        writeSnapshot(snapshot)
        continue
      }
      if (id === 'sys-disable-game-bar') {
        await disableGameBar(snapshot)
        succeeded++
        writeSnapshot(snapshot)
        continue
      }
      if (id === 'sys-disable-fse-opt') {
        await disableFullscreenOptimizations(snapshot)
        succeeded++
        writeSnapshot(snapshot)
        continue
      }
      if (id === 'sys-disable-transparency') {
        await disableTransparency(snapshot)
        succeeded++
        writeSnapshot(snapshot)
        continue
      }
      if (id === 'sys-timer-resolution') {
        await applyTimerResolution(snapshot)
        succeeded++
        writeSnapshot(snapshot)
        continue
      }

      if (id === 'cpu-game-priority') {
        await captureAndSetGamePriority(snapshot)
        succeeded++
        writeSnapshot(snapshot)
        continue
      }

      if (id === 'net-flush-dns') {
        const platform = getPlatform()
        const ok = await (platform.network.flushDnsCache?.() ?? Promise.resolve(false))
        if (!ok) throw new Error('DNS flush failed')
        succeeded++
        continue
      }
      if (id === 'net-disable-nagle') {
        if (!admin) throw new Error('Administrator privileges required')
        await disableNagle(snapshot)
        succeeded++
        writeSnapshot(snapshot)
      }
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : 'Unknown error'
      getLogger().error('game-mode', `Optimization "${id}" failed: ${reason}`)
      errors.push({ optimizationId: id, reason })
    }
  }

  if (succeeded > 0) {
    writeSnapshot(snapshot)
  }

  getLogger().success('game-mode', `Game Mode activated: ${succeeded}/${total} optimizations succeeded`)
  return { succeeded, failed: errors.length, errors, snapshot }
}
