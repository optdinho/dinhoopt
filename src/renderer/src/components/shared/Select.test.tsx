// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { nativeSelectStyle, Select } from './Select'

describe('Select', () => {
  it('applies the theme popup fix by default', () => {
    const { container } = render(
      <Select defaultValue="a">
        <option value="a">A</option>
      </Select>,
    )
    const select = container.querySelector('select')
    expect(select).not.toBeNull()
    expect(select!.style.background).toBe('var(--card-bg)')
    expect(select!.style.color).toBe('var(--text-primary)')
  })

  it('lets the caller override the background but keeps the text colour', () => {
    const { container } = render(
      <Select defaultValue="a" style={{ background: 'var(--bg-subtle)' }}>
        <option value="a">A</option>
      </Select>,
    )
    const select = container.querySelector('select')
    expect(select!.style.background).toBe('var(--bg-subtle)')
    expect(select!.style.color).toBe('var(--text-primary)')
    expect(nativeSelectStyle.background).toBe('var(--card-bg)')
  })

  it('forwards the remaining props and children', () => {
    const { container } = render(
      <Select defaultValue="b" aria-label="pick" data-testid="pick">
        <option value="b">B</option>
      </Select>,
    )
    const select = container.querySelector('select')!
    expect(select.getAttribute('aria-label')).toBe('pick')
    expect(select.getAttribute('data-testid')).toBe('pick')
    expect(select.textContent).toBe('B')
  })
})
