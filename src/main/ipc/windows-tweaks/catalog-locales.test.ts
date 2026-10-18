import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { getPath: () => 'C:/tmp/dinho-windows-tweaks-test' },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}))

vi.mock('../sender-validation', () => ({ validateSender: () => true }))
vi.mock('../../services/exec-utf8', () => ({ execFileAsync: vi.fn(), psUtf8: (value: string) => value }))
vi.mock('../../services/logger.service', () => ({
  getLogger: () => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }),
}))
vi.mock('../../services/elevation', () => ({ isAdmin: () => true }))

import { getCatalog } from './handlers'

const LOCALES_ROOT = fileURLToPath(new URL('../../../renderer/src/locales/', import.meta.url))
const LANGS = ['pt', 'en', 'es'] as const
// pt é a língua de origem do catálogo; só en/es têm de divergir do original.
const TRANSLATED_LANGS = ['en', 'es'] as const

interface LocalizedTweak {
  name: string
  description: string
}

function loadTweaks(lang: string): Record<string, LocalizedTweak> {
  const raw = readFileSync(join(LOCALES_ROOT, lang, 'windowsTweaks.json'), 'utf8')
  return (JSON.parse(raw).tweaks ?? {}) as Record<string, LocalizedTweak>
}

describe('catálogo de tweaks: nome e descrição localizados (W17)', () => {
  const catalog = getCatalog()

  it('tem o catálogo completo e sem ids duplicados', () => {
    expect(catalog.length).toBe(80)
    const ids = catalog.map((tweak) => tweak.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  for (const lang of LANGS) {
    it(`${lang}: todos os ids do catálogo têm name e description`, () => {
      const tweaks = loadTweaks(lang)
      const missing = catalog
        .filter((tweak) => !tweaks[tweak.id]?.name || !tweaks[tweak.id]?.description)
        .map((tweak) => tweak.id)
      expect(missing).toEqual([])
    })

    it(`${lang}: não tem traduções órfãs (ids que já não existem)`, () => {
      const ids = new Set(catalog.map((tweak) => tweak.id))
      const extra = Object.keys(loadTweaks(lang)).filter((id) => !ids.has(id))
      expect(extra).toEqual([])
    })
  }

  for (const lang of TRANSLATED_LANGS) {
    it(`${lang}: nenhuma tradução ficou igual ao original (nome ou descrição)`, () => {
      const tweaks = loadTweaks(lang)
      const untranslated = catalog
        .filter((tweak) => tweaks[tweak.id]?.name === tweak.name && tweaks[tweak.id]?.description === tweak.description)
        .map((tweak) => tweak.id)
      expect(untranslated).toEqual([])
    })
  }
})
