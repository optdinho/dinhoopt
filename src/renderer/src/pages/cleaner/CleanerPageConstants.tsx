import { CleanerType } from '@shared/enums'
import type { LucideIcon } from 'lucide-react'
import {
  AppWindow,
  Archive,
  Database,
  Gamepad2,
  Globe,
  Link2Off,
  Monitor,
  PackageX,
  Trash2,
  Variable,
} from 'lucide-react'

export interface CategoryDef {
  type: CleanerType
  labelKey: string
  icon: LucideIcon
  descriptionKey: string
  group: CleanerGroupKey
}

export const CLEANER_GROUPS = ['groupSystem', 'groupApps', 'groupMaintenance'] as const

export type CleanerGroupKey = (typeof CLEANER_GROUPS)[number]

export const categories: CategoryDef[] = [
  {
    type: CleanerType.System,
    labelKey: 'categorySystem',
    icon: Monitor,
    descriptionKey: 'categorySystemDescription',
    group: 'groupSystem',
  },
  {
    type: CleanerType.WinSxS,
    labelKey: 'categoryWinSxS',
    icon: Archive,
    descriptionKey: 'categoryWinSxSDescription',
    group: 'groupSystem',
  },
  {
    type: CleanerType.RecycleBin,
    labelKey: 'categoryRecycleBin',
    icon: Trash2,
    descriptionKey: 'categoryRecycleBinDescription',
    group: 'groupSystem',
  },
  {
    type: CleanerType.Shortcut,
    labelKey: 'categoryShortcuts',
    icon: Link2Off,
    descriptionKey: 'categoryShortcutsDescription',
    group: 'groupSystem',
  },
  {
    type: CleanerType.Environment,
    labelKey: 'categoryEnvironment',
    icon: Variable,
    descriptionKey: 'categoryEnvironmentDescription',
    group: 'groupSystem',
  },
  {
    type: CleanerType.Browser,
    labelKey: 'categoryBrowsers',
    icon: Globe,
    descriptionKey: 'categoryBrowsersDescription',
    group: 'groupApps',
  },
  {
    type: CleanerType.App,
    labelKey: 'categoryApplications',
    icon: AppWindow,
    descriptionKey: 'categoryApplicationsDescription',
    group: 'groupApps',
  },
  {
    type: CleanerType.Gaming,
    labelKey: 'categoryGaming',
    icon: Gamepad2,
    descriptionKey: 'categoryGamingDescription',
    group: 'groupApps',
  },
  {
    type: CleanerType.Database,
    labelKey: 'categoryDatabases',
    icon: Database,
    descriptionKey: 'categoryDatabasesDescription',
    group: 'groupMaintenance',
  },
  {
    type: CleanerType.UninstallLeftovers,
    labelKey: 'categoryUninstallLeftovers',
    icon: PackageX,
    descriptionKey: 'categoryUninstallLeftoversDescription',
    group: 'groupMaintenance',
  },
]

/** Check whether a path looks like an absolute filesystem path (not a label like "Recycle Bin" or "PATH → …"). */
export const isAbsolutePath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')
