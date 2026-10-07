// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockNavigate = vi.fn()

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('framer-motion', async () => (await import('../../../test-motion-mock')).motionMock)

vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

vi.mock('@/components/history/useTypeConfig', () => ({
  useTypeConfig: () => ({}),
}))

// A store e usada de duas formas: sem selector (HistoryPage) e com selector
// (EmptyState). O mock tem de responder as ambas.
const mockHistoryState = {
  entries: [] as unknown[],
  loaded: true,
  load: vi.fn(),
  clear: vi.fn(),
}
vi.mock('@/stores/history-store', () => ({
  useHistoryStore: (selector?: (s: typeof mockHistoryState) => unknown) =>
    selector ? selector(mockHistoryState) : mockHistoryState,
}))

import { HistoryPage } from './HistoryPage'

describe('HistoryPage — estado vazio', () => {
  beforeEach(() => {
    mockNavigate.mockClear()
  })

  it('navega para /cleaner pela accao de scan, sem sair do router', () => {
    render(<HistoryPage />)

    fireEvent.click(screen.getByText('emptyStateScanAction'))

    // Este e o assert que fixa o bug: hoje o componente faz
    // window.location.assign('/cleaner'), que sai do HashRouter e resolve
    // contra a raiz do documento em vez de navegar.
    expect(mockNavigate).toHaveBeenCalledWith('/cleaner')
  })
})
