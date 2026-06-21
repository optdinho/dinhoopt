// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('./constants', () => ({
  typeConfigBase: {
    cleaner: { labelKey: 'typeLabels.cleaner', icon: 'Sparkles', color: '#f59e0b', bg: 'rgba(245,158,11,0.1)' },
    registry: { labelKey: 'typeLabels.registry', icon: 'Database', color: '#3b82f6', bg: 'rgba(59,130,246,0.1)' },
    debloater: { labelKey: 'typeLabels.debloater', icon: 'PackageMinus', color: '#a855f7', bg: 'rgba(168,85,247,0.1)' },
    drivers: { labelKey: 'typeLabels.drivers', icon: 'Cpu', color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)' },
  },
}))

import { useTypeConfig } from './useTypeConfig'

describe('useTypeConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns config with translated labels', () => {
    const { result } = renderHook(() => useTypeConfig())

    expect(result.current).toHaveProperty('cleaner')
    expect(result.current).toHaveProperty('registry')
    expect(result.current).toHaveProperty('debloater')
    expect(result.current).toHaveProperty('drivers')
  })

  it('replaces labelKey with translated value', () => {
    const { result } = renderHook(() => useTypeConfig())

    expect(result.current.cleaner.label).toBe('typeLabels.cleaner')
    expect(result.current.registry.label).toBe('typeLabels.registry')
  })

  it('preserves icon, color, bg from base config', () => {
    const { result } = renderHook(() => useTypeConfig())

    expect(result.current.cleaner.icon).toBe('Sparkles')
    expect(result.current.cleaner.color).toBe('#f59e0b')
    expect(result.current.cleaner.bg).toBe('rgba(245,158,11,0.1)')
  })
})
