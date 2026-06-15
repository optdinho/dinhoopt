import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
    list: vi.fn(),
    clear: vi.fn(),
    exportAsText: vi.fn(),
    getConfig: vi.fn(),
    setConfig: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

import { registerLoggerIpc } from './logger.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerLoggerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 5 IPC handlers', () => {
    registerLoggerIpc()
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('logs:list')
    expect(channels).toContain('logs:clear')
    expect(channels).toContain('logs:export')
    expect(channels).toContain('logs:config:get')
    expect(channels).toContain('logs:config:set')
    expect(channels.length).toBe(5)
  })

  describe('LOGS_LIST handler', () => {
    it('calls logger.list with filter and pagination', async () => {
      mocks.logger.list.mockResolvedValue({ entries: [], total: 0 })
      registerLoggerIpc()
      const handler = getHandler('logs:list')
      const filter = { levels: ['info'] }
      const result = await handler(null, filter, 1, 50)
      expect(mocks.logger.list).toHaveBeenCalledWith(filter, 1, 50)
      expect(result).toEqual({ entries: [], total: 0 })
    })

    it('calls logger.list without optional args', async () => {
      mocks.logger.list.mockResolvedValue({ entries: [], total: 0 })
      registerLoggerIpc()
      const handler = getHandler('logs:list')
      await handler()
      expect(mocks.logger.list).toHaveBeenCalledWith(undefined, undefined, undefined)
    })
  })

  describe('LOGS_CLEAR handler', () => {
    it('calls logger.clear', async () => {
      mocks.logger.clear.mockResolvedValue(undefined)
      registerLoggerIpc()
      const handler = getHandler('logs:clear')
      await handler()
      expect(mocks.logger.clear).toHaveBeenCalledOnce()
    })
  })

  describe('LOGS_EXPORT handler', () => {
    it('calls logger.exportAsText with filter', async () => {
      mocks.logger.exportAsText.mockResolvedValue('log content')
      registerLoggerIpc()
      const handler = getHandler('logs:export')
      const filter = { levels: ['error'] }
      const result = await handler(null, filter)
      expect(mocks.logger.exportAsText).toHaveBeenCalledWith(filter)
      expect(result).toBe('log content')
    })
  })

  describe('LOGS_CONFIG_GET handler', () => {
    it('calls logger.getConfig', async () => {
      mocks.logger.getConfig.mockResolvedValue({ retentionDays: 30 })
      registerLoggerIpc()
      const handler = getHandler('logs:config:get')
      const result = await handler()
      expect(mocks.logger.getConfig).toHaveBeenCalledOnce()
      expect(result).toEqual({ retentionDays: 30 })
    })
  })

  describe('LOGS_CONFIG_SET handler', () => {
    it('calls logger.setConfig with valid config', async () => {
      mocks.logger.setConfig.mockResolvedValue(undefined)
      registerLoggerIpc()
      const handler = getHandler('logs:config:set')
      await handler(null, { retentionDays: 14 })
      expect(mocks.logger.setConfig).toHaveBeenCalledWith({ retentionDays: 14 })
    })

    it('does not call setConfig for invalid config', async () => {
      registerLoggerIpc()
      const handler = getHandler('logs:config:set')
      await handler(null, { retentionDays: 'invalid' })
      expect(mocks.logger.setConfig).not.toHaveBeenCalled()
    })

    it('does not call setConfig for missing retentionDays', async () => {
      registerLoggerIpc()
      const handler = getHandler('logs:config:set')
      await handler(null, {})
      expect(mocks.logger.setConfig).not.toHaveBeenCalled()
    })

    it('does not call setConfig for null config', async () => {
      registerLoggerIpc()
      const handler = getHandler('logs:config:set')
      await handler(null, null)
      expect(mocks.logger.setConfig).not.toHaveBeenCalled()
    })
  })
})
