import { canonicalGameModeOptimizations } from '@shared/game-mode-preconfig'
import type { DiNhoSettings } from '@shared/types'
import { create } from 'zustand'

interface SettingsState {
  settings: DiNhoSettings
  loaded: boolean
  setSettings: (settings: DiNhoSettings) => void
  updateSettings: (partial: Partial<DiNhoSettings>) => void
}

const defaultSettings: DiNhoSettings = {
  theme: 'dark',
  language: 'en',
  minimizeToTray: false,
  showNotificationOnComplete: true,
  showThreatNotifications: true,
  runAtStartup: false,
  autoUpdate: true,
  autoRestart: true,
  updateCheckIntervalHours: 4,
  autoInstallUpdates: false,
  autoInstallSchedule: null,
  cleaner: {
    skipRecentMinutes: 60,
    secureDelete: false,
    closeBrowsersBeforeClean: false,
    protectRecycleBin: true,
    keepBrowserCookies: true,
  },
  exclusions: [],
  ignoredSoftwareUpdates: [],
  backupPath: '',
  backupMode: 'targeted',
  schedule: {
    enabled: false,
    frequency: 'weekly',
    day: 1,
    hour: 9,
  },
  schedules: [],
  gameMode: {
    enabledOptimizations: canonicalGameModeOptimizations(),
    customProcessKillList: [],
    autoDetect: false,
    autoDeactivate: true,
    customGameProcesses: [],
    gameProfiles: {},
    preconfigVersion: 0,
  },
  registryIgnoredTweaks: [],
  malwareAllowlist: [],
  userProfile: 'general',
}

export const useSettingsStore = create<SettingsState>((set) => ({
  settings: defaultSettings,
  loaded: false,
  setSettings: (settings) => set({ settings, loaded: true }),
  updateSettings: (partial) =>
    set((s) => ({
      settings: {
        ...s.settings,
        ...partial,
        cleaner: { ...s.settings.cleaner, ...(partial.cleaner ?? {}) },
        schedule: { ...s.settings.schedule, ...(partial.schedule ?? {}) },
        // schedules is an array — replace entirely when provided
        schedules: partial.schedules ?? s.settings.schedules,
        gameMode: { ...s.settings.gameMode, ...(partial.gameMode ?? {}) },
      },
    })),
}))

/** Re-fetch settings from main process into the store */
export function refreshSettings(): void {
  window.dinho
    ?.settingsGet?.()
    .then((settings) => {
      useSettingsStore.getState().setSettings(settings)
    })
    .catch(() => {})
}

// Hydrate settings eagerly so pages that depend on them (e.g. ThreatMonitorPage)
// don't see stale defaults before the user visits Settings.
if (typeof window !== 'undefined' && window.dinho) {
  refreshSettings()
}
