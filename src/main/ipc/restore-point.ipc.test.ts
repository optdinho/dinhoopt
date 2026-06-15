import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
  restorePoint: {
    createRestorePoint: vi.fn(),
    listRestorePoints: vi.fn(),
    deleteRestorePoint: vi.fn(),
    restoreToPoint: vi.fn(),
    enableSystemProtection: vi.fn(),
  },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('../services/restore-point', () => ({
  createRestorePoint: (...args: unknown[]) => mocks.restorePoint.createRestorePoint(...args),
  listRestorePoints: (...args: unknown[]) => mocks.restorePoint.listRestorePoints(...args),
  deleteRestorePoint: (...args: unknown[]) => mocks.restorePoint.deleteRestorePoint(...args),
  restoreToPoint: (...args: unknown[]) => mocks.restorePoint.restoreToPoint(...args),
  enableSystemProtection: (...args: unknown[]) => mocks.restorePoint.enableSystemProtection(...args),
}))

import { registerRestorePointIpc } from './restore-point.ipc'

function getHandler(channel: string): (...args: unknown[]) => Record<string, unknown> {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => Record<string, unknown>
}

describe('registerRestorePointIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 5 IPC handlers', () => {
    registerRestorePointIpc()
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('system:restore-point:create')
    expect(channels).toContain('system:restore-point:enable-protection')
    expect(channels).toContain('system:restore-point:list')
    expect(channels).toContain('system:restore-point:delete')
    expect(channels).toContain('system:restore-point:restore')
    expect(channels.length).toBe(5)
  })

  describe('RESTORE_POINT_CREATE handler', () => {
    it('calls createRestorePoint with sanitized description', async () => {
      mocks.restorePoint.createRestorePoint.mockResolvedValue({ success: true, sequenceNumber: 42 })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:create')
      const result = await handler(null, 'Meu ponto')
      expect(mocks.restorePoint.createRestorePoint).toHaveBeenCalledWith('Meu ponto')
      expect(result).toEqual({ success: true, sequenceNumber: 42 })
    })

    it('sanitizes description with special chars', async () => {
      mocks.restorePoint.createRestorePoint.mockResolvedValue({ success: true, sequenceNumber: 1 })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:create')
      await handler(null, '<script>alert("xss")</script>')
      expect(mocks.restorePoint.createRestorePoint).toHaveBeenCalledWith(expect.not.stringContaining('<'))
    })

    it('uses default description for non-string input', async () => {
      mocks.restorePoint.createRestorePoint.mockResolvedValue({ success: true, sequenceNumber: 0 })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:create')
      await handler(null, undefined)
      expect(mocks.restorePoint.createRestorePoint).toHaveBeenCalledWith(expect.stringContaining('DiNho Optimizer'))
    })

    it('returns error when creation fails', async () => {
      mocks.restorePoint.createRestorePoint.mockResolvedValue({ success: false, error: 'Access denied' })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:create')
      const result = await handler(null, 'Test')
      expect(result.success).toBe(false)
      expect(result.error).toBe('Access denied')
    })
  })

  describe('RESTORE_POINT_ENABLE_PROTECTION handler', () => {
    it('calls enableSystemProtection and returns result', async () => {
      mocks.restorePoint.enableSystemProtection.mockResolvedValue({ success: true })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:enable-protection')
      const result = await handler()
      expect(mocks.restorePoint.enableSystemProtection).toHaveBeenCalledOnce()
      expect(result).toEqual({ success: true })
    })

    it('returns error when protection enable fails', async () => {
      mocks.restorePoint.enableSystemProtection.mockResolvedValue({ success: false, error: 'Failed' })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:enable-protection')
      const result = await handler()
      expect(result.success).toBe(false)
    })
  })

  describe('RESTORE_POINT_LIST handler', () => {
    it('calls listRestorePoints and returns points', async () => {
      const fakePoints = [{ sequenceNumber: 1, description: 'Test', creationTime: new Date().toISOString() }]
      mocks.restorePoint.listRestorePoints.mockResolvedValue({ success: true, points: fakePoints })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:list')
      const result = await handler()
      expect(mocks.restorePoint.listRestorePoints).toHaveBeenCalledOnce()
      expect(result.success).toBe(true)
      expect(result.points).toHaveLength(1)
    })
  })

  describe('RESTORE_POINT_DELETE handler', () => {
    it('calls deleteRestorePoint with valid sequence number', async () => {
      mocks.restorePoint.deleteRestorePoint.mockResolvedValue({ success: true })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:delete')
      const result = await handler(null, 5)
      expect(mocks.restorePoint.deleteRestorePoint).toHaveBeenCalledWith(5)
      expect(result.success).toBe(true)
    })

    it('validates sequenceNumber is integer', async () => {
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:delete')
      const result = await handler(null, 'abc')
      expect(result.success).toBe(false)
      expect(result.error).toContain('inválido')
      expect(mocks.restorePoint.deleteRestorePoint).not.toHaveBeenCalled()
    })

    it('rejects negative sequence numbers', async () => {
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:delete')
      const result = await handler(null, -1)
      expect(result.success).toBe(false)
      expect(mocks.restorePoint.deleteRestorePoint).not.toHaveBeenCalled()
    })

    it('rejects float sequence numbers', async () => {
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:delete')
      const result = await handler(null, 3.5)
      expect(result.success).toBe(false)
      expect(mocks.restorePoint.deleteRestorePoint).not.toHaveBeenCalled()
    })
  })

  describe('RESTORE_POINT_RESTORE handler', () => {
    it('calls restoreToPoint with valid sequence number', async () => {
      mocks.restorePoint.restoreToPoint.mockResolvedValue({ success: true })
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:restore')
      const result = await handler(null, 3)
      expect(mocks.restorePoint.restoreToPoint).toHaveBeenCalledWith(3)
      expect(result.success).toBe(true)
    })

    it('validates sequenceNumber for restore', async () => {
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:restore')
      const result = await handler(null, 'invalid')
      expect(result.success).toBe(false)
      expect(mocks.restorePoint.restoreToPoint).not.toHaveBeenCalled()
    })

    it('rejects negative sequence numbers for restore', async () => {
      registerRestorePointIpc()
      const handler = getHandler('system:restore-point:restore')
      const result = await handler(null, -5)
      expect(result.success).toBe(false)
      expect(mocks.restorePoint.restoreToPoint).not.toHaveBeenCalled()
    })
  })
})
