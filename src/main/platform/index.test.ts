import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./win32', () => ({
  createWin32Provider: () => ({
    platform: 'win32' as const,
    paths: {},
    elevation: {},
    security: {},
    commands: {},
    startup: {},
    privacy: {},
    services: {},
    malware: {},
    browser: {},
    malwarePaths: {},
    network: {},
  }),
}))

describe('getPlatform', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns a platform provider on win32', async () => {
    const { getPlatform } = await import('./index')
    const provider = getPlatform()
    expect(provider).toBeDefined()
    expect(provider.platform).toBe('win32')
  })

  it('returns the cached provider on second call', async () => {
    const { getPlatform } = await import('./index')
    const a = getPlatform()
    const b = getPlatform()
    expect(a).toBe(b)
  })

  it('throws on non-Windows platforms', async () => {
    const orig = process.platform
    Object.defineProperty(process, 'platform', { value: 'linux' })

    let caught: Error | undefined
    try {
      const { getPlatform } = await import('./index')
      getPlatform()
    } catch (err) {
      caught = err as Error
    }

    Object.defineProperty(process, 'platform', { value: orig })

    expect(caught).toBeDefined()
    expect(caught!.message).toMatch(/This build targets Windows only/)
  })
})
