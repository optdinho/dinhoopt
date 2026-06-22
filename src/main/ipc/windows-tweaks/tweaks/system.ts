import type { WindowsTweakDef } from '@shared/types'
import type { WindowGetter } from '../../index'

export const SYSTEM_TWEAKS: WindowsTweakDef[] = []

export function registerSystemTweaks(_getWindow: WindowGetter): void {
  // No system-specific IPC handlers currently
}
