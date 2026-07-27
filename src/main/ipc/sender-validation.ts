import type { IpcMainInvokeEvent } from 'electron'
import { BrowserWindow } from 'electron'

export function validateSender(event: IpcMainInvokeEvent, win: BrowserWindow | null): boolean {
  const senderWin = BrowserWindow.fromWebContents(event.sender)
  return senderWin?.id === win?.id
}
