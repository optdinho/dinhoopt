import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  validateSender: vi.fn(() => true),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('./sender-validation', () => ({
  validateSender: mocks.validateSender,
}))

import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'
import { registerStartupSafetyIpc } from './startup-safety.ipc'

describe('registerStartupSafetyIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateSender.mockReturnValue(true)
  })

  it('registers the STARTUP_SAFETY_FETCH handler', () => {
    registerStartupSafetyIpc(vi.fn())
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('startup:safety:fetch')
    expect(channels.length).toBe(1)
  })

  describe('STARTUP_SAFETY_FETCH handler', () => {
    it('returns empty ratings and pending', async () => {
      registerStartupSafetyIpc(vi.fn())
      const handler = mocks.ipcHandle.mock.calls[0]![1] as (e: unknown) => Promise<unknown>
      const result = await handler({})
      expect(result).toEqual({ ratings: [], pending: 0 })
    })

    // ── Auditoria 2026-10-18 (S2) ─────────────────────────────────

    it('validates the sender before serving ratings', async () => {
      const getWindow = vi.fn().mockReturnValue({ id: 7 })
      registerStartupSafetyIpc(getWindow)
      const handler = mocks.ipcHandle.mock.calls[0]![1] as (e: unknown) => Promise<unknown>
      const event = { sender: {} }

      await handler(event)

      expect(validateSender).toHaveBeenCalledTimes(1)
      expect(validateSender).toHaveBeenCalledWith(event, expect.objectContaining({ id: 7 }))
    })

    it('returns the safe empty payload for an invalid sender', async () => {
      mocks.validateSender.mockReturnValue(false)
      registerStartupSafetyIpc(vi.fn(() => ({ id: 7 })) as unknown as WindowGetter)
      const handler = mocks.ipcHandle.mock.calls[0]![1] as (e: unknown) => Promise<unknown>

      const result = await handler({ sender: {} })

      expect(result).toEqual({ ratings: [], pending: 0 })
    })
  })
})
