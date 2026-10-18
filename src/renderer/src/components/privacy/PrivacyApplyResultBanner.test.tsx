// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PrivacyApplyResultBanner } from './PrivacyApplyResultBanner'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

function renderBanner(applyResult: { succeeded: number; failed: number; errors: unknown[] } | null) {
  const onDismiss = vi.fn()
  const utils = render(
    <PrivacyApplyResultBanner applyResult={applyResult as never} status="done" onDismiss={onDismiss} />,
  )
  return { ...utils, onDismiss }
}

describe('PrivacyApplyResultBanner', () => {
  it('renders nothing when there is no apply result', () => {
    const { container } = renderBanner(null)
    expect(container.textContent).toBe('')
  })

  it('shows the failure heading when every setting failed', () => {
    renderBanner({ succeeded: 0, failed: 2, errors: [{ id: 'a', label: 'A', reason: 'x' }] })
    expect(screen.getByText('privacy.applyResultFailedTitle')).toBeTruthy()
    expect(screen.queryByText('privacy.settingsAppliedPlural')).toBeNull()
  })

  it('keeps the success heading and shows the failed count for a partial success', () => {
    renderBanner({ succeeded: 2, failed: 1, errors: [] })
    expect(screen.getByText('privacy.settingsAppliedPlural')).toBeTruthy()
    expect(screen.queryByText('privacy.applyResultFailedTitle')).toBeNull()
    expect(screen.getByText('privacy.settingsFailedRequireAdmin')).toBeTruthy()
  })

  it('does not blame the administrator when concrete error details are listed', () => {
    renderBanner({
      succeeded: 2,
      failed: 1,
      errors: [{ id: 'a', label: 'A', reason: "Service 'DiagTrack' does not exist" }],
    })
    expect(screen.getByText('privacy.settingsAppliedPlural')).toBeTruthy()
    expect(screen.queryByText('privacy.settingsFailedRequireAdmin')).toBeNull()
    expect(screen.getByText('privacy.settingsFailedDetails')).toBeTruthy()
    expect(screen.getByText(/A: Service 'DiagTrack' does not exist/)).toBeTruthy()
  })

  it('shows the success heading and no failed count when nothing failed', () => {
    renderBanner({ succeeded: 3, failed: 0, errors: [] })
    expect(screen.getByText('privacy.settingsAppliedPlural')).toBeTruthy()
    expect(screen.queryByText('privacy.settingsFailedRequireAdmin')).toBeNull()
  })

  it('calls onDismiss when the close button is clicked', () => {
    const { onDismiss } = renderBanner({ succeeded: 3, failed: 0, errors: [] })
    fireEvent.click(screen.getByLabelText('privacy.dismiss'))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
