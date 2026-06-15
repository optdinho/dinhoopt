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
    expect(provider.paths.name).toBe('paths')
    expect(provider.elevation.name).toBe('elevation')
    expect(provider.security.name).toBe('security')
    expect(provider.commands.name).toBe('commands')
    expect(provider.startup.name).toBe('startup')
    expect(provider.privacy.name).toBe('privacy')
    expect(provider.services.name).toBe('services')
    expect(provider.malware.name).toBe('malware')
    expect(provider.browser.name).toBe('browser')
    expect(provider.malwarePaths.name).toBe('malwarePaths')
    expect(provider.network.name).toBe('network')
  })
})
