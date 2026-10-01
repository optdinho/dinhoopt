import {
  CANONICAL_GAME_MODE_OPTIMIZATIONS,
  canonicalGameModeOptimizations,
  GAME_MODE_PRECONFIG_VERSION,
} from '@shared/game-mode-preconfig'
import type { DiNhoSettings } from '@shared/types'
import { getLogger } from './logger.service'
import { getSettings, setSettings } from './settings-store'

export interface PreconfigResult {
  /** True when the canonical list was actually written to this install. */
  applied: boolean
  version: number
  previousCount: number
  nextCount: number
}

function readMarker(gameMode: DiNhoSettings['gameMode'] | undefined): number {
  const raw = gameMode?.preconfigVersion
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) return 0
  return raw
}

/**
 * Seeds the shipped Game Mode pre-config into this install exactly once per
 * `GAME_MODE_PRECONFIG_VERSION`.
 *
 * Why this exists: `readStore()` merges defaults with `deepMerge`, which only
 * *adds* missing keys. An install that predates a new optimization therefore
 * never picks it up — the default silently never reaches existing users. This
 * runs once at boot, writes the canonical list, stamps the version, and from
 * then on leaves the user's own selection completely alone.
 */
export function applyGameModePreconfig(): PreconfigResult {
  const settings = getSettings()
  const gameMode = settings.gameMode
  const current = readMarker(gameMode)
  const previousCount = Array.isArray(gameMode?.enabledOptimizations) ? gameMode.enabledOptimizations.length : 0

  if (current >= GAME_MODE_PRECONFIG_VERSION) {
    return {
      applied: false,
      version: current,
      previousCount,
      nextCount: previousCount,
    }
  }

  // Defensive: never blank a user's selection because the catalog went missing.
  if (CANONICAL_GAME_MODE_OPTIMIZATIONS.length === 0) {
    getLogger().error('preconfig', 'Canonical optimization list is empty — skipping seed to avoid wiping selection')
    return { applied: false, version: current, previousCount, nextCount: previousCount }
  }

  const enabledOptimizations = canonicalGameModeOptimizations()
  setSettings({
    gameMode: {
      ...gameMode,
      enabledOptimizations,
      preconfigVersion: GAME_MODE_PRECONFIG_VERSION,
    },
  })

  getLogger().info(
    'preconfig',
    `Seeded Game Mode pre-config v${GAME_MODE_PRECONFIG_VERSION}: ` +
      `${previousCount} -> ${enabledOptimizations.length} optimizations`,
  )

  return {
    applied: true,
    version: GAME_MODE_PRECONFIG_VERSION,
    previousCount,
    nextCount: enabledOptimizations.length,
  }
}
