import { IPC } from '@shared/channels'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockHandle = vi.fn()
vi.mock('electron', () => ({
  ipcMain: { handle: mockHandle },
}))

vi.mock('../services/compliance-auditor.service', () => ({
  scanCompliance: vi.fn(),
  applyComplianceSettings: vi.fn(),
  revertComplianceSettings: vi.fn(),
}))

describe('registerComplianceAuditorIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all three COMPLIANCE handlers', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)

    expect(mockHandle).toHaveBeenCalledTimes(3)
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const channels = mockHandle.mock.calls.map((c: any[]) => c[0])
    expect(channels).toContain(IPC.COMPLIANCE_SCAN)
    expect(channels).toContain(IPC.COMPLIANCE_APPLY)
    expect(channels).toContain(IPC.COMPLIANCE_REVERT)
  })

  it('COMPLIANCE_SCAN handler calls scanCompliance', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { scanCompliance } = await import('../services/compliance-auditor.service')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const scanHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_SCAN)?.[1]
    await scanHandler()

    expect(scanCompliance).toHaveBeenCalled()
  })

  it('COMPLIANCE_APPLY validates input before passing to service', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { applyComplianceSettings } = await import('../services/compliance-auditor.service')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const applyHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_APPLY)?.[1]
    const result = await applyHandler(null, 'not-an-array')

    expect(applyComplianceSettings).not.toHaveBeenCalled()
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
  })

  it('COMPLIANCE_REVERT validates input before passing to service', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { revertComplianceSettings } = await import('../services/compliance-auditor.service')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const revertHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_REVERT)?.[1]
    const result = await revertHandler(null, null)

    expect(revertComplianceSettings).not.toHaveBeenCalled()
    expect(result).toEqual({ succeeded: 0, failed: 0, errors: [] })
  })

  it('COMPLIANCE_APPLY passes valid string array to service', async () => {
    const { registerComplianceAuditorIpc } = await import('./compliance-auditor.ipc')
    const { applyComplianceSettings } = await import('../services/compliance-auditor.service')
    const getWindow = () => null
    registerComplianceAuditorIpc(getWindow)

    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const applyHandler = mockHandle.mock.calls.find((c: any[]) => c[0] === IPC.COMPLIANCE_APPLY)?.[1]
    await applyHandler(null, ['uac-enabled', 'smb1-disabled'])

    expect(applyComplianceSettings).toHaveBeenCalledWith(['uac-enabled', 'smb1-disabled'])
  })
})
