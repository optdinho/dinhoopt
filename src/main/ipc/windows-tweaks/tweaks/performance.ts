import type { WindowsTweakDef } from '@shared/types'
import type { WindowGetter } from '../../index'
import { MOUSE_GPU_TWEAKS } from './mouse-gpu'
import { MMCSS_ENERGY_TWEAKS } from './mmcss-energy'
import { GAMING_SYSTEM_TWEAKS } from './gaming-system'

export const PERFORMANCE_TWEAKS: WindowsTweakDef[] = [
  ...MOUSE_GPU_TWEAKS,
  ...MMCSS_ENERGY_TWEAKS,
  ...GAMING_SYSTEM_TWEAKS,
]

export function registerPerformanceTweaks(_getWindow: WindowGetter): void {
  // No performance-specific IPC handlers currently
}
