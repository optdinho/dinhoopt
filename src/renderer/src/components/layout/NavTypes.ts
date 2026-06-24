import type { LucideIcon } from 'lucide-react'

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
  badgeLabel?: string
}

export interface NavGroup {
  headingKey?: string
  items: NavItemDef[]
}
