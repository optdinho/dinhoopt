import { describe, expect, it, vi } from 'vitest'

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

import { getPlatform } from './index'

describe('getPlatform', () => {
  it('returns a platform provider on win32', () => {
    const provider = getPlatform()
    expect(provider).toBeDefined()
    expect(provider.platform).toBe('win32')
  })
})
