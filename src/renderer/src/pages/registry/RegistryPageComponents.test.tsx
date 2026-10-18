// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import type { RegistryEntry } from '@shared/types'

import { cards, RegistryCardsSection, typeColors, typeKeyMap } from './RegistryPageComponents'

const t = (key: string, params?: Record<string, unknown>): string => (params ? `${key}:${JSON.stringify(params)}` : key)

function entry(overrides: Partial<RegistryEntry> = {}): RegistryEntry {
  return {
    id: 'entry-1',
    type: 'obsolete',
    keyPath: 'HKLM\\SOFTWARE\\Test',
    valueName: 'OldValue',
    issue: 'Obsolete value',
    risk: 'low',
    selected: true,
    ...overrides,
  }
}

function renderSection(onToggleEntry: (id: string) => void, entries: RegistryEntry[]): void {
  render(
    <RegistryCardsSection
      entries={entries}
      expandedCards={new Set([0])}
      fixing={false}
      onToggleCardAll={() => {}}
      onToggleCardExpand={() => {}}
      onToggleEntry={onToggleEntry}
      t={t}
    />,
  )
}

describe('RegistryCardsSection entry checkbox keyboard handling (a11y)', () => {
  it('does NOT toggle the entry when Tab is pressed', () => {
    const onToggleEntry = vi.fn()
    renderSection(onToggleEntry, [entry()])
    const checkbox = screen.getByTestId('entry-toggle')
    fireEvent.keyDown(checkbox, { key: 'Tab' })
    expect(onToggleEntry).not.toHaveBeenCalled()
  })

  it('toggles the entry when Enter is pressed', () => {
    const onToggleEntry = vi.fn()
    renderSection(onToggleEntry, [entry()])
    const checkbox = screen.getByTestId('entry-toggle')
    fireEvent.keyDown(checkbox, { key: 'Enter' })
    expect(onToggleEntry).toHaveBeenCalledWith('entry-1')
  })

  it('toggles the entry when Space is pressed', () => {
    const onToggleEntry = vi.fn()
    renderSection(onToggleEntry, [entry()])
    const checkbox = screen.getByTestId('entry-toggle')
    fireEvent.keyDown(checkbox, { key: ' ' })
    expect(onToggleEntry).toHaveBeenCalledWith('entry-1')
  })
})

describe('card totalChecks match what the scanners can actually report', () => {
  it('security card counts the 11 checks scanSecurity performs', () => {
    const securityCard = cards.find((c) => c.titleKey === 'cardSecurity')
    expect(securityCard?.totalChecks).toBe(11)
  })

  it('services card counts the only service check (Fax)', () => {
    const servicesCard = cards.find((c) => c.titleKey === 'cardServices')
    expect(servicesCard?.totalChecks).toBe(1)
  })
})

describe('entry type maps only carry types the scanner can actually produce', () => {
  it('does not keep a never-produced privacy entry type', () => {
    expect(Object.keys(typeKeyMap)).not.toContain('privacy')
    expect(Object.keys(typeColors)).not.toContain('privacy')
  })
})

describe('services card description matches the scanner coverage', () => {
  it.each(['pt', 'en', 'es'])('does not claim a Print Spooler check in %s locale', (locale) => {
    const locales = import.meta.glob('../../locales/*/registry.json', { eager: true, import: 'default' })
    const registry = (locales[`../../locales/${locale}/registry.json`] ?? {}) as Record<string, string>
    expect(registry.cardServicesDescription).toBeTruthy()
    expect(registry.cardServicesDescription).not.toMatch(/spooler|cola de impress/i)
  })
})
