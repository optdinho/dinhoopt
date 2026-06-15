// Win32 startup management delegates to the existing startup-manager.ipc.ts
// which contains all the registry + Task Scheduler logic.
// We re-export through the platform interface so darwin/linux can provide alternatives.

import type { StartupBootTrace, StartupItem } from '@shared/types'
import type { PlatformStartup } from '../types'

// These imports will be lazy to avoid circular dependency issues at module load.
// The IPC module exports these functions for direct use.

export function createWin32Startup(): PlatformStartup {
  return {
    async listItems(): Promise<StartupItem[]> {
      const { listStartupItems } = require('../../ipc/startup-manager.ipc')
      return listStartupItems()
    },

    async toggleItem(
      name: string,
      location: string,
      command: string,
      source: StartupItem['source'],
      enabled: boolean,
    ): Promise<boolean> {
      const { toggleStartupItem } = require('../../ipc/startup-manager.ipc')
      return toggleStartupItem(name, location, command, source, enabled)
    },

    async getBootTrace(): Promise<StartupBootTrace> {
      const { getBootTrace } = require('../../ipc/startup-manager.ipc')
      return getBootTrace()
    },
  }
}
