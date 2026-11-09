import { mkdtempSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  NOV_START,
  NOV_END,
  stripInternalSections,
  buildEntry,
  parseEntries,
  upsertNovidades,
  updateBadges,
  updateChangelogLink,
  transformReadme,
  pickNotes,
} = require('./sync-releases-readme.js')

const CHANGELOG = `# Changelog

## [2.1.13]

### Alterado
- **Atualizações**: os binários passam a ser publicados no repositório público.
- **Site**: a página \`/download/\` lê a versão do feed novo.

### Interno
- **Integridade**: asar integrity ligado.
- **Qualidade**: TS 8.495 testes.

## [2.1.12]

### Corrigido
- **Clips**: o clique do meio passa a ser gravado.

### Interno
- **Clips**: 6 testes de regressão.
`

const README = `# dinhoopt-releases

<p align="center">
  <img src="https://img.shields.io/badge/versão-2\\.1\\.12-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Versão" />
</p>

## 📥 Download

<p align="center">
  <a href="https://github.com/optdinho/dinhoopt-releases/releases/latest">
    <img src="https://img.shields.io/badge/Baixar-DiNho_Optimizer_2\\.1\\.12-2563eb?style=for-the-badge&logo=windows&logoColor=white" alt="Download" />
  </a>
</p>

---

## 📝 Novidades

> Histórico completo das versões anteriores em **[CHANGELOG.md](CHANGELOG.md)**.

### 2\\.1\\.12

**🖱️ Botão do meio a funcionar sempre.** Prosa escrita à mão.

---

## ⚡ Funcionalidades

| Módulo | Descrição |
|--------|-----------|
| Scanner | YARA-X |

---

## 📄 Licença

Comercial.
`

