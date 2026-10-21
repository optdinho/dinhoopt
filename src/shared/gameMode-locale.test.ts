import i18next from 'i18next'
import { describe, expect, it } from 'vitest'
import en from '../renderer/src/locales/en/gameMode.json'
import es from '../renderer/src/locales/es/gameMode.json'
import pt from '../renderer/src/locales/pt/gameMode.json'

/**
 * B6 — os plurais do Modo de Jogo usavam o formato legado `_plural`, que o i18next
 * (v26) ja' ignora: espera `_one`/`_other` (JSON v4). Consequencia medida com o
 * i18next instalado: `t('resultActivated', { count: 3 })` devolvia
 * "3 otimização aplicada" — singular com o numero errado.
 *
 * A barreira resolve as chaves com o i18next REAL, registando o bundle como o
 * `i18n.ts` o faz (um ficheiro = um namespace), porque e' exactamente a resolucao
 * de plural que estava partida. `GameModePage.tsx:316-317` chama
 * `t('resultActivated', { count })` dentro de `useTranslation('gameMode')`.
 */
const BUNDLES = { pt, en, es } as const
const NS = 'gameMode'

async function instanceFor(lang: keyof typeof BUNDLES) {
  const inst = i18next.createInstance()
  await inst.init({
    lng: lang,
    fallbackLng: false,
    defaultNS: NS,
    resources: { [lang]: { [NS]: BUNDLES[lang] as unknown as Record<string, string> } },
  })
  return inst
}

describe('gameMode plural keys resolve with the real i18next (B6)', () => {
  it('does not use the legacy _plural suffix (ignored by i18next v26)', () => {
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      const legacy = Object.keys(bundle).filter((k) => k.endsWith('_plural'))
      expect(legacy, `${lang}: chaves _plural legadas`).toEqual([])
    }
  })

  it('declares _one and _other for both result strings in every locale', () => {
    for (const [lang, bundle] of Object.entries(BUNDLES)) {
      const keys = Object.keys(bundle)
      for (const base of ['resultActivated', 'resultDeactivated']) {
        expect(keys, `${lang}:${base}_one`).toContain(`${base}_one`)
        expect(keys, `${lang}:${base}_other`).toContain(`${base}_other`)
      }
    }
  })

  it('resolves count=3 to the _other wording, not the singular one', async () => {
    for (const lang of Object.keys(BUNDLES) as Array<keyof typeof BUNDLES>) {
      const inst = await instanceFor(lang)
      const bundle = BUNDLES[lang] as unknown as Record<string, string>
      const many = inst.t('resultActivated', { count: 3 })
      const singular = inst.t('resultActivated', { count: 1 })

      expect(many, `${lang}: chave nao resolvida`).not.toBe('resultActivated')
      expect(many, `${lang}: {{count}} interpolado`).toContain('3')
      // O defeito real: o texto plural tem de ser DIFERENTE do singular.
      expect(many, `${lang}: count=3 nao pode ser a frase singular`).not.toBe(singular)
      expect(many).toBe(bundle.resultActivated_other?.replace('{{count}}', '3'))
    }
  })

  it('resolves count=1 to the _one wording', async () => {
    for (const lang of Object.keys(BUNDLES) as Array<keyof typeof BUNDLES>) {
      const inst = await instanceFor(lang)
      const bundle = BUNDLES[lang] as unknown as Record<string, string>
      const one = inst.t('resultDeactivated', { count: 1 })
      expect(one, lang).not.toBe('resultDeactivated')
      expect(one, `${lang}: {{count}} interpolado`).toContain('1')
      expect(one).toBe(bundle.resultDeactivated_one?.replace('{{count}}', '1'))
    }
  })
})
