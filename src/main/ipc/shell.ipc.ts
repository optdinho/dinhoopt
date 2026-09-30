import { IPC } from '@shared/channels'
import type { IpcResult } from '@shared/types'
import { ipcMain, shell } from 'electron'
import { getLogger } from '../services/logger.service'

const ALLOWED_PROTOCOLS = new Set(['https:'])

export function registerShellIpc(): void {
  ipcMain.handle(IPC.SHELL_OPEN_EXTERNAL, (_event, url: unknown): IpcResult => {
    if (typeof url !== 'string' || !url) {
      getLogger().warning('shell', 'openExternal blocked: invalid url')
      return { success: false, error: 'Invalid URL' }
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      getLogger().warning('shell', `openExternal blocked: unparseable url ${url}`)
      return { success: false, error: 'Invalid URL' }
    }
    if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) {
      getLogger().warning('shell', `openExternal blocked: protocol ${parsed.protocol}`)
      return { success: false, error: 'Only https URLs are allowed' }
    }
    try {
      void shell.openExternal(parsed.toString())
      return { success: true, data: { opened: true } }
    } catch (err) {
      getLogger().error('shell', `openExternal failed: ${err}`)
      return { success: false, error: 'Could not open the link' }
    }
  })
}
