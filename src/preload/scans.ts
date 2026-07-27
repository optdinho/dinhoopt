import { IPC } from '@shared/channels'
import type { BloatwareApp, CleanResult, ScanResult } from '@shared/types'
import { ipcRenderer } from 'electron'

function onEvent<T>(channel: string, callback: (data: T) => void): () => void {
  const handler = (_event: Electron.IpcRendererEvent, data: T) => callback(data)
  ipcRenderer.on(channel, handler)
  return () => {
    ipcRenderer.removeListener(channel, handler)
  }
}

export const scanMethods = {
  systemScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SYSTEM_SCAN),
  systemClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.SYSTEM_CLEAN, itemIds),

  browserScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.BROWSER_SCAN),
  browserClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.BROWSER_CLEAN, itemIds),

  appScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.APP_SCAN),
  appClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.APP_CLEAN, itemIds),

  gamingScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.GAMING_SCAN),
  gamingClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.GAMING_CLEAN, itemIds),

  databaseScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.DATABASE_SCAN),
  databaseClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.DATABASE_CLEAN, itemIds),

  uninstallLeftoversScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_SCAN),
  uninstallLeftoversClean: (itemIds: string[]): Promise<CleanResult> =>
    ipcRenderer.invoke(IPC.UNINSTALL_LEFTOVERS_CLEAN, itemIds),

  recycleBinScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.RECYCLE_BIN_SCAN),
  recycleBinClean: (): Promise<CleanResult> => ipcRenderer.invoke(IPC.RECYCLE_BIN_CLEAN),

  shortcutScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.SHORTCUT_SCAN),
  shortcutClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.SHORTCUT_CLEAN, itemIds),

  cleanerOpenLocation: (filePath: string): Promise<void> => ipcRenderer.invoke(IPC.CLEANER_OPEN_LOCATION, filePath),

  environmentScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.ENVIRONMENT_SCAN),
  environmentClean: (itemIds: string[]): Promise<CleanResult> => ipcRenderer.invoke(IPC.ENVIRONMENT_CLEAN, itemIds),

  winSxSScan: (): Promise<ScanResult[]> => ipcRenderer.invoke(IPC.WINSXS_ANALYZE).then((r) => (r ? [r] : [])),
  winSxSClean: (): Promise<CleanResult> => ipcRenderer.invoke(IPC.WINSXS_CLEAN),

  debloaterScan: (): Promise<BloatwareApp[]> => ipcRenderer.invoke(IPC.DEBLOATER_SCAN),
  debloaterRemove: (packageNames: string[]): Promise<{ removed: number; failed: number }> =>
    ipcRenderer.invoke(IPC.DEBLOATER_REMOVE, packageNames),
  onDebloaterRemoveProgress: (
    callback: (data: {
      current: number
      total: number
      currentApp: string
      status: 'removing' | 'done' | 'failed'
    }) => void,
  ) => onEvent(IPC.DEBLOATER_REMOVE_PROGRESS, callback),

  onScanProgress: (callback: (data: import('@shared/types').ProgressData) => void) =>
    onEvent(IPC.SCAN_PROGRESS, callback),
}
