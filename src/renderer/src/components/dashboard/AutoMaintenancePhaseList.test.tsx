// @vitest-environment jsdom

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

import { AutoMaintenancePhaseList } from './AutoMaintenancePhaseList'
import { DEFAULT_AUTO_MAINTENANCE_OPTIONS } from './auto-maintenance'

function renderList(overrides: { hasRegistry?: boolean; hasDrivers?: boolean } = {}) {
  const onChange = vi.fn()
  render(
    <AutoMaintenancePhaseList
      options={DEFAULT_AUTO_MAINTENANCE_OPTIONS}
      onChange={onChange}
      hasRegistry={overrides.hasRegistry ?? true}
      hasDrivers={overrides.hasDrivers ?? true}
    />,
  )
  return onChange
}

describe('AutoMaintenancePhaseList', () => {
  it('renders every phase when registry and drivers are supported', () => {
    renderList()

    expect(screen.getAllByRole('checkbox')).toHaveLength(6)
    expect(screen.getByText('autoMaintenanceOptionsHeading')).toBeTruthy()
  })

  it('hides registry and drivers when the platform does not support them', () => {
    renderList({ hasRegistry: false, hasDrivers: false })

    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.queryByText('autoMaintenancePhaseRegistry')).toBeNull()
    expect(screen.queryByText('autoMaintenancePhaseDrivers')).toBeNull()
  })

  it('reflects the selected state through aria-checked', () => {
    renderList()

    expect(
      screen.getByRole('checkbox', { name: /autoMaintenancePhaseSystemRepair/ }).getAttribute('aria-checked'),
    ).toBe('true')
  })

  it('reports the phase that was toggled', () => {
    const onChange = renderList()

    fireEvent.click(screen.getByRole('checkbox', { name: /autoMaintenancePhaseSoftware/ }))

    expect(onChange).toHaveBeenCalledWith('softwareUpdates')
  })
})
