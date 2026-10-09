import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const { buildReleasePayload, ensureRelease } = require('./ensure-release.js')

describe('buildReleasePayload', () => {
  it('monta o payload com tag v-prefixada, name=version e nao-draft', () => {
    expect(buildReleasePayload('2.0.9', 'NOTAS')).toEqual({
      tag_name: 'v2.0.9',
      name: '2.0.9',
      body: 'NOTAS',
      draft: false,
      prerelease: false,
    })
  })

  it('inclui target_commitish apenas quando fornecido', () => {
    expect(buildReleasePayload('2.0.9', 'N', 'abc123')).toHaveProperty('target_commitish', 'abc123')
    expect(buildReleasePayload('2.0.9', 'N')).not.toHaveProperty('target_commitish')
  })
})

describe('ensureRelease', () => {
  it('atualiza o body quando a release ja existe (GET 200)', async () => {
    const calls: Array<{ method: string; path: string; body?: unknown }> = []
    const request = vi.fn(async (method: string, path: string, _token: string, body?: unknown) => {
      calls.push({ method, path, body })
      if (method === 'GET') return { id: 42 }
      return {}
    })

    const result = await ensureRelease({ version: '2.0.9', notes: 'N', token: 't', request })

    expect(result).toEqual({ action: 'updated', id: 42 })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH'])
    expect(calls[0].path).toContain('/releases/tags/v2.0.9')
    expect(calls[1].path).toContain('/releases/42')
    expect(calls[1].body).toEqual({ body: 'N' })
  })

  it('cria a release quando o GET devolve 404', async () => {
    const calls: Array<{ method: string; path: string; body?: any }> = []
    const notFound = Object.assign(new Error('404'), { status: 404 })
    const request = vi.fn(async (method: string, path: string, _token: string, body?: unknown) => {
      calls.push({ method, path, body })
      if (method === 'GET') throw notFound
      return { id: 7 }
    })

    const result = await ensureRelease({ version: '2.0.9', notes: 'N', token: 't', request, targetCommitish: 'sha' })

    expect(result).toEqual({ action: 'created', id: 7 })
    expect(calls.map((c) => c.method)).toEqual(['GET', 'POST'])
    expect(calls[1].body).toEqual(buildReleasePayload('2.0.9', 'N', 'sha'))
  })

  it('propaga erros que nao sejam 404 (nao cria por cima de um 401/500)', async () => {
    const request = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { status: 500 })
    })

    await expect(ensureRelease({ version: '2.0.9', notes: 'N', token: 't', request })).rejects.toThrow('boom')
  })
})
