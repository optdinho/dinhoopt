import { CleanerType } from '@shared/enums'
import type { LucideIcon } from 'lucide-react'
import {
  AppWindow,
  Archive,
  Database,
  Folder,
  Gamepad2,
  Globe,
  Link2Off,
  Monitor,
  PackageX,
  Trash2,
  Variable,
} from 'lucide-react'

/** Check whether a path looks like an absolute filesystem path (not a label like "Recycle Bin" or "PATH → …"). */
export const isAbsolutePath = (p: string) => /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('/')

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

/** Scan functions by cleaner type */
export const scanFns: Record<CleanerType, () => Promise<unknown>> = {
  [CleanerType.System]: () => window.dinho.systemScan(),
  [CleanerType.WinSxS]: () => window.dinho.winSxSScan(),
  [CleanerType.Browser]: () => window.dinho.browserScan(),
  [CleanerType.App]: () => window.dinho.appScan(),
  [CleanerType.Gaming]: () => window.dinho.gamingScan(),
  [CleanerType.RecycleBin]: () => window.dinho.recycleBinScan(),
  [CleanerType.Shortcut]: () => window.dinho.shortcutScan(),
  [CleanerType.Environment]: () => window.dinho.environmentScan(),
  [CleanerType.Database]: () => window.dinho.databaseScan(),
  [CleanerType.UninstallLeftovers]: () => window.dinho.uninstallLeftoversScan(),
}

/** Clean functions by cleaner type */
export const cleanFns: Record<CleanerType, (ids: string[]) => Promise<unknown>> = {
  [CleanerType.System]: (ids) => window.dinho.systemClean(ids),
  [CleanerType.WinSxS]: () => window.dinho.winSxSClean(),
  [CleanerType.Browser]: (ids) => window.dinho.browserClean(ids),
  [CleanerType.App]: (ids) => window.dinho.appClean(ids),
  [CleanerType.Gaming]: (ids) => window.dinho.gamingClean(ids),
  [CleanerType.RecycleBin]: () => window.dinho.recycleBinClean(),
  [CleanerType.Shortcut]: (ids) => window.dinho.shortcutClean(ids),
  [CleanerType.Environment]: (ids) => window.dinho.environmentClean(ids),
  [CleanerType.Database]: (ids) => window.dinho.databaseClean(ids),
  [CleanerType.UninstallLeftovers]: (ids) => window.dinho.uninstallLeftoversClean(ids),
}
