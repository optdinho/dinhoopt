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
}

export const categories: CategoryDef[] = [
  { type: CleanerType.System, labelKey: 'categorySystem', icon: Monitor, descriptionKey: 'categorySystemDescription' },
  {
    type: CleanerType.WinSxS,
    labelKey: 'categoryWinSxS',
    icon: Archive,
    descriptionKey: 'categoryWinSxSDescription',
  },
  {
    type: CleanerType.Browser,
    labelKey: 'categoryBrowsers',
    icon: Globe,
    descriptionKey: 'categoryBrowsersDescription',
  },
  {
    type: CleanerType.App,
    labelKey: 'categoryApplications',
    icon: AppWindow,
    descriptionKey: 'categoryApplicationsDescription',
  },
  { type: CleanerType.Gaming, labelKey: 'categoryGaming', icon: Gamepad2, descriptionKey: 'categoryGamingDescription' },
  {
    type: CleanerType.RecycleBin,
    labelKey: 'categoryRecycleBin',
    icon: Trash2,
    descriptionKey: 'categoryRecycleBinDescription',
  },
  {
    type: CleanerType.Shortcut,
    labelKey: 'categoryShortcuts',
    icon: Link2Off,
    descriptionKey: 'categoryShortcutsDescription',
  },
  {
    type: CleanerType.Environment,
    labelKey: 'categoryEnvironment',
    icon: Variable,
    descriptionKey: 'categoryEnvironmentDescription',
  },
  {
    type: CleanerType.Database,
    labelKey: 'categoryDatabases',
    icon: Database,
    descriptionKey: 'categoryDatabasesDescription',
  },
  {
    type: CleanerType.UninstallLeftovers,
    labelKey: 'categoryUninstallLeftovers',
    icon: PackageX,
    descriptionKey: 'categoryUninstallLeftoversDescription',
  },
]

/** Check whether a path looks like an absolute filesystem path (not a label like "Recycle Bin" or "PATH → …"). */
export const isAbsolutePath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')
