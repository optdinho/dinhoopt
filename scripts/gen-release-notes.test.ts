import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { extractVersionSection } = require('./gen-release-notes.js')

const HERE = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(HERE, '..')

const SAMPLE = `# Changelog

## 2.0.8

### Feature

Alguma coisa.

---

## 2.0.7

### Older

Nada.
`

describe('extractVersionSection', () => {
  it('extrai o corpo da versao pedida e para antes da seguinte', () => {
    const section = extractVersionSection(SAMPLE, '2.0.8')
    expect(section).toContain('### Feature')
    expect(section).toContain('Alguma coisa.')
    expect(section).not.toContain('## 2.0.7')
    expect(section).not.toContain('### Older')
  })

  it('remove a regra horizontal de separacao no fim da seccao', () => {
    expect(extractVersionSection(SAMPLE, '2.0.8')).not.toContain('---')
  })

  it('devolve null quando a versao nao existe', () => {
    expect(extractVersionSection(SAMPLE, '9.9.9')).toBeNull()
  })

  it('aceita os variantes v / entre parenteses retos do cabecalho', () => {
    const doc = '## [v2.0.8]\n\n### X\n\nConteudo.\n'
    expect(extractVersionSection(doc, '2.0.8')).toBe('### X\n\nConteudo.')
  })

  it('devolve null quando a seccao existe mas esta vazia', () => {
    const doc = '## 2.0.8\n\n---\n\n## 2.0.7\n\n### X\n'
    expect(extractVersionSection(doc, '2.0.8')).toBeNull()
  })

  it('nao confunde uma versao que e prefixo de outra (2.0 vs 2.0.8)', () => {
    const doc = '## 2.0\n\n### Vaga\n\n## 2.0.8\n\n### Exacta\n'
    expect(extractVersionSection(doc, '2.0.8')).toBe('### Exacta')
  })
})

describe('CHANGELOG.md da versao atual', () => {
  it('tem uma seccao para a versao do package.json (senao o release falha)', () => {
    const version = require('../package.json').version
    const changelog = readFileSync(join(PROJECT_ROOT, 'CHANGELOG.md'), 'utf-8')
    expect(extractVersionSection(changelog, version)).not.toBeNull()
  })
})
