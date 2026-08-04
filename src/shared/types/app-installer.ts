export type AppInstallerCategory =
  | 'development'
  | 'browser'
  | 'media'
  | 'productivity'
  | 'communication'
  | 'system'
  | 'gaming'
  | 'utilities'

export interface AppInstallerApp {
  id: string
  name: string
  category: AppInstallerCategory
  description?: string
  isInstalled: boolean
  installedVersion?: string
}

export interface AppInstallerListResult {
  apps: AppInstallerApp[]
  wingetAvailable: boolean
}

export interface AppInstallProgress {
  phase: 'installing' | 'done' | 'failed'
  current: number
  total: number
  currentApp: string
  percent: number
  status: 'in-progress' | 'done' | 'failed'
  error?: string
}

export interface AppInstallResult {
  succeeded: number
  failed: number
  errors: Array<{ appId: string; name: string; reason: string }>
}
