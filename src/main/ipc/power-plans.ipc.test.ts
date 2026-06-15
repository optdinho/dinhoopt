import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
    },
  },
}))

vi.mock('../services/power-plans', () => ({
  listPowerPlans: vi.fn(),
  activatePowerPlan: vi.fn(),
  createPowerPlan: vi.fn(),
  deletePowerPlan: vi.fn(),
}))

import { IPC } from '@shared/channels'
import { activatePowerPlan, createPowerPlan, deletePowerPlan, listPowerPlans } from '../services/power-plans'
import { registerPowerPlansIpc } from './power-plans.ipc'

const mockedList = vi.mocked(listPowerPlans)
const mockedActivate = vi.mocked(activatePowerPlan)
const mockedCreate = vi.mocked(createPowerPlan)
const mockedDelete = vi.mocked(deletePowerPlan)

beforeEach(() => {
  vi.clearAllMocks()
  mockHandlers.clear()
})

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const handler = mockHandlers.get(channel)
  if (!handler) throw new Error(`No handler for channel: ${channel}`)
  return handler
}

describe('registerPowerPlansIpc', () => {
  it('registers all four POWER_PLANS handlers', () => {
    registerPowerPlansIpc()
    expect(mockHandlers.has(IPC.POWER_PLANS_LIST)).toBe(true)
    expect(mockHandlers.has(IPC.POWER_PLANS_ACTIVATE)).toBe(true)
    expect(mockHandlers.has(IPC.POWER_PLANS_CREATE)).toBe(true)
    expect(mockHandlers.has(IPC.POWER_PLANS_DELETE)).toBe(true)
  })

  describe(IPC.POWER_PLANS_LIST, () => {
    it('returns list from service', async () => {
      registerPowerPlansIpc()
      mockedList.mockResolvedValue([
        {
          guid: 'abc',
          name: 'Balanced',
          description: '',
          isActive: true,
          isHighPerformance: false,
          isBalanced: true,
          isPowerSaver: false,
        },
      ])
      const result = await getHandler(IPC.POWER_PLANS_LIST)()
      expect(result).toHaveLength(1)
      expect((result as { guid: string }[])[0]!.guid).toBe('abc')
    })
  })

  describe(IPC.POWER_PLANS_ACTIVATE, () => {
    it('calls service with guid string', async () => {
      registerPowerPlansIpc()
      mockedActivate.mockResolvedValue({ success: true })
      const result = await getHandler(IPC.POWER_PLANS_ACTIVATE)({}, 'abc-123')
      expect(mockedActivate).toHaveBeenCalledWith('abc-123')
      expect(result).toEqual({ success: true })
    })

    it('returns error for non-string guid', async () => {
      registerPowerPlansIpc()
      const result = await getHandler(IPC.POWER_PLANS_ACTIVATE)({}, 123)
      expect(mockedActivate).not.toHaveBeenCalled()
      expect(result).toEqual({ success: false, error: 'Invalid GUID' })
    })
  })

  describe(IPC.POWER_PLANS_CREATE, () => {
    it('calls service with name string', async () => {
      registerPowerPlansIpc()
      mockedCreate.mockResolvedValue({ success: true, guid: 'new-guid' })
      const result = await getHandler(IPC.POWER_PLANS_CREATE)({}, 'My Plan')
      expect(mockedCreate).toHaveBeenCalledWith('My Plan')
      expect(result).toEqual({ success: true, guid: 'new-guid' })
    })

    it('returns error for non-string name', async () => {
      registerPowerPlansIpc()
      const result = await getHandler(IPC.POWER_PLANS_CREATE)({}, null)
      expect(mockedCreate).not.toHaveBeenCalled()
      expect(result).toEqual({ success: false, error: 'Invalid name' })
    })
  })

  describe(IPC.POWER_PLANS_DELETE, () => {
    it('calls service with guid string', async () => {
      registerPowerPlansIpc()
      mockedDelete.mockResolvedValue({ success: true })
      const result = await getHandler(IPC.POWER_PLANS_DELETE)({}, 'abc-123')
      expect(mockedDelete).toHaveBeenCalledWith('abc-123')
      expect(result).toEqual({ success: true })
    })

    it('returns error for non-string guid', async () => {
      registerPowerPlansIpc()
      const result = await getHandler(IPC.POWER_PLANS_DELETE)({}, undefined)
      expect(mockedDelete).not.toHaveBeenCalled()
      expect(result).toEqual({ success: false, error: 'Invalid GUID' })
    })
  })
})
