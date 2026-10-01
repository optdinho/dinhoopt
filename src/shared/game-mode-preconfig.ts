import type { GameModeOptimizationId } from './types/game-mode'

/**
 * Bump this whenever the canonical pre-config must be re-seeded on user
 * machines. The one-shot migration in `src/main/services/preconfig-migration.ts`
 * applies the list below exactly once per version — after that the user's own
 * selection is never overwritten again.
 */
export const GAME_MODE_PRECONFIG_VERSION = 1

/**
 * The shipped Game Mode pre-config: a conservative, well-tested set that
 * disables the Game Bar capture stack, stops background services, tunes
 * process scheduling and clears the standby list. Every id here must exist in
 * `VALID_OPTIMIZATION_IDS` (src/main/ipc/game-mode/validation.ts) — a test
 * asserts that so the two lists can never drift apart.
 *
 * This is the single source of truth: the main-process defaults and both
 * renderer defaults all reference it instead of keeping their own copies.
 */
export const CANONICAL_GAME_MODE_OPTIMIZATIONS: readonly GameModeOptimizationId[] = [
  // Services — non-essential background work
  'svc-wsearch',
  'svc-wuauserv',
  'svc-spooler',
  // Processes — trim startup-time consumers
  'proc-kill-updaters',
  // Memory — release standby list and working sets
  'mem-clear-standby',
  'mem-empty-working-set',
  // System — reduce interference during play
  'sys-focus-assist',
  'sys-power-plan',
  'sys-prevent-sleep',
  'sys-timer-resolution',
  // Windows capture stack — the Game Bar / DVR recording blockers
  'sys-disable-game-bar',
  'sys-disable-fse-opt',
  // Appearance
  'sys-disable-transparency',
  // CPU / network
  'cpu-game-priority',
  'net-flush-dns',
  'net-disable-nagle',
] as const satisfies readonly GameModeOptimizationId[]

/** Fresh mutable copy — never hand out the shared frozen array reference. */
export function canonicalGameModeOptimizations(): GameModeOptimizationId[] {
  return [...CANONICAL_GAME_MODE_OPTIMIZATIONS]
}
