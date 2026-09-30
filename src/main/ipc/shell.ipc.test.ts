import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandle = vi.fn()
const mockOpenExternal = vi.fn()

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mockHandle(...args) },
  shell: { openExternal: (...args: unknown[]) => mockOpenExternal(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => ({ info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn() }),
}))

const { registerShellIpc } = await import('./shell.ipc')

function handler() {
  registerShellIpc()
  const call = mockHandle.mock.calls.find((c) => c[0] === 'shell:open-external')
  if (!call) throw new Error('shell:open-external not registered')
  const fn = call[1] as (_event: unknown, url: unknown) => { success: boolean; error?: string }
  return (url: unknown) => fn({}, url)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('shell:open-external', () => {
  it('is registered', () => {
    registerShellIpc()
    expect(mockHandle.mock.calls.map((c) => c[0])).toContain('shell:open-external')
  })

  it('opens an https link in the system browser', () => {
    const result = handler()('https://learn.microsoft.com/en-us/windows-server/networking/dns/dns-overview')
    expect(result.success).toBe(true)
    expect(mockOpenExternal).toHaveBeenCalledWith(
      'https://learn.microsoft.com/en-us/windows-server/networking/dns/dns-overview',
    )
  })

  it.each(['http://example.com', 'file:///C:/Windows/System32/cmd.exe', 'javascript:alert(1)'])('blocks %s', (url) => {
    const result = handler()(url)
    expect(result.success).toBe(false)
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('blocks a smb path to the local network', () => {
    expect(handler()('\\\\evil\\share').success).toBe(false)
  })

  it.each([undefined, null, 42, {}, [], ''])('rejects the non-string value %s', (url) => {
    const result = handler()(url)
    expect(result.success).toBe(false)
    expect(mockOpenExternal).not.toHaveBeenCalled()
  })

  it('reports a failure instead of throwing when the shell rejects', () => {
    mockOpenExternal.mockImplementation(() => {
      throw new Error('no browser')
    })
    const result = handler()('https://example.com')
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})
