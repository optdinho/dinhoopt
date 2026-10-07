import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC_ROOT = fileURLToPath(new URL('.', import.meta.url))
const LOCALES_ROOT = join(SRC_ROOT, 'locales')

const PLURAL_SUFFIXES = ['_zero', '_one', '_two', '_few', '_many', '_other']

const HOOK_SINGLE = /useTranslation\(\s*'([^']+)'/
const HOOK_ARRAY = /useTranslation\(\s*\[/
const HOOK_DEFAULT = /useTranslation\(\s*\)/
const T_CALL = /(?<![A-Za-z0-9_.])t\(\s*'([^']+)'([^)]*)\)/g
const EXPLICIT_NS = /^([A-Za-z0-9_-]+):(.+)$/
const HAS_COUNT = /(?<![A-Za-z])count\s*:/

type LocaleShape = Record<string, unknown>

function loadLocale(lang: string, ns: string): LocaleShape {
  const path = join(LOCALES_ROOT, lang, `${ns}.json`)
  // Namespace nem sequer criado: reporta como "todas as chaves em falta".
  // JSON inválido continua a rebentar (é outro defeito, não deve ser engolido).
  if (!existsSync(path)) return {}
  return JSON.parse(readFileSync(path, 'utf8'))
}

function flattenKeys(obj: LocaleShape, prefix: string, out: Set<string>): void {
  for (const [name, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${name}` : name
    if (value !== null && typeof value === 'object') {
      flattenKeys(value as LocaleShape, path, out)
    } else {
      out.add(path)
    }
  }
}

function collectSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === 'locales' || entry === 'node_modules') continue
      collectSources(full, out)
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full)
    }
  }
  return out
}

interface Usage {
  file: string
  ns: string
  key: string
  line: number
  hasCount: boolean
}

/** Chave usada por um ficheiro que declara um único namespace. */
function collectUsage(file: string): Usage[] {
  const source = readFileSync(file, 'utf8')
  if (HOOK_ARRAY.test(source) && !HOOK_SINGLE.test(source)) return []
  if (!HOOK_SINGLE.test(source) && !HOOK_DEFAULT.test(source)) return []

  const ns = HOOK_SINGLE.exec(source)?.[1] ?? 'common'
  const usages: Usage[] = []
  const lines = source.split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(T_CALL)) {
      const raw = match[1] ?? ''
      const rest = match[2] ?? ''
      const explicit = EXPLICIT_NS.exec(raw)
      usages.push({
        file: file.slice(SRC_ROOT.length),
        ns: explicit?.[1] ?? ns,
        key: explicit?.[2] ?? raw,
        line: index + 1,
        hasCount: HAS_COUNT.test(rest),
      })
    }
  }
  return usages
}

function isResolvable(keys: Set<string>, usage: Usage): boolean {
  if (keys.has(usage.key)) return true
  if (!usage.hasCount) return false
  return PLURAL_SUFFIXES.some((suffix) => keys.has(usage.key + suffix))
}

describe('i18n: toda a chave usada existe no namespace declarado', () => {
  const sources = collectSources(SRC_ROOT)
  const localeCache = new Map<string, Set<string>>()

  function keysOf(lang: string, ns: string): Set<string> {
    const cacheKey = `${lang}:${ns}`
    const cached = localeCache.get(cacheKey)
    if (cached) return cached
    const keys = new Set<string>()
    flattenKeys(loadLocale(lang, ns), '', keys)
    localeCache.set(cacheKey, keys)
    return keys
  }

  it('encontra fontes para verificar (sanidade)', () => {
    expect(sources.length).toBeGreaterThan(50)
  })

  it('pt: nenhuma chave em falta', () => {
    const missing = sources
      .flatMap(collectUsage)
      .filter((usage) => !isResolvable(keysOf('pt', usage.ns), usage))
      .map((u) => `${u.file}:${u.line} [${u.ns}] ${u.key}`)

    expect(missing).toEqual([])
  })

  it('en: nenhuma chave em falta', () => {
    const missing = sources
      .flatMap(collectUsage)
      .filter((usage) => !isResolvable(keysOf('en', usage.ns), usage))
      .map((u) => `${u.file}:${u.line} [${u.ns}] ${u.key}`)

    expect(missing).toEqual([])
  })

  it('es: nenhuma chave em falta', () => {
    const missing = sources
      .flatMap(collectUsage)
      .filter((usage) => !isResolvable(keysOf('es', usage.ns), usage))
      .map((u) => `${u.file}:${u.line} [${u.ns}] ${u.key}`)

    expect(missing).toEqual([])
  })
})
