// @vitest-environment jsdom
import type { WindowsTweakDef } from '@shared/types'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tMock, translations } = vi.hoisted(() => ({
  tMock: vi.fn(),
  translations: new Map<string, string>(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: tMock }),
}))

vi.mock('lucide-react', () => {
  const Icon = () => <span />
  return { Check: Icon, CircleCheckBig: Icon }
})

import { TweakRow } from './TweakRow'

const TWEAK = {
  id: 'menu-show-delay',
  name: 'Menu Show Delay — 0ms',
  description: 'Remove delay de abertura de menus no Windows',
  category: 'system',
  level: 'basico',
  hive: 'HKCU',
  path: 'Control Panel\\Desktop',
  key: 'MenuShowDelay',
  kind: 'DWORD',
  optimizedValue: 0,
} as unknown as WindowsTweakDef

function renderRow(overrides: Partial<{ selected: boolean; applied: boolean }> = {}) {
  const onToggle = vi.fn()
  const utils = render(
    <TweakRow
      tweak={TWEAK}
      applied={overrides.applied ?? false}
      selected={overrides.selected ?? false}
      accentColor="#22d3ee"
      accentGlow="rgba(34,211,238,0.12)"
      index={0}
      onToggle={onToggle}
    />,
  )
  return { ...utils, onToggle }
}

describe('TweakRow', () => {
  beforeEach(() => {
    translations.clear()
    tMock.mockReset()
    tMock.mockImplementation((key: string, defaultValue: string) => translations.get(key) ?? defaultValue)
  })

  it('renders the translated name when the locale has the key', () => {
    translations.set('tweaks.menu-show-delay.name', 'Menu sem atraso')
    renderRow()
    expect(screen.getByText('Menu sem atraso')).toBeTruthy()
    expect(screen.queryByText('Menu Show Delay — 0ms')).toBeNull()
  })

  it('falls back to the catalog name when the locale has no key', () => {
    renderRow()
    expect(screen.getByText('Menu Show Delay — 0ms')).toBeTruthy()
    expect(tMock).toHaveBeenCalledWith('tweaks.menu-show-delay.name', 'Menu Show Delay — 0ms')
  })

  it('renders the translated description when the locale has the key', () => {
    translations.set('tweaks.menu-show-delay.description', 'Remove o atraso dos menus')
    renderRow()
    expect(screen.getByText('Remove o atraso dos menus')).toBeTruthy()
    expect(screen.queryByText('Remove delay de abertura de menus no Windows')).toBeNull()
  })

  it('reverts to the catalog description when the locale has no key', () => {
    renderRow()
    expect(screen.getByText('Remove delay de abertura de menus no Windows')).toBeTruthy()
    expect(tMock).toHaveBeenCalledWith(
      'tweaks.menu-show-delay.description',
      'Remove delay de abertura de menus no Windows',
    )
  })

  it('toggles on click', () => {
    const onToggle = vi.fn()
    render(
      <TweakRow
        tweak={TWEAK}
        applied={false}
        selected={false}
        accentColor="#22d3ee"
        accentGlow="rgba(34,211,238,0.12)"
        index={0}
        onToggle={onToggle}
      />,
    )
    fireEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledWith('menu-show-delay')
  })

  it('toggles on Enter', () => {
    const onToggle = vi.fn()
    render(
      <TweakRow
        tweak={TWEAK}
        applied={false}
        selected={false}
        accentColor="#22d3ee"
        accentGlow="rgba(34,211,238,0.12)"
        index={0}
        onToggle={onToggle}
      />,
    )
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' })
    expect(onToggle).toHaveBeenCalledWith('menu-show-delay')
  })

  it('toggles on Space and prevents the default scroll', () => {
    const onToggle = vi.fn()
    render(
      <TweakRow
        tweak={TWEAK}
        applied={false}
        selected={false}
        accentColor="#22d3ee"
        accentGlow="rgba(34,211,238,0.12)"
        index={0}
        onToggle={onToggle}
      />,
    )
    const notCancelled = fireEvent.keyDown(screen.getByRole('button'), { key: ' ' })
    expect(onToggle).toHaveBeenCalledWith('menu-show-delay')
    expect(notCancelled).toBe(false)
  })

  it('does not toggle on Tab', () => {
    const onToggle = vi.fn()
    render(
      <TweakRow
        tweak={TWEAK}
        applied={false}
        selected={false}
        accentColor="#22d3ee"
        accentGlow="rgba(34,211,238,0.12)"
        index={0}
        onToggle={onToggle}
      />,
    )
    fireEvent.keyDown(screen.getByRole('button'), { key: 'Tab' })
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('exposes the selection state through aria-pressed', () => {
    const { unmount } = render(
      <TweakRow
        tweak={TWEAK}
        applied={false}
        selected={true}
        accentColor="#22d3ee"
        accentGlow="rgba(34,211,238,0.12)"
        index={0}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
    unmount()
    render(
      <TweakRow
        tweak={TWEAK}
        applied={false}
        selected={false}
        accentColor="#22d3ee"
        accentGlow="rgba(34,211,238,0.12)"
        index={0}
        onToggle={vi.fn()}
      />,
    )
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('false')
  })
})
