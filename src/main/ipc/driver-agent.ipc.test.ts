import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  logger: {
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  scanDriverUpdates: vi.fn(),
  evaluateDrivers: vi.fn(),
  installDriverUpdates: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

vi.mock('./driver-manager.ipc', () => ({
  scanDriverUpdates: (...args: unknown[]) => mocks.scanDriverUpdates(...args),
  installDriverUpdates: (...args: unknown[]) => mocks.installDriverUpdates(...args),
}))

vi.mock('../services/driver-agent-evaluator', () => ({
  evaluateDrivers: (...args: unknown[]) => mocks.evaluateDrivers(...args),
}))

import { registerDriverAgentIpc } from './driver-agent.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

const EMPTY_EVALUATION = {
  candidates: [],
  evaluatedAt: expect.any(String),
  totalCandidates: 0,
  criticalCount: 0,
  recommendedCount: 0,
  optionalCount: 0,
  cautionCount: 0,
  skipCount: 0,
}

const FAKE_UPDATE = {
  id: 'upd-1',
  updateId: 'wu-guid-1',
  deviceName: 'NVIDIA GeForce RTX 3080',
  deviceId: 'PCI\\VEN_10DE...',
  className: 'Display',
  currentVersion: '31.0.15.1234',
  currentDate: '2025-01-15',
  availableVersion: '31.0.15.5678',
  availableDate: '2025-06-01',
  provider: 'NVIDIA',
  updateTitle: 'NVIDIA - Display - 31.0.15.5678',
  downloadSize: '800 MB',
  selected: true,
}

const FAKE_EVALUATION_RESULT = {
  candidates: [
    {
      updateId: 'upd-1',
      deviceName: 'NVIDIA GeForce RTX 3080',
      deviceId: 'PCI\\VEN_10DE...',
      className: 'Display',
      currentVersion: '31.0.15.1234',
      availableVersion: '31.0.15.5678',
      currentDate: '2025-01-15',
      availableDate: '2025-06-01',
      provider: 'NVIDIA',
      updateTitle: 'NVIDIA - Display - 31.0.15.5678',
      downloadSize: '800 MB',
      verdicts: [],
      consensusScore: 85,
      consensusLabel: 'recommended',
      approved: false,
    },
  ],
  evaluatedAt: '2025-06-13T12:00:00.000Z',
  totalCandidates: 1,
  criticalCount: 0,
  recommendedCount: 1,
  optionalCount: 0,
  cautionCount: 0,
  skipCount: 0,
}

const FAKE_INSTALL_RESULT = {
  installed: 1,
  failed: 0,
  rebootRequired: false,
  errors: [],
}

describe('registerDriverAgentIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers both IPC handlers', () => {
    registerDriverAgentIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('driver:agent:evaluate')
    expect(channels).toContain('driver:agent:approve')
    expect(channels.length).toBe(2)
  })

  describe('DRIVER_AGENT_EVALUATE', () => {
    it('returns empty result when no updates found', async () => {
      mocks.scanDriverUpdates.mockResolvedValue({ updates: [], totalAvailable: 0, scanDuration: 100 })

      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:evaluate')
      const result = await handler()

      expect(mocks.scanDriverUpdates).toHaveBeenCalledOnce()
      expect(mocks.evaluateDrivers).not.toHaveBeenCalled()
      expect(result).toMatchObject(EMPTY_EVALUATION)
    })

    it('returns empty result when scanResult is null', async () => {
      mocks.scanDriverUpdates.mockResolvedValue(null)

      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:evaluate')
      const result = await handler()

      expect(mocks.evaluateDrivers).not.toHaveBeenCalled()
      expect(result).toMatchObject(EMPTY_EVALUATION)
    })

    it('returns empty result when scanResult.updates is null', async () => {
      mocks.scanDriverUpdates.mockResolvedValue({ updates: null, totalAvailable: 0, scanDuration: 100 })

      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:evaluate')
      const result = await handler()

      expect(mocks.evaluateDrivers).not.toHaveBeenCalled()
      expect(result).toMatchObject(EMPTY_EVALUATION)
    })

    it('returns evaluation result when updates found', async () => {
      mocks.scanDriverUpdates.mockResolvedValue({ updates: [FAKE_UPDATE], totalAvailable: 1, scanDuration: 200 })
      mocks.evaluateDrivers.mockReturnValue(FAKE_EVALUATION_RESULT)

      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:evaluate')
      const result = await handler()

      expect(mocks.scanDriverUpdates).toHaveBeenCalledOnce()
      expect(mocks.evaluateDrivers).toHaveBeenCalledWith([FAKE_UPDATE])
      expect(result).toEqual(FAKE_EVALUATION_RESULT)
    })

    it('throws error when scan fails', async () => {
      const scanError = new Error('Windows Update API unavailable')
      mocks.scanDriverUpdates.mockRejectedValue(scanError)

      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:evaluate')

      await expect(handler()).rejects.toThrow('Windows Update API unavailable')
      expect(mocks.evaluateDrivers).not.toHaveBeenCalled()
    })
  })

  describe('DRIVER_AGENT_APPROVE', () => {
    it('returns error for invalid request (not object)', async () => {
      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:approve')
      const result = await handler(null, null)

      expect(result).toEqual({ success: false, error: 'Invalid request' })
      expect(mocks.installDriverUpdates).not.toHaveBeenCalled()
    })

    it('returns error for empty updateIds', async () => {
      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:approve')
      const result = await handler(null, { updateIds: [] })

      expect(result).toEqual({ success: false, error: 'No updates selected' })
      expect(mocks.installDriverUpdates).not.toHaveBeenCalled()
    })

    it('returns error for no valid string IDs', async () => {
      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:approve')
      const result = await handler(null, { updateIds: [123, true, {}] })

      expect(result).toEqual({ success: false, error: 'No valid update IDs' })
      expect(mocks.installDriverUpdates).not.toHaveBeenCalled()
    })

    it('successfully installs approved updates', async () => {
      mocks.installDriverUpdates.mockResolvedValue(FAKE_INSTALL_RESULT)

      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:approve')
      const result = await handler(null, { updateIds: ['wu-guid-1', 'wu-guid-2'] })

      expect(mocks.installDriverUpdates).toHaveBeenCalledWith(['wu-guid-1', 'wu-guid-2'])
      expect(result).toEqual({ success: true, rebootRequired: false })
    })

    it('handles install failure via rejected promise', async () => {
      const installError = new Error('Failed to connect to Windows Update')
      mocks.installDriverUpdates.mockRejectedValue(installError)

      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:approve')
      const result = await handler(null, { updateIds: ['wu-guid-1'] })

      expect(result).toEqual({ success: false, error: 'Error: Failed to connect to Windows Update' })
    })

    it('returns success false and error string when install has failures', async () => {
      mocks.installDriverUpdates.mockResolvedValue({
        installed: 0,
        failed: 2,
        rebootRequired: false,
        errors: [
          { deviceName: 'Device A', reason: 'Install failed with code 2' },
          { deviceName: 'Device B', reason: 'Download failed' },
        ],
      })

      registerDriverAgentIpc(() => null)
      const handler = getHandler('driver:agent:approve')
      const result = await handler(null, { updateIds: ['wu-guid-1', 'wu-guid-2'] })

      expect(result).toEqual({
        success: false,
        error: 'Device A: Install failed with code 2; Device B: Download failed',
        rebootRequired: false,
      })
    })
  })
})
