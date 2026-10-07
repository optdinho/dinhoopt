import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// A6 — o salt de cifra nunca pode ser substituido em silencio.
// Para observar "escreveu por cima?" e "falhou a gravar?" preciso de
// instrumentar node:fs sem perder o comportamento real por omissao.
const ctl = vi.hoisted(() => ({
  failRead: false,
  failWrite: false,
  writes: [] as string[],
}))

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const wrapped = {
    ...actual,
    readFileSync: ((...args: Parameters<typeof actual.readFileSync>) => {
      if (ctl.failRead) throw new Error('EACCES simulado: salt ilegivel')
      return actual.readFileSync(...args)
    }) as typeof actual.readFileSync,
    writeFileSync: ((...args: Parameters<typeof actual.writeFileSync>) => {
      ctl.writes.push(String(args[0]))
      if (ctl.failWrite) throw new Error('EPERM simulado: escrita negada')
      return actual.writeFileSync(...args)
    }) as typeof actual.writeFileSync,
  }
  return { ...wrapped, default: wrapped }
})

import { initStore } from './license-store'

const ROOT = path.join(tmpdir(), 'dinho-license-store-salt-test')

function logged(spy: { mock: { calls: unknown[][] } }): string {
  return spy.mock.calls.map((c) => c.map(String).join(' ')).join('\n')
}

beforeEach(() => {
  ctl.failRead = false
  ctl.failWrite = false
  ctl.writes.length = 0
  try {
    rmSync(ROOT, { recursive: true, force: true })
  } catch {}
  mkdirSync(ROOT, { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  ctl.failRead = false
  ctl.failWrite = false
  try {
    rmSync(ROOT, { recursive: true, force: true })
  } catch {}
})

describe('loadOrCreateSalt (A6)', () => {
  it('quando o salt existe mas nao consegue ser lido: avisa e NUNCA escreve por cima', () => {
    const saltFile = path.join(ROOT, '.store-salt')
    const original = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8')
    writeFileSync(saltFile, original)
    ctl.writes.length = 0

    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ctl.failRead = true
    initStore({ keyFile: path.join(ROOT, 'k'), saltFile })

    // O defeito: o catch caia em randomBytes(16) e gravava por cima,
    // tornando ilegivel todo o payload ja cifrado com o salt antigo.
    expect(ctl.writes).toEqual([])

    ctl.failRead = false
    expect(readFileSync(saltFile)).toEqual(original)

    expect(logged(spy)).toContain('.store-salt')
    expect(logged(spy)).toMatch(/salt/i)
  })

  it('quando a gravacao do salt falha, regista a falha em vez de a engolir', () => {
    const saltFile = path.join(ROOT, '.store-salt')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    ctl.failWrite = true

    initStore({ keyFile: path.join(ROOT, 'k'), saltFile })

    expect(logged(spy)).toContain('.store-salt')
    expect(logged(spy)).toMatch(/salt/i)
  })

  it('caminho normal: sem avisos e o mesmo salt em arranques sucessivos', () => {
    const saltFile = path.join(ROOT, '.store-salt')
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})

    initStore({ keyFile: path.join(ROOT, 'k'), saltFile })
    const first = readFileSync(saltFile)
    initStore({ keyFile: path.join(ROOT, 'k'), saltFile })

    expect(first.length).toBeGreaterThanOrEqual(16)
    expect(readFileSync(saltFile)).toEqual(first)
    expect(logged(spy)).toBe('')
  })
})
