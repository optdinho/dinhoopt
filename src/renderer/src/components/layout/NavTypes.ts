import type { LucideIcon } from 'lucide-react'

export interface SubItemDef {
  icon: LucideIcon
  label?: string
  labelKey?: string
  path: string
  badge?: boolean
}

export interface NavItemDef {
  icon: LucideIcon
  label?: string
  labelKey?: string
  path: string
  children?: SubItemDef[]
}

export interface NavGroup {
  headingKey?: string
  items: NavItemDef[]
}
