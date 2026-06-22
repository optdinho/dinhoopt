import type { GameModeStatus } from '@shared/types'
import { readSnapshot } from './snapshot'

export function getGameModeStatus(): GameModeStatus {
  const snapshot = readSnapshot()
  return {
    active: snapshot?.active === true,
    activatedAt: snapshot?.activatedAt ?? null,
    pendingRestore: snapshot !== null && snapshot.active === false,
  }
}
