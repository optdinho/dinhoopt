// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { useRegistryStore } from '@/stores/registry-store'

import { FixResultCard } from './FixResultCard'

function seed(fixResult: Record<string, unknown>): void {
  useRegistryStore.setState({ fixResult: fixResult as never, showFailures: false })
}

describe('FixResultCard backup warning (A1)', () => {
  beforeEach(() => {
    useRegistryStore.setState({ fixResult: null, showFailures: false })
  })

  it('renders the fixed count when the backup succeeded', () => {
    seed({ fixed: 12, failed: 0, failures: [], backupFailed: false })
    render(<FixResultCard />)
    expect(screen.getByTestId('fix-result-card')).not.toBeNull()
    expect(screen.queryByTestId('backup-failed-warning')).toBeNull()
  })

  it('warns that no restore point exists when the backup failed', () => {
    seed({ fixed: 12, failed: 0, failures: [], backupFailed: true })
    render(<FixResultCard />)
    expect(screen.getByTestId('backup-failed-warning')).not.toBeNull()
    expect(screen.getByText('backupFailedWarning')).not.toBeNull()
  })

  it('shows the warning even when every entry was fixed', () => {
    seed({ fixed: 3, failed: 0, failures: [], backupFailed: true })
    render(<FixResultCard />)
    expect(screen.getByText('fixedEntries')).not.toBeNull()
    expect(screen.getByTestId('backup-failed-warning')).not.toBeNull()
  })

  it('shows the warning alongside failures too', () => {
    seed({
      fixed: 1,
      failed: 2,
      failures: [{ issue: 'a', reason: 'b' }],
      backupFailed: true,
      showFailures: true,
    })
    useRegistryStore.setState({ showFailures: true })
    render(<FixResultCard />)
    expect(screen.getByTestId('backup-failed-warning')).not.toBeNull()
    expect(screen.getByRole('button', { name: /failedCount/ })).not.toBeNull()
  })

  it('renders nothing when there is no result yet', () => {
    render(<FixResultCard />)
    expect(screen.queryByTestId('fix-result-card')).toBeNull()
    expect(screen.queryByTestId('backup-failed-warning')).toBeNull()
  })
})
