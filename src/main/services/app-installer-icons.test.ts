import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  APP_ICON_DOMAINS,
  clearWebIconCache,
  resolveWebAppIcon,
  setAppIconsCacheDir,
  setWebIconFetcher,
  type WebIconFetchResult,
} from './app-installer-icons'

const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`

function makeResult(overrides: Partial<WebIconFetchResult> = {}): WebIconFetchResult {
  return {
    ok: true,
    status: 200,
    contentType: 'image/png',
    bytes: PNG_BYTES,
    ...overrides,
  }
}

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), 'app-icons-test-'))
  setAppIconsCacheDir(tempDir)
})

afterEach(async () => {
  setWebIconFetcher(null)
  setAppIconsCacheDir(null)
  await rm(tempDir, { recursive: true, force: true })
})

describe('APP_ICON_DOMAINS', () => {
  it('maps known winget ids to their primary domains', () => {
    expect(APP_ICON_DOMAINS['Mozilla.Firefox']).toBe('firefox.com')
    expect(APP_ICON_DOMAINS['Valve.Steam']).toBe('steampowered.com')
    expect(APP_ICON_DOMAINS['Discord.Discord']).toBe('discord.com')
  })

  it('covers every allowlist entry with a domain', async () => {
    const { APP_INSTALLER_ENTRIES } = await import('./app-installer')
    for (const entry of APP_INSTALLER_ENTRIES) {
      expect(APP_ICON_DOMAINS[entry.id], `missing domain for ${entry.id}`).toBeTruthy()
    }
  })
})

describe('resolveWebAppIcon', () => {
  it('returns null when the fetcher is disabled', async () => {
    setWebIconFetcher(null)
    await expect(resolveWebAppIcon('Mozilla.Firefox')).resolves.toBeNull()
  })

  it('returns null without fetching for ids with no known domain', async () => {
    const fetcher = vi.fn()
    setWebIconFetcher(fetcher)
    await expect(resolveWebAppIcon('Unknown.App')).resolves.toBeNull()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('fetches from the google favicon endpoint and returns a png data url', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('google.com/s2/favicons') ? makeResult() : null))
    setWebIconFetcher(fetcher)
    await expect(resolveWebAppIcon('Mozilla.Firefox')).resolves.toBe(PNG_DATA_URL)
    expect(fetcher).toHaveBeenCalledTimes(1)
    const url = String(fetcher.mock.calls[0]?.[0])
    expect(url).toContain('domain=firefox.com')
    expect(url).toContain('sz=128')
  })

  it('writes the downloaded bytes to the cache directory', async () => {
    setWebIconFetcher(async () => makeResult())
    await resolveWebAppIcon('Mozilla.Firefox')
    const cached = await readFile(path.join(tempDir, 'Mozilla.Firefox.png'))
    expect(cached).toEqual(Buffer.from(PNG_BYTES))
  })

  it('serves from cache without fetching on a second call', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('google.com/s2/favicons') ? makeResult() : null))
    setWebIconFetcher(fetcher)
    await resolveWebAppIcon('Mozilla.Firefox')
    fetcher.mockClear()
    await expect(resolveWebAppIcon('Mozilla.Firefox')).resolves.toBe(PNG_DATA_URL)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('reads a pre-seeded cache file without calling the fetcher', async () => {
    await writeFile(path.join(tempDir, 'Discord.Discord.png'), Buffer.from(PNG_BYTES))
    const fetcher = vi.fn(async () => makeResult())
    setWebIconFetcher(fetcher)
    await expect(resolveWebAppIcon('Discord.Discord')).resolves.toBe(PNG_DATA_URL)
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('falls back to clearbit when the google request fails', async () => {
    const fetcher = vi.fn(async (url: string) =>
      url.includes('logo.clearbit.com')
        ? makeResult()
        : makeResult({ ok: false, status: 404, bytes: new Uint8Array(0) }),
    )
    setWebIconFetcher(fetcher)
    await expect(resolveWebAppIcon('Valve.Steam')).resolves.toBe(PNG_DATA_URL)
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(String(fetcher.mock.calls[1]?.[0])).toContain('logo.clearbit.com')
  })

  it('returns null when both sources fail', async () => {
    const fetcher = vi.fn(async () => makeResult({ ok: false, status: 404, bytes: new Uint8Array(0) }))
    setWebIconFetcher(fetcher)
    await expect(resolveWebAppIcon('Valve.Steam')).resolves.toBeNull()
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('rejects non-image content types', async () => {
    const fetcher = vi.fn(async () => makeResult({ contentType: 'text/html', bytes: new Uint8Array([0x3c]) }))
    setWebIconFetcher(fetcher)
    await expect(resolveWebAppIcon('Mozilla.Firefox')).resolves.toBeNull()
  })

  it('rejects oversized responses', async () => {
    const fetcher = vi.fn(async () => makeResult({ bytes: new Uint8Array(512 * 1024 + 1) }))
    setWebIconFetcher(fetcher)
    await expect(resolveWebAppIcon('Mozilla.Firefox')).resolves.toBeNull()
  })

  it('rejects empty responses without falling through as png', async () => {
    const fetcher = vi.fn(async () => makeResult({ bytes: new Uint8Array(0) }))
    setWebIconFetcher(fetcher)
    await expect(resolveWebAppIcon('Mozilla.Firefox')).resolves.toBeNull()
  })

  it('clearWebIconCache forces a refetch', async () => {
    const fetcher = vi.fn(async (url: string) => (url.includes('google.com/s2/favicons') ? makeResult() : null))
    setWebIconFetcher(fetcher)
    await resolveWebAppIcon('Mozilla.Firefox')
    await clearWebIconCache()
    fetcher.mockClear()
    await resolveWebAppIcon('Mozilla.Firefox')
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
