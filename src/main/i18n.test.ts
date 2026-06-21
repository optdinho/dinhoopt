import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../renderer/src/locales/pt/tray.json', () => ({
  default: {
    trayTooltip: 'DiNho Optimizer',
    scheduledTaskNotificationBody: 'A executar "{{name}}"...',
    scanCompleteNotificationBody: 'Foram encontrados {{itemCount}} itens ({{sizeMB}} MB) que podem ser limpos.',
  },
}))

const mockGetSettings = vi.fn()
vi.mock('./services/settings-store', () => ({
  getSettings: () => mockGetSettings(),
}))

import { t } from './i18n'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('t', () => {
  it('returns translation when key exists in language', () => {
    mockGetSettings.mockReturnValue({ language: 'pt' })
    expect(t('trayTooltip')).toBe('DiNho Optimizer')
  })

  it('returns key itself when key does not exist in any language', () => {
    mockGetSettings.mockReturnValue({ language: 'pt' })
    expect(t('nonexistent.key')).toBe('nonexistent.key')
  })

  it('falls back to pt when language setting is missing', () => {
    mockGetSettings.mockReturnValue({})
    expect(t('trayTooltip')).toBe('DiNho Optimizer')
  })

  it('falls back to pt when settings throws', () => {
    mockGetSettings.mockImplementation(() => {
      throw new Error('Settings unavailable')
    })
    expect(t('trayTooltip')).toBe('DiNho Optimizer')
  })

  it('returns key itself when settings throws and key is missing from pt', () => {
    mockGetSettings.mockImplementation(() => {
      throw new Error('Settings unavailable')
    })
    expect(t('missing.key')).toBe('missing.key')
  })

  it('replaces params in translation string', () => {
    mockGetSettings.mockReturnValue({ language: 'pt' })
    expect(t('scheduledTaskNotificationBody', { name: 'Teste' })).toBe('A executar "Teste"...')
  })

  it('replaces multiple params in translation string', () => {
    mockGetSettings.mockReturnValue({ language: 'pt' })
    expect(t('scanCompleteNotificationBody', { itemCount: 42, sizeMB: 12.5 })).toBe(
      'Foram encontrados 42 itens (12.5 MB) que podem ser limpos.',
    )
  })

  it('returns string unchanged when no params provided', () => {
    mockGetSettings.mockReturnValue({ language: 'pt' })
    const result = t('trayTooltip')
    expect(result).toBe('DiNho Optimizer')
  })

  it('replaces missing param key with empty string', () => {
    mockGetSettings.mockReturnValue({ language: 'pt' })
    expect(t('scheduledTaskNotificationBody', {})).toBe('A executar ""...')
  })
})
