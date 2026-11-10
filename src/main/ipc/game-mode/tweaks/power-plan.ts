import type { GameModeSnapshot, PowerPlanInfo } from '@shared/types'
import {
  activatePowerPlan,
  createPowerPlan,
  getActivePowerPlanGuid,
  listPowerPlans,
  unlockUltimatePerformance,
} from '../../../services/power-plans'

/** Name heuristic used only to break ties between equally capable plans. */
const MAX_PERFORMANCE_NAME_RE = /ultimate|máximo|maximo|maximum/i

/**
 * The plan name used when Game Mode has to clone one because the machine has
 * no max-performance scheme yet. Accent-free on purpose: `createPowerPlan`
 * sanitises the name and would strip the accent anyway.
 */
const FALLBACK_PLAN_NAME = 'Desempenho Maximo'

function normalise(guid: string): string {
  return guid.trim().toLowerCase()
}

/**
 * Pick the best max-performance plan already installed on the machine.
 *
 * Preference order: Ultimate Performance (and its OEM-equivalents) over the
 * stock High Performance plan; within a tier, keep the plan that is already
 * active, then the one whose name says "ultimate/maximum", then the first.
 * Returns null when the machine only has balanced/power-saver schemes.
 */
export function pickMaxPerformancePlan(plans: PowerPlanInfo[]): PowerPlanInfo | null {
  const usable = plans.filter((p) => typeof p.guid === 'string' && p.guid.trim().length > 0)
  const rank = (candidates: PowerPlanInfo[]): PowerPlanInfo | null =>
    candidates.find((p) => p.isActive) ??
    candidates.find((p) => MAX_PERFORMANCE_NAME_RE.test(p.name)) ??
    candidates[0] ??
    null

  const ultimate = usable.filter((p) => p.isUltimatePerformance)
  const highPerformance = usable.filter((p) => p.isHighPerformance && !p.isUltimatePerformance)

  return rank(ultimate) ?? rank(highPerformance)
}

async function resolveTargetGuid(): Promise<string> {
  let plans: PowerPlanInfo[] = []
  try {
    plans = await listPowerPlans()
  } catch {
    plans = []
  }

  const picked = pickMaxPerformancePlan(plans)
  if (picked) return picked.guid

  const unlocked = await unlockUltimatePerformance()
  if (unlocked.success && unlocked.guid) return unlocked.guid

  const created = await createPowerPlan(FALLBACK_PLAN_NAME)
  if (created.success && created.guid) return created.guid

  throw new Error('No high performance power plan is available on this system')
}

/** Read-back check: only a *different*, readable GUID counts as a failure. */
async function verifyActivePlan(expectedGuid: string, action: string): Promise<void> {
  const current = await getActivePowerPlanGuid()
  if (current && normalise(current) !== normalise(expectedGuid)) {
    throw new Error(`${action} failed: active plan is ${current}, expected ${expectedGuid}`)
  }
}

/**
 * Switch Game Mode to the best max-performance plan, capturing the plan that
 * was active first. Mutates `snapshot` so deactivation can restore it.
 *
 * The plan is never touched when the original GUID cannot be captured: without
 * it there is no safe way back.
 */
export async function applyMaxPerformancePowerPlan(snapshot: GameModeSnapshot): Promise<void> {
  const originalGuid = await getActivePowerPlanGuid()
  if (!originalGuid) {
    throw new Error('Could not read the active power plan — leaving it unchanged')
  }

  snapshot.originalPowerPlanGuid = normalise(originalGuid)

  const targetGuid = await resolveTargetGuid()
  if (normalise(targetGuid) !== normalise(originalGuid)) {
    const result = await activatePowerPlan(targetGuid)
    if (!result.success) {
      throw new Error(result.error ?? 'Failed to activate the max performance power plan')
    }
    await verifyActivePlan(targetGuid, 'Power plan activation')
  }

  snapshot.appliedPowerPlanGuid = normalise(targetGuid)
}

/**
 * Restore the plan that was active before Game Mode.
 *
 * Only reverts when the active plan is still the one Game Mode applied: if the
 * user picked another plan in the meantime, that choice wins. `appliedGuid`
 * is absent on snapshots written before it existed — those restore
 * unconditionally, matching the previous behaviour.
 */
export async function restoreOriginalPowerPlan(
  originalGuid: string,
  appliedGuid: string | null | undefined,
): Promise<void> {
  if (!originalGuid) return

  const current = await getActivePowerPlanGuid()
  // Cannot verify whether the plan is still ours: with an `appliedGuid` on the
  // snapshot, leave it alone rather than clobber a manual choice we can't see.
  if (!current && appliedGuid) return
  if (current) {
    const active = normalise(current)
    if (appliedGuid && active !== normalise(appliedGuid)) return
    if (active === normalise(originalGuid)) return
  }

  const result = await activatePowerPlan(originalGuid)
  if (!result.success) {
    throw new Error(result.error ?? 'Failed to restore the original power plan')
  }
  await verifyActivePlan(originalGuid, 'Power plan restore')
}
