import { STOPED_SERVICES } from '@shared/stoped-services'
import { describe, expect, it } from 'vitest'
import en from '../renderer/src/locales/en/stoped.json'
import es from '../renderer/src/locales/es/stoped.json'
import pt from '../renderer/src/locales/pt/stoped.json'

const BUNDLES: Record<string, Record<string, string>> = { pt, en, es }

describe('stoped locale bundles', () => {
  it('pt is the reference bundle', () => {
    expect(Object.keys(pt).length).toBeGreaterThan(0)
  })

  it('every locale defines the same keys as pt', () => {
    const expected = Object.keys(pt).sort()
    for (const lang of ['en', 'es']) {
      expect(Object.keys(BUNDLES[lang]!).sort(), `locale ${lang}`).toEqual(expected)
    }
  })

  it('en and es differ from the pt source (no copy-paste leftovers)', () => {
    expect(en.pageTitle).not.toBe(pt.pageTitle)
    expect(es.pageTitle).not.toBe(pt.pageTitle)
  })

  it('defines a label and description key for every catalog service', () => {
    for (const def of STOPED_SERVICES) {
      for (const [lang, bundle] of Object.entries(BUNDLES)) {
        expect(bundle[def.labelKey], `${lang}:${def.labelKey}`).toBeTruthy()
        expect(bundle[def.descriptionKey], `${lang}:${def.descriptionKey}`).toBeTruthy()
      }
    }
  })

  it('service descriptions are short, single-line sentences', () => {
    for (const bundle of Object.values(BUNDLES)) {
      for (const def of STOPED_SERVICES) {
        const text = bundle[def.descriptionKey]!
        expect(text.length, `${def.id} description length`).toBeLessThan(140)
        expect(text).not.toContain('\n')
        expect(text.endsWith('.')).toBe(true)
      }
    }
  })

  it('has no empty or whitespace-only values', () => {
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      for (const [key, value] of Object.entries(bundle)) {
        expect(value.trim(), `${lang}:${key}`).not.toBe('')
      }
    }
  })

  it('exposes the bulk STOP / DESESTOP actions in every locale', () => {
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      expect(bundle.stopAll, lang).toBeTruthy()
      expect(bundle.startAll, lang).toBeTruthy()
    }
  })

  it('exposes the restart-required copy in every locale', () => {
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      expect(bundle.restartRequiredTitle, lang).toBeTruthy()
      expect(bundle.restartRequiredBody, lang).toBeTruthy()
    }
  })

  it('uses the literal RUN / STOPED status labels in every locale', () => {
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      expect(bundle.statusRunning, lang).toBe('RUN')
      expect(bundle.statusStopped, lang).toBe('STOPED')
    }
  })
})
