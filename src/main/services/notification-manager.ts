import { Notification } from 'electron'

/**
 * Show a tray notification if the user has notifications enabled.
 * Silent = false so Windows plays the default notification sound.
 */
export function notifyScanComplete(title: string, body: string, settings: { notifications: boolean }): void {
  if (!settings.notifications) return
  if (!Notification.isSupported()) return
  new Notification({ title, body, silent: false }).show()
}
