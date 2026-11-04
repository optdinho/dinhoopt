// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('framer-motion', async () => (await import('../../../../test-motion-mock')).motionMock)
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { ConfirmDialog } from './ConfirmDialog'

function renderDialog(props: { open: boolean; children?: React.ReactNode }) {
  return render(
    <ConfirmDialog
      open={props.open}
      onConfirm={vi.fn()}
      onCancel={vi.fn()}
      title="title"
      description="description"
      confirmLabel="confirm"
    >
      {props.children}
    </ConfirmDialog>,
  )
}

describe('ConfirmDialog', () => {
  it('renders nothing while closed', () => {
    renderDialog({ open: false, children: <p>extra content</p> })

    expect(screen.queryByText('extra content')).toBeNull()
  })

  it('renders the optional children slot inside the dialog', () => {
    renderDialog({ open: true, children: <p>extra content</p> })

    expect(screen.getByText('extra content')).toBeTruthy()
    expect(screen.getByText('description')).toBeTruthy()
    expect(screen.getByText('confirm')).toBeTruthy()
  })

  it('renders without children', () => {
    renderDialog({ open: true })

    expect(screen.getByText('description')).toBeTruthy()
  })
})
