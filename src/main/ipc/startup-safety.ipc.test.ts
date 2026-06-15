import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

import { registerStartupSafetyIpc } from './startup-safety.ipc'

describe('registerStartupSafetyIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the STARTUP_SAFETY_FETCH handler', () => {
    registerStartupSafetyIpc()
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('startup:safety:fetch')
    expect(channels.length).toBe(1)
  })

  describe('STARTUP_SAFETY_FETCH handler', () => {
    it('returns empty ratings and pending', async () => {
      registerStartupSafetyIpc()
      const handler = mocks.ipcHandle.mock.calls[0]![1] as () => Promise<unknown>
      const result = await handler()
      expect(result).toEqual({ ratings: [], pending: 0 })
    })
  })
})
