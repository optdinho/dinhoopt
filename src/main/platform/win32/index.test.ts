import { describe, expect, it, vi } from 'vitest'

vi.mock('./browser', () => ({ createWin32Browser: () => ({ name: 'browser' }) }))
vi.mock('./commands', () => ({ createWin32Commands: () => ({ name: 'commands' }) }))
vi.mock('./elevation', () => ({ createWin32Elevation: () => ({ name: 'elevation' }) }))
vi.mock('./malware', () => ({ createWin32Malware: () => ({ name: 'malware' }) }))
vi.mock('./malware-paths', () => ({ createWin32MalwarePaths: () => ({ name: 'malwarePaths' }) }))
vi.mock('./network', () => ({ createWin32Network: () => ({ name: 'network' }) }))
vi.mock('./paths', () => ({ createWin32Paths: () => ({ name: 'paths' }) }))
vi.mock('./privacy', () => ({ createWin32Privacy: () => ({ name: 'privacy' }) }))
vi.mock('./security', () => ({ createWin32Security: () => ({ name: 'security' }) }))
vi.mock('./services', () => ({ createWin32Services: () => ({ name: 'services' }) }))
vi.mock('./startup', () => ({ createWin32Startup: () => ({ name: 'startup' }) }))

import { createWin32Provider } from './index'

describe('createWin32Provider', () => {
  it('returns a provider with all expected properties', () => {
    const provider = createWin32Provider()
    expect(provider.platform).toBe('win32')
    expect(provider.paths).toBeDefined()
    expect(provider.elevation).toBeDefined()
    expect(provider.security).toBeDefined()
    expect(provider.commands).toBeDefined()
    expect(provider.startup).toBeDefined()
    expect(provider.privacy).toBeDefined()
    expect(provider.services).toBeDefined()
    expect(provider.malware).toBeDefined()
    expect(provider.browser).toBeDefined()
    expect(provider.malwarePaths).toBeDefined()
    expect(provider.network).toBeDefined()
  })
})
