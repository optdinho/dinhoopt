import type { IpcMainInvokeEvent } from 'electron'
import { BrowserWindow } from 'electron'

export function validateSender(event: IpcMainInvokeEvent, win: BrowserWindow | null): boolean {
  if (!win) return false
  const senderWin = BrowserWindow.fromWebContents(event.sender)
  return senderWin?.id === win.id
}
