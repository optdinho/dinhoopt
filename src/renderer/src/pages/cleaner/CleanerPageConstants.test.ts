import { CleanerType } from '@shared/enums'
import { describe, expect, it } from 'vitest'
import { categories, DEEP_CLEAN_CATEGORIES, isDeepCleanCategory } from './CleanerPageConstants'

describe('CleanerPageConstants ordering', () => {
  it('lists WinSxS last so it is scanned last', () => {
    expect(categories.at(-1)?.type).toBe(CleanerType.WinSxS)
  })

  it('places WinSxS in the final group', () => {
    const winsxs = categories.find((c) => c.type === CleanerType.WinSxS)
    expect(winsxs?.group).toBe('groupMaintenance')
  })
})

describe('CleanerPageConstants deep clean set', () => {
  it('treats WinSxS as the deep-clean category', () => {
    expect(isDeepCleanCategory(CleanerType.WinSxS)).toBe(true)
  })

  it('does not treat light categories as deep clean', () => {
    for (const cat of categories) {
      if (cat.type === CleanerType.WinSxS) continue
      expect(isDeepCleanCategory(cat.type)).toBe(false)
    }
  })

  it('exposes exactly WinSxS as deep clean', () => {
    expect([...DEEP_CLEAN_CATEGORIES]).toEqual([CleanerType.WinSxS])
  })
})
