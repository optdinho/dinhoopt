// @vitest-environment jsdom

import type { ContextMenuApplyResult } from '@shared/types'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ApplyResultCard } from './ApplyResultCard'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('lucide-react', () => {
  const Icon = ({ children, ...props }: { children?: React.ReactNode }) => <div {...props}>{children}</div>
  return { CircleCheckBig: Icon }
})

vi.mock('@/stores/context-menu-store', () => ({
  useContextMenuStore: { getState: () => ({ setShowErrors: vi.fn() }) },
}))

const resultWithErrors: ContextMenuApplyResult = {
  succeeded: 1,
  failed: 2,
  errors: [
    { entryId: 'a', displayName: 'First', reason: 'one' },
    { entryId: 'b', displayName: 'Second', reason: 'two' },
  ],
  updates: [],
}

describe('ApplyResultCard', () => {
  it('renders null when result is null', () => {
    const { container } = render(<ApplyResultCard result={null} showErrors />)
    expect(container.firstChild).toBeNull()
  })

  it('hides error list when showErrors is false', () => {
    render(<ApplyResultCard result={resultWithErrors} showErrors={false} />)
    expect(screen.queryByText('First')).toBeNull()
  })

  it('shows a divider between errors but none after the last one', () => {
    const { container } = render(<ApplyResultCard result={resultWithErrors} showErrors />)
    const errorRows = container.querySelectorAll<HTMLElement>('div.px-5')
    expect(errorRows).toHaveLength(2)
    expect(errorRows[0]!.style.borderBottom).toBe('1px solid var(--bg-subtle)')
    expect(errorRows[1]!.style.borderBottomStyle).toBe('none')
  })
})
