import { IPC } from '@shared/channels'
import type {
  CleanResult,
  ScanResult,
} from '@shared/types'
import { ipcRenderer } from 'electron'

export const cleanerApi = {
  // System cleaner
  systemScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SYSTEM_SCAN),
  systemClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.SYSTEM_CLEAN, itemIds),

  // Browser cleaner
  browserScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.BROWSER_SCAN),
  browserClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.BROWSER_CLEAN, itemIds),

  // App cleaner
  appScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.APP_SCAN),
  appClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.APP_CLEAN, itemIds),

  // Gaming cleaner
  gamingScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.GAMING_SCAN),
  gamingClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.GAMING_CLEAN, itemIds),

  // Database optimizer
  databaseScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.DATABASE_SCAN),
  databaseClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.DATABASE_CLEAN, itemIds),

  // Uninstall leftovers
  uninstallLeftoversScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_SCAN),
  uninstallLeftoversClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_CLEAN, itemIds),

  // Recycle bin
  recycleBinScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.RECYCLE_BIN_SCAN),
  recycleBinClean: (): Promise<CleanResult> => ipcRenderer.invoke(IPC.RECYCLE_BIN_CLEAN),

  // Shortcut cleaner
  shortcutScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SHORTCUT_SCAN),
  shortcutClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.SHORTCUT_CLEAN, itemIds),

  // Cleaner: open location
  cleanerOpenLocation: (filePath: string): Promise<void> => ipcRenderer.invoke(IPC.CLEANER_OPEN_LOCATION, filePath),

  // Environment cleaner
  environmentScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.ENVIRONMENT_SCAN),
  environmentClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.ENVIRONMENT_CLEAN, itemIds),

  // WinSxS Cleaner
  winSxSScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.WINSXS_ANALYZE).then((r) => (r ? [r] : [])),
  winSxSClean: (): Promise<CleanResult> => ipcRenderer.invoke(IPC.WINSXS_CLEAN),
}
