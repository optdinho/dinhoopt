import type { LucideIcon } from 'lucide-react'

export type SectionColor = 'amber' | 'red' | 'blue' | 'green' | 'purple'

export interface SubItemDef {
  icon: LucideIcon
  label?: string
  labelKey?: string
  path: string
  badge?: boolean
  badgeLabel?: string
}

export interface NavItemDef {
  icon: LucideIcon
  label?: string
  labelKey?: string
  path: string
  children?: SubItemDef[]
  badge?: boolean
  badgeLabel?: string
  highlight?: boolean
}

export interface NavGroup {
  headingKey?: string
  color?: SectionColor
  items: NavItemDef[]
}
