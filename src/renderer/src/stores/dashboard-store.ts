import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { create } from 'zustand'

interface CleanerScanFn {
  type: CleanerType
  scan: () => Promise<ScanResult[]>
  clean: (ids: string[]) => Promise<CleanResult>
}

interface DashboardState {
  cleanerFns: CleanerScanFn[]
}

export const useDashboardStore = create<DashboardState>(() => ({
  cleanerFns: [
    { type: CleanerType.System, scan: () => window.dinho.systemScan(), clean: (ids) => window.dinho.systemClean(ids) },
    {
      type: CleanerType.WinSxS,
      scan: () => window.dinho.winSxSScan(),
      clean: () => window.dinho.winSxSClean(),
    },
    {
      type: CleanerType.Browser,
      scan: () => window.dinho.browserScan(),
      clean: (ids) => window.dinho.browserClean(ids),
    },
    { type: CleanerType.App, scan: () => window.dinho.appScan(), clean: (ids) => window.dinho.appClean(ids) },
    {
      type: CleanerType.Gaming,
      scan: () => window.dinho.gamingScan(),
      clean: (ids) => window.dinho.gamingClean(ids),
    },
    {
      type: CleanerType.RecycleBin,
      scan: () => window.dinho.recycleBinScan(),
      clean: () => window.dinho.recycleBinClean(),
    },
    {
      type: CleanerType.Shortcut,
      scan: () => window.dinho.shortcutScan(),
      clean: (ids) => window.dinho.shortcutClean(ids),
    },
    {
      type: CleanerType.Environment,
      scan: () => window.dinho.environmentScan(),
      clean: (ids) => window.dinho.environmentClean(ids),
    },
    {
      type: CleanerType.Database,
      scan: () => window.dinho.databaseScan(),
      clean: (ids) => window.dinho.databaseClean(ids),
    },
    {
      type: CleanerType.UninstallLeftovers,
      scan: () => window.dinho.uninstallLeftoversScan(),
      clean: (ids) => window.dinho.uninstallLeftoversClean(ids),
    },
  ],
}))
