import { describe, expect, it } from 'vitest'
import en from '../renderer/src/locales/en/settings.json'
import es from '../renderer/src/locales/es/settings.json'
import pt from '../renderer/src/locales/pt/settings.json'

const BUNDLES: Record<string, Record<string, string>> = { pt, en, es }

/** Keys introduced for the deferred auto-install guard. */
const UPDATE_GUARD_KEYS = [
  'updateDeferredBody',
  'busyClipRecording',
  'busyClipEncoding',
  'busyClipPublishing',
  'busyMalwareScan',
] as const

describe('settings locale bundles', () => {
  it('every locale defines the same keys as pt', () => {
    const expected = Object.keys(pt).sort()
    for (const lang of ['en', 'es']) {
      expect(Object.keys(BUNDLES[lang]!).sort(), `locale ${lang}`).toEqual(expected)
    }
  })

  it('defines every update-guard key in all locales', () => {
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      for (const key of UPDATE_GUARD_KEYS) {
        expect(bundle[key], `${lang}:${key}`).toBeTruthy()
      }
    }
  })

  it('updateDeferredBody interpolates the version in all locales', () => {
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      expect(bundle.updateDeferredBody, `${lang}:updateDeferredBody`).toContain('{{version}}')
    }
  })

  it('en and es are actual translations, not pt copy-paste', () => {
    for (const key of UPDATE_GUARD_KEYS) {
      expect(en[key], `en:${key}`).not.toBe(pt[key])
      expect(es[key], `es:${key}`).not.toBe(pt[key])
    }
  })
})
