import type { WindowsTweakDef } from '@shared/types'
import type { WindowGetter } from '../../index'

export const CONTEXT_MENU_TWEAKS: WindowsTweakDef[] = []

export function registerContextMenuTweaks(_getWindow: WindowGetter): void {
  // No context-menu-specific IPC handlers currently
}
