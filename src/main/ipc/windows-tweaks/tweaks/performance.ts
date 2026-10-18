import type { WindowsTweakDef } from '@shared/types'
import { GAMING_SYSTEM_TWEAKS } from './gaming-system'
import { MMCSS_ENERGY_TWEAKS } from './mmcss-energy'
import { MOUSE_GPU_TWEAKS } from './mouse-gpu'

export const PERFORMANCE_TWEAKS: WindowsTweakDef[] = [
  ...MOUSE_GPU_TWEAKS,
  ...MMCSS_ENERGY_TWEAKS,
  ...GAMING_SYSTEM_TWEAKS,
]
