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

import { registerProgramSafetyIpc } from './program-safety.ipc'

describe('registerProgramSafetyIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers the PROGRAM_SAFETY_FETCH handler', () => {
    registerProgramSafetyIpc()
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('program:safety:fetch')
    expect(channels.length).toBe(1)
  })

  describe('PROGRAM_SAFETY_FETCH handler', () => {
    it('returns empty ratings and pending', async () => {
      registerProgramSafetyIpc()
      const handler = mocks.ipcHandle.mock.calls[0]![1] as () => Promise<unknown>
      const result = await handler()
      expect(result).toEqual({ ratings: [], pending: 0 })
    })
  })
})
