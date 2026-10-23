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
  /**
   * Destination of a leaf item. A parent with `children` may omit it: it then behaves as a
   * group — clicking only opens the flyout and the item is highlighted when a child matches.
   */
  path?: string
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
