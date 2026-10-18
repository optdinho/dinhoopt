import { describe, expect, it } from 'vitest'
import { categories } from './PrivacyShieldComponents'

const IMPLEMENTED_CATEGORIES = ['telemetry', 'ads', 'search', 'sync', 'services', 'tasks', 'ai', 'recall', 'browser']

describe('PrivacyShieldComponents categories', () => {
  it('has no duplicate category ids', () => {
    const ids = categories.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('declares only categories that have backend settings', () => {
    // A category with no backend settings never renders (the page skips empty
    // categories), so declaring one only adds dead UI + dead locale keys.
    expect(categories.map((c) => c.id).sort()).toEqual([...IMPLEMENTED_CATEGORIES].sort())
  })

  it('every category resolves a privacyCategories label and description key', () => {
    for (const c of categories) {
      expect(c.labelKey.startsWith('privacyCategories.')).toBe(true)
      expect(c.descriptionKey.startsWith('privacyCategories.')).toBe(true)
    }
  })
})
