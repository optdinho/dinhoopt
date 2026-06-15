import type { GameModeCategory, GameModeOptimizationId } from '@shared/types'
import type { LucideIcon } from 'lucide-react'

export interface OptimizationDef {
  id: GameModeOptimizationId
  category: GameModeCategory
  labelKey: string
  descKey: string
  requiresAdmin: boolean
}

export interface CategoryDef {
  id: GameModeCategory
  labelKey: string
  descKey: string
  icon: LucideIcon
  color: string
  glow: string
}
