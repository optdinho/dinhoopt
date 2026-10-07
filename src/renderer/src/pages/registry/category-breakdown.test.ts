import type { RegistryEntry } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { buildRegistryCategories } from './category-breakdown'

function entry(type: RegistryEntry['type']): RegistryEntry {
  return {
    id: `id-${type}`,
    type,
    keyPath: 'HKLM\\SOFTWARE\\Test',
    valueName: 'Value',
    issue: 'Test issue',
    risk: 'medium',
    selected: true,
  }
}

describe('buildRegistryCategories (F6)', () => {
  it('usa fixedByType real em vez de distribuir proporcionalmente', () => {
    const entries = [entry('obsolete'), entry('obsolete'), entry('task')]
    const byType = buildRegistryCategories(entries, { obsolete: 2, task: 0 })
    expect(byType.obsolete).toEqual({ found: 2, fixed: 2 })
    expect(byType.task).toEqual({ found: 1, fixed: 0 })
  })

  it('completa com zero os tipos fixados que não foram encontrados na seleção', () => {
    const entries = [entry('obsolete'), entry('service')]
    const byType = buildRegistryCategories(entries, { vulnerability: 3 })
    expect(byType.obsolete).toEqual({ found: 1, fixed: 0 })
    expect(byType.service).toEqual({ found: 1, fixed: 0 })
  })

  it('devolve objeto vazio para lista vazia', () => {
    expect(buildRegistryCategories([], {})).toEqual({})
  })
})
