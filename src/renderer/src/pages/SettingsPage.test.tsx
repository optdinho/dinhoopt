// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settingsGet: vi.fn(),
  settingsSet: vi.fn(),
  toastError: vi.fn(),
  setSettings: vi.fn(),
  updateSettings: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('i18next', () => ({
  __esModule: true,
  default: { changeLanguage: vi.fn() },
}))

vi.mock('@/i18n', () => ({
  loadLanguage: vi.fn(),
}))

vi.mock('@/lib/languages', () => ({
  LANGUAGES: [
    { code: 'en', name: 'English', nativeName: 'English' },
    { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  ],
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: mocks.toastError, info: vi.fn(), warning: vi.fn() },
}))

vi.mock('@/hooks/usePlatform', () => ({
  usePlatform: () => ({ platform: 'win32' }),
}))

vi.mock('@/components/layout/PageHeader', () => ({
  PageHeader: () => null,
}))

vi.mock('@/components/shared/LogViewer', () => ({
  LogViewer: () => null,
}))

const defaultSettings = {
  theme: 'dark' as const,
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
  exclusions: [] as string[],
  ignoredSoftwareUpdates: [] as string[],
  backupPath: '',
  backupMode: 'targeted' as const,
  schedule: { enabled: false, frequency: 'weekly' as const, day: 1, hour: 9 },
  schedules: [],
  gameMode: {
    enabledOptimizations: [] as string[],
    customProcessKillList: [] as string[],
    autoDetect: false,
    autoDeactivate: true,
    customGameProcesses: [] as string[],
    gameProfiles: {},
    preconfigVersion: 0,
  },
  registryIgnoredTweaks: [],
  malwareAllowlist: [],
  userProfile: 'general',
}

const mockSettingsState = {
  settings: defaultSettings,
  loaded: true,
  setSettings: mocks.setSettings,
  updateSettings: mocks.updateSettings,
}
vi.mock('@/stores/settings-store', () => ({
  useSettingsStore: (selector?: (s: typeof mockSettingsState) => unknown) =>
    selector ? selector(mockSettingsState) : mockSettingsState,
  refreshSettings: () => {
    window.dinho
      ?.settingsGet?.()
      .then((s: unknown) => mockSettingsState.setSettings(s))
      .catch(() => {})
  },
}))

import { SettingsPage } from './SettingsPage'

describe('SettingsPage — save lê success/error em vez de ignorar o resolve', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(globalThis as any).window = {
      dinho: {
        settingsGet: mocks.settingsGet,
        settingsSet: mocks.settingsSet,
      },
    }
    mocks.settingsGet.mockResolvedValue(defaultSettings)
  })

  it('mantém a alteração optimista sem toast quando settingsSet resolve { success: true }', async () => {
    mocks.settingsSet.mockResolvedValue({ success: true })
    render(<SettingsPage />)

    fireEvent.click(rowControl('autoUpdateLabel', 'button'))

    expect(mocks.settingsSet).toHaveBeenCalledWith({ autoUpdate: false })
    expect(mocks.toastError).not.toHaveBeenCalled()
  })

  it('faz refresh dos settings e tosta erro quando settingsSet resolve { success: false }', async () => {
    mocks.settingsSet.mockResolvedValue({ success: false, error: 'Invalid settings' })
    render(<SettingsPage />)

    fireEvent.change(rowControl('backupModeLabel', 'select'), { target: { value: 'full' } })

    expect(mocks.settingsSet).toHaveBeenCalledWith({ backupMode: 'full' })
    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('settingsSaveFailed')
    })
    await vi.waitFor(() => {
      expect(mocks.settingsGet).toHaveBeenCalledTimes(2)
    })
  })

  it('faz refresh dos settings e tosta erro quando settingsSet rejeita', async () => {
    mocks.settingsSet.mockRejectedValue(new Error('ipc broken'))
    render(<SettingsPage />)

    fireEvent.click(rowControl('autoUpdateLabel', 'button'))

    await vi.waitFor(() => {
      expect(mocks.toastError).toHaveBeenCalledWith('settingsSaveFailed')
    })
    await vi.waitFor(() => {
      expect(mocks.settingsGet).toHaveBeenCalledTimes(2)
    })
  })
})

function rowControl(label: string, selector: 'button' | 'select') {
  const row = screen.getByText(label).closest('div.flex')!
  const control = row.querySelector(selector)!
  return control
}
