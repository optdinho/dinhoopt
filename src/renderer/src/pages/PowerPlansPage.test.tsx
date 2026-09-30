// @vitest-environment jsdom
import type { PowerPlanInfo } from '@shared/types'
import { render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  plans: [] as PowerPlanInfo[],
  activeGuid: null as string | null,
  loading: false,
  activating: false,
  unlockingUltimate: false,
  error: null as string | null,
}))

const actions = {
  loadPlans: vi.fn(),
  activatePlan: vi.fn(),
  deletePlan: vi.fn(),
  createPlan: vi.fn(),
  unlockUltimate: vi.fn(),
  clearError: vi.fn(),
}

vi.mock('@/stores/power-plans-store', () => ({
  usePowerPlansStore: () => ({ ...mocks, ...actions }),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { PowerPlansPage } from './PowerPlansPage'

const ULTIMATE_GUID = 'e9a42b02-d5df-448d-aa00-03f14749eb61'
const BALANCED_GUID = '381b4222-f694-41f0-9685-ff5bb260df2e'

function plan(over: Partial<PowerPlanInfo> = {}): PowerPlanInfo {
  return {
    guid: BALANCED_GUID,
    name: 'Equilibrado',
    description: '',
    isActive: false,
    isHighPerformance: false,
    isBalanced: true,
    isPowerSaver: false,
    isUltimatePerformance: false,
    ...over,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.plans = []
  mocks.activeGuid = null
  mocks.loading = false
  mocks.activating = false
  mocks.unlockingUltimate = false
  mocks.error = null
})

describe('PowerPlansPage ultimate performance', () => {
  it('loads plans on mount', () => {
    render(<PowerPlansPage />)
    expect(actions.loadPlans).toHaveBeenCalled()
  })

  it('offers to unlock Ultimate Performance when it is missing', () => {
    mocks.plans = [plan()]
    render(<PowerPlansPage />)
    expect(screen.getByText('unlockUltimate')).not.toBeNull()
  })

  it('hides the unlock action once Ultimate Performance exists', () => {
    mocks.plans = [plan(), plan({ guid: ULTIMATE_GUID, name: 'Ultimate', isUltimatePerformance: true })]
    render(<PowerPlansPage />)
    expect(screen.queryByText('unlockUltimate')).toBeNull()
  })

  it('treats a plan carrying the official Ultimate GUID as Ultimate', () => {
    mocks.plans = [plan(), plan({ guid: ULTIMATE_GUID, name: 'Desempenho Máximo', isUltimatePerformance: false })]
    render(<PowerPlansPage />)
    expect(screen.queryByText('unlockUltimate')).toBeNull()
  })

  it('unlocks on click', async () => {
    mocks.plans = [plan()]
    render(<PowerPlansPage />)
    screen.getByText('unlockUltimate').click()
    expect(actions.unlockUltimate).toHaveBeenCalled()
  })

  it('disables the unlock action while unlocking', () => {
    mocks.plans = [plan()]
    mocks.unlockingUltimate = true
    render(<PowerPlansPage />)
    expect((screen.getByText('unlockUltimate').closest('button') as HTMLButtonElement).disabled).toBe(true)
  })
})

describe('PowerPlansPage layout', () => {
  it('separates stock plans from custom ones', () => {
    mocks.plans = [plan(), plan({ guid: 'custom-1', name: 'Meu plano', isBalanced: false })]
    render(<PowerPlansPage />)
    expect(screen.getByTestId('group-stock')).not.toBeNull()
    expect(screen.getByTestId('group-custom')).not.toBeNull()
  })

  it('omits the custom group when every plan is stock', () => {
    mocks.plans = [plan()]
    render(<PowerPlansPage />)
    expect(screen.queryByTestId('group-custom')).toBeNull()
  })

  it('keeps custom plans inside the custom group', () => {
    mocks.plans = [plan(), plan({ guid: 'custom-1', name: 'Meu plano', isBalanced: false })]
    render(<PowerPlansPage />)
    const custom = screen.getByTestId('group-custom')
    expect(within(custom).getByText('Meu plano')).not.toBeNull()
    expect(within(custom).queryByText('Equilibrado')).toBeNull()
  })

  it('shows the active plan name in the header', () => {
    mocks.plans = [plan({ name: 'Alto Desempenho', isActive: true, isHighPerformance: true })]
    mocks.activeGuid = 'g1'
    render(<PowerPlansPage />)
    const hero = screen.getByTestId('active-plan-hero')
    expect(within(hero).getByText('Alto Desempenho')).not.toBeNull()
  })

  it('offers delete only on non-active plans', () => {
    mocks.plans = [plan({ guid: 'a', name: 'Ativo', isActive: true }), plan({ guid: 'b', name: 'Outro' })]
    mocks.activeGuid = 'a'
    render(<PowerPlansPage />)
    const other = screen.getByText('Outro').closest('button, div')?.parentElement?.parentElement
    expect(within(other as HTMLElement).getByTitle('delete')).not.toBeNull()
  })

  it('surfaces store errors', () => {
    mocks.error = 'Falha ao carregar'
    render(<PowerPlansPage />)
    expect(screen.getByText('Falha ao carregar')).not.toBeNull()
  })
})