const section = (changelog: string, version: string) => {
  const lines = changelog.split('\n')
  const start = lines.findIndex((l) => l.includes(version))
  const end = lines.findIndex((l, i) => i > start && /^##\s/.test(l))
  return lines.slice(start + 1, end === -1 ? undefined : end).join('\n').replace(/\n---\s*$/, '').trim()
}

describe('stripInternalSections', () => {
  it('remove o bloco "### Interno" e mantem as restantes seccoes', () => {
    const source = `${section(CHANGELOG, '2.1.13')}\n\n### Notas\n- fica`
    const out = stripInternalSections(source)

    expect(out).toContain('### Alterado')
    expect(out).toContain('### Notas')
    expect(out).not.toContain('### Interno')
    expect(out).not.toContain('asar integrity')
    expect(out).not.toContain('8.495')
  })

  it('devolve o texto intacto quando nao ha "### Interno"', () => {
    const source = '### Corrigido\n- uma coisa'
    expect(stripInternalSections(source)).toBe(source)
  })

  it('remove um "## Interno" de nivel 2 e tudo ate ao proximo cabecalho', () => {
    const out = stripInternalSections('### Alterado\n- a\n\n## Interno\n- b\n\n### Notas\n- c')
    expect(out).not.toContain('- b')
    expect(out).toContain('### Notas')
  })
})

describe('buildEntry', () => {
  it('escapa os pontos da versao para o GitHub nao criar links de issues', () => {
    expect(buildEntry('2.1.13', '### Alterado\n- x')).toBe('### 2\\.1\\.13\n\n### Alterado\n- x')
  })

  it('nao duplica o cabecalho quando as notas ja o trazem', () => {
    expect(buildEntry('2.1.13', '### 2\\.1\\.13\n\nProsa.')).toBe('### 2\\.1\\.13\n\nProsa.')
  })

  it('aceita notas em prosa e trima espacos', () => {
    expect(buildEntry('2.1.14', '\n\n**Novo.** Texto.\n\n')).toBe('### 2\\.1\\.14\n\n**Novo.** Texto.')
  })
})

describe('parseEntries', () => {
  it('separa as entradas por cabecalho ### e devolve a versao', () => {
    const entries = parseEntries('### 2\\.1\\.12\n\nA\n\n### 2\\.1\\.11\n\nB')
    expect(entries).toHaveLength(2)
    expect(entries[0].version).toBe('2.1.12')
    expect(entries[1].version).toBe('2.1.11')
  })

  it('ignora lixo antes da primeira entrada', () => {
    const entries = parseEntries('texto solto\n\n### 2\\.1\\.12\n\nA')
    expect(entries.map((e: { version: string }) => e.version)).toEqual(['2.1.12'])
  })
})

describe('upsertNovidades', () => {
  it('insere os marcadores quando o README ainda nao os tem', () => {
    const out = upsertNovidades(README, buildEntry('2.1.13', 'Prosa nova.'), 5)

    expect(out).toContain(NOV_START)
    expect(out).toContain(NOV_END)
    expect(out).toContain('### 2\\.1\\.13')
    expect(out).toContain('### 2\\.1\\.12')
    const inner = out.split(NOV_START)[1].split(NOV_END)[0]
    expect(inner.indexOf('2\\.1\\.13')).toBeLessThan(inner.indexOf('2\\.1\\.12'))
    expect(out).toContain('## ⚡ Funcionalidades')
  })

  it('substitui a entrada da mesma versao em vez de a duplicar', () => {
    const once = upsertNovidades(README, buildEntry('2.1.13', 'Prosa nova.'), 5)
    const twice = upsertNovidades(once, buildEntry('2.1.13', 'Prosa corrigida.'), 5)

    expect((twice.match(/### 2\\\.1\\\.13/g) ?? []).length).toBe(1)
    expect(twice).toContain('Prosa corrigida.')
    expect(twice).not.toContain('Prosa nova.')
    expect(twice).toBe(upsertNovidades(twice, buildEntry('2.1.13', 'Prosa corrigida.'), 5))
  })

  it('mantem no maximo N entradas e descarta as mais antigas', () => {
    let readme = README
    for (const v of ['2.1.13', '2.1.14', '2.1.15']) {
      readme = upsertNovidades(readme, buildEntry(v, `Notas ${v}.`), 2)
    }

    const versions = parseEntries(readme.split(NOV_START)[1].split(NOV_END)[0]).map(
      (e: { version: string }) => e.version,
    )
    expect(versions).toEqual(['2.1.15', '2.1.14'])
    expect(readme.split(NOV_START)[1].split(NOV_END)[0]).not.toContain('### 2\\.1\\.12')
  })

  it('preserva o blockquote e a regra horizontal que fecha a seccao', () => {
    const out = upsertNovidades(README, buildEntry('2.1.13', 'X.'), 5)
    expect(out).toContain('> Histórico completo das versões anteriores')
    expect(out).toMatch(/\n---\n\n## ⚡ Funcionalidades/)
  })

  it('falha alto quando o README nao tem seccao Novidades', () => {
    expect(() => upsertNovidades('# sem seccao\n\n## Outra\n', buildEntry('2.1.13', 'X'), 5)).toThrow(
      /Novidades/,
    )
  })
})

describe('updateBadges', () => {
  it('atualiza o badge da versao e o do download', () => {
    const out = updateBadges(README, '2.1.13')
    expect(out).toContain('badge/versão-2\\.1\\.13-')
    expect(out).toContain('badge/Baixar-DiNho_Optimizer_2\\.1\\.13-')
    expect(out).not.toContain('badge/versão-2\\.1\\.12-')
    expect(out).not.toContain('badge/Baixar-DiNho_Optimizer_2\\.1\\.12-')
  })

  it('e idempotente', () => {
    expect(updateBadges(updateBadges(README, '2.1.13'), '2.1.13')).toBe(updateBadges(README, '2.1.13'))
  })
})

describe('updateChangelogLink', () => {
  it('troca o link para o CHANGELOG (privado) pela pagina de releases', () => {
    const out = updateChangelogLink(README)
    expect(out).not.toContain('](CHANGELOG.md)')
    expect(out).toContain('https://github.com/optdinho/dinhoopt-releases/releases')
    expect(out).toContain('> Histórico completo das versões anteriores em')
  })

  it('nao mexe num README que ja aponta para /releases', () => {
    const once = updateChangelogLink(README)
    expect(updateChangelogLink(once)).toBe(once)
  })
})

describe('transformReadme', () => {
  it('aplica tudo de uma vez sem tocar no resto do README', () => {
    const out = transformReadme(README, {
      version: '2.1.13',
      notes: stripInternalSections(section(CHANGELOG, '2.1.13')),
      maxEntries: 5,
    })

    expect(out).toContain('### 2\\.1\\.13')
    expect(out).toContain('**Atualizações**')
    expect(out).not.toContain('### Interno')
    expect(out).toContain('badge/versão-2\\.1\\.13-')
    expect(out).toContain('https://github.com/optdinho/dinhoopt-releases/releases')
    // tudo o que nao interessa continua byte-identico
    expect(out).toContain('| Scanner | YARA-X |')
    expect(out).toContain('Comercial.')
  })

  it('e idempotente (dois runs produzem o mesmo ficheiro)', () => {
    const args = {
      version: '2.1.13',
      notes: stripInternalSections(section(CHANGELOG, '2.1.13')),
      maxEntries: 5,
    }
    const once = transformReadme(README, args)
    expect(transformReadme(once, args)).toBe(once)
  })

  it('falha se as notas vierem vazias', () => {
    expect(() => transformReadme(README, { version: '2.1.13', notes: '   ', maxEntries: 5 })).toThrow(
      /notas vazias/i,
    )
  })
})

describe('pickNotes', () => {
  it('prefere a prosa do override por versao', () => {
    const dir = mkdtempSync(join(tmpdir(), 'readme-notes-'))
    writeFileSync(join(dir, '2.1.13.md'), '**Prosa.** Escrita à mão.\n', 'utf-8')

    expect(pickNotes({ version: '2.1.13', notesDir: dir, changelogSection: '### Interno\n- x' })).toBe(
      '**Prosa.** Escrita à mão.',
    )
  })

  it('cai no CHANGELOG sem "Interno" quando nao ha override', () => {
    const dir = mkdtempSync(join(tmpdir(), 'readme-notes-empty-'))
    const notes = pickNotes({
      version: '2.1.13',
      notesDir: dir,
      changelogSection: '### Alterado\n- a\n\n### Interno\n- b',
    })
    expect(notes).toBe('### Alterado\n- a')
  })

  it('ignora um override vazio e usa o CHANGELOG', () => {
    const dir = mkdtempSync(join(tmpdir(), 'readme-notes-blank-'))
    writeFileSync(join(dir, '2.1.13.md'), '\n\n', 'utf-8')
    expect(
      pickNotes({ version: '2.1.13', notesDir: dir, changelogSection: '### Alterado\n- a' }),
    ).toBe('### Alterado\n- a')
  })
})
