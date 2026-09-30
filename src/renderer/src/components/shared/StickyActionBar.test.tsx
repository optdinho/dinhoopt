// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { StickyActionBar } from './StickyActionBar'

function renderBar(overrides: Partial<React.ComponentProps<typeof StickyActionBar>> = {}) {
  const props = {
    selectedCount: 3,
    totalLabel: 'itens selecionados',
    onAction: vi.fn(),
    actionLabel: 'Limpar',
    ...overrides,
  }
  render(<StickyActionBar {...props} />)
  return props
}

describe('StickyActionBar', () => {
  it('stays hidden when nothing is selected', () => {
    renderBar({ selectedCount: 0 })
    expect(screen.queryByTestId('sticky-action-bar')).toBeNull()
  })

  it('shows the amount of items and the action', () => {
    renderBar()
    expect(screen.getByTestId('sticky-action-bar').textContent).toContain('3')
    expect(screen.getByTestId('sticky-action-bar').textContent).toContain('itens selecionados')
  })

  it('runs the action when the button is pressed', () => {
    const onAction = vi.fn()
    renderBar({ onAction })
    screen.getByRole('button', { name: /Limpar/ }).click()
    expect(onAction).toHaveBeenCalledTimes(1)
  })

  it('is pinned to the window but never covers the sidebar', () => {
    renderBar()
    const el = screen.getByTestId('sticky-action-bar')
    expect(el.className).toContain('fixed')
    expect(el.className).toContain('bottom-0')
    expect(el.className).toContain('right-0')
    expect(el.style.left).toBe('var(--sidebar-w, 250px)')
  })

  it('takes the sidebar width from a variable, never a hardcoded offset', () => {
    renderBar()
    const el = screen.getByTestId('sticky-action-bar')
    expect(el.style.left).toContain('var(--sidebar-w')
    expect(el.className).not.toMatch(/left-\[/)
  })

  it('keeps its content aligned with the page padding', () => {
    renderBar()
    const cls = screen.getByTestId('sticky-action-bar').className
    expect(cls).toContain('px-4')
    expect(cls).toContain('lg:px-10')
    expect(cls).not.toContain('-mx-')
  })

  it('sits above the page content', () => {
    renderBar()
    expect(screen.getByTestId('sticky-action-bar').className).toContain('z-40')
  })
})
