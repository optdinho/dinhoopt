import { beforeEach, describe, expect, it, vi } from 'vitest'

// Mock child_process.execFile
const mockExecFile = vi.fn()
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }))

// Mock elevation
vi.mock('./elevation', () => ({ isAdmin: vi.fn() }))

import { isAdmin } from './elevation'
import { createRestorePoint, deleteRestorePoint, listRestorePoints, restoreToPoint } from './restore-point'

const mockedIsAdmin = vi.mocked(isAdmin)

function mockPsSuccess(stdout: string) {
  let callCount = 0
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
    callCount++
    // call 1 = startVss, call 2 = isSystemRestoreAvailable — both need 'OK'
    if (callCount <= 2) {
      cb(null, 'OK', '')
    } else {
      cb(null, stdout, '')
    }
  })
}

function mockPsError(stderr: string) {
  let callCount = 0
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
    callCount++
    if (callCount <= 2) {
      cb(null, 'OK', '')
    } else {
      cb(new Error(stderr), '', stderr)
    }
  })
}

function mockSrUnavailable() {
  let callCount = 0
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
    callCount++
    // 1st call = isSystemRestoreAvailable -> 'NO'
    // 2nd call = systemRestoreDiagnostic -> 'DISABLED'
    if (callCount === 1) {
      cb(null, 'NO', '')
    } else {
      cb(null, 'DISABLED', '')
    }
  })
}

function mockSrUnavailableWithStartVss() {
  let callCount = 0
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
    callCount++
    // call 1 = startVss -> 'OK'
    // call 2 = isSystemRestoreAvailable -> 'NO'
    // call 3 = systemRestoreDiagnostic -> 'DISABLED'
    if (callCount === 1) {
      cb(null, 'OK', '')
    } else if (callCount === 2) {
      cb(null, 'NO', '')
    } else {
      cb(null, 'DISABLED', '')
    }
  })
}

describe('createRestorePoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  /** Mock para o fluxo completo do createRestorePoint.
   *
   *  success = true -> CIM → verified
   *    call 1 = isSystemRestoreAvailable
   *    call 2 = startVss
   *    call 3 = bypassFrequencyLimit
   *    call 4 = enableSystemProtectionC
   *    call 5 = getCurrentCount
   *    call 6 = CIM create → CIM_OK
   *    call 7 = verifyCreation after CIM → '1|1'
   *
   *  success = false -> CIM → not verified → WMI → not verified → Checkpoint-Computer → error
   *    call 1 = isSystemRestoreAvailable
   *    call 2 = startVss
   *    call 3 = bypassFrequencyLimit
   *    call 4 = enableSystemProtectionC
   *    call 5 = getCurrentCount
   *    call 6 = CIM create → CIM_FAILED:...
   *    call 7 = WMI class → WMICLASS_FAILED:...
   *    call 8 = Checkpoint-Computer → error
   */
  function mockCreateFlow(success: boolean, message = '') {
    let callCount = 0
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
        callCount++
        switch (callCount) {
          case 1:
            cb(null, 'OK', '')
            return
          case 2:
            cb(null, 'OK', '')
            return
          case 3:
            cb(null, '', '')
            return
          case 4:
            cb(null, 'ENABLED', '')
            return
          case 5:
            cb(null, '0', '')
            return
          case 6:
            if (success) {
              cb(null, 'CIM_OK', '')
            } else {
              cb(null, 'CIM_FAILED:fallback', '')
            }
            return
          case 7:
            if (success) {
              cb(null, '1|1', '')
            } else {
              cb(null, 'WMICLASS_FAILED:fallback', '')
            }
            return
          case 8:
            if (!success) {
              cb(new Error(message), '', message || 'erro genérico')
            }
            return
          default:
            cb(null, message || '', '')
        }
      },
    )
  }

  it('returns error when not running as admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const result = await createRestorePoint('Test Point')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Privilégios de administrador')
  })

  it('returns error when System Restore is disabled', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockSrUnavailable()

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('Proteção do Sistema está desabilitada em todas as unidades')
  })

  it('calls powershell with correct arguments when admin', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockCreateFlow(true)

    const result = await createRestorePoint('Before Cleanup')
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    const cimCall = mockExecFile.mock.calls[5]!
    expect(cimCall[1][3]).toContain('Before Cleanup')
    expect(cimCall[1][3]).toContain('Invoke-CimMethod')
    expect(cimCall[1][3]).toContain('SystemRestore')
  })

  it('sanitizes special chars from description', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockCreateFlow(true)

    await createRestorePoint("Kudu's cleanup")
    const cimCall = mockExecFile.mock.calls[5]!
    expect(cimCall[1][3]).toContain('Kudus cleanup')
  })

  it('returns friendly error when Windows throttles (24h limit)', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockCreateFlow(
      false,
      'A restore point cannot be created because one was already created within the past 1440 minutes.',
    )

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('24 horas')
  })

  it('returns friendly error on frequency keyword', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockCreateFlow(false, 'The frequency of restore point creation is limited.')

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('24 horas')
  })

  it('returns generic error for other failures', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockCreateFlow(false, 'System Protection is turned off')

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('System Protection is turned off')
  })

  it('truncates long error messages to 500 chars', async () => {
    mockedIsAdmin.mockReturnValue(true)
    const longError = 'x'.repeat(1000)
    let callCount = 0
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
        callCount++
        switch (callCount) {
          case 1:
            cb(null, 'OK', '')
            return
          case 2:
            cb(null, 'OK', '')
            return
          case 3:
            cb(null, '', '')
            return
          case 4:
            cb(null, 'ENABLED', '')
            return
          case 5:
            cb(null, '0', '')
            return
          case 6:
            cb(null, 'CIM_FAILED:fallback', '')
            return
          case 7:
            cb(null, 'WMICLASS_FAILED:fallback', '')
            return
          case 8:
            cb(new Error(longError), '', longError)
            return
          default:
            cb(null, '', '')
        }
      },
    )

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error!.length).toBeLessThanOrEqual(500)
  })
})

describe('listRestorePoints', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when not admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const result = await listRestorePoints()
    expect(result.success).toBe(false)
    expect(result.points).toEqual([])
    expect(result.error).toContain('Privilégios de administrador')
  })

  it('returns error when System Restore is disabled', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockSrUnavailableWithStartVss()

    const result = await listRestorePoints()
    expect(result.success).toBe(false)
    expect(result.error).toContain('Proteção do Sistema está desabilitada em todas as unidades')
  })

  it('returns empty array when no restore points exist', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsError('no restore points')

    const result = await listRestorePoints()
    expect(result.success).toBe(true)
    expect(result.points).toEqual([])
  })

  it('parses restore points from JSON output', async () => {
    mockedIsAdmin.mockReturnValue(true)
    const fakeJson = JSON.stringify([
      { SequenceNumber: 42, Description: 'Test Point', CreationTime: '2026-06-01T12:00:00', RestorePointType: '0' },
      { SequenceNumber: 43, Description: 'Another Point', CreationTime: '2026-06-02T08:30:00', RestorePointType: '12' },
    ])
    mockPsSuccess(fakeJson)

    const result = await listRestorePoints()
    expect(result.success).toBe(true)
    expect(result.points).toHaveLength(2)
    expect(result.points[0]!.sequenceNumber).toBe(42)
    expect(result.points[0]!.description).toBe('Test Point')
    expect(result.points[0]!.restorePointType).toBe('0')
    expect(result.points[1]!.sequenceNumber).toBe(43)
    expect(result.points[1]!.restorePointType).toBe('12')
  })

  it('handles single restore point (not array)', async () => {
    mockedIsAdmin.mockReturnValue(true)
    const fakeJson = JSON.stringify({
      SequenceNumber: 1,
      Description: 'Single',
      CreationTime: '2026-01-01T00:00:00',
      RestorePointType: '14',
    })
    mockPsSuccess(fakeJson)

    const result = await listRestorePoints()
    expect(result.success).toBe(true)
    expect(result.points).toHaveLength(1)
    expect(result.points[0]!.sequenceNumber).toBe(1)
  })

  it('handles JSON parse errors gracefully', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsSuccess('not-json')

    const result = await listRestorePoints()
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

describe('deleteRestorePoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when not admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const result = await deleteRestorePoint(42)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Privilégios de administrador')
  })

  it('returns error when System Restore is disabled', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockSrUnavailableWithStartVss()

    const result = await deleteRestorePoint(42)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Restauração do Sistema está desabilitada')
  })

  it('returns success on valid deletion', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsSuccess('')

    const result = await deleteRestorePoint(42)
    expect(result.success).toBe(true)
    const script = mockExecFile.mock.calls[2]![1][3]
    expect(script).toContain('Win32_SystemRestore')
    expect(script).toContain('42')
  })

  it('returns error on powershell failure', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsError('Access denied')

    const result = await deleteRestorePoint(99)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Access denied')
  })
})

describe('restoreToPoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when not admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const result = await restoreToPoint(42)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Privilégios de administrador')
  })

  it('returns error when System Restore is disabled', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockSrUnavailableWithStartVss()

    const result = await restoreToPoint(42)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Restauração do Sistema está desabilitada')
  })

  it('returns success and calls Restore-Computer', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsSuccess('')

    const result = await restoreToPoint(42)
    expect(result.success).toBe(true)
    const script = mockExecFile.mock.calls[2]![1][3]
    expect(script).toContain('Restore-Computer')
    expect(script).toContain('42')
  })

  it('uses 300s timeout', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsSuccess('')

    await restoreToPoint(1)
    expect(mockExecFile.mock.calls[2]![2]).toEqual(expect.objectContaining({ timeout: 300_000 }))
  })

  it('returns error on powershell failure', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsError('Restore failed')

    const result = await restoreToPoint(1)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Restore failed')
  })

  it('handles VSS start failure gracefully in restoreToPoint', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      cb(new Error('VSS not available'), '', '')
    })
    // Without VSS running, isSystemRestoreAvailable returns false, then diagnostic says 'VSS_NOT_FOUND'
    const result = await restoreToPoint(1)
    expect(result.success).toBe(false)
  })
})

// ── enableSystemProtection ──

describe('enableSystemProtection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns error when not admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const { enableSystemProtection } = await import('./restore-point')
    const result = await enableSystemProtection()
    expect(result.success).toBe(false)
    expect(result.error).toContain('Privilégios de administrador')
  })

  it('returns success when command runs fine', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      cb(null, '', '')
    })
    const { enableSystemProtection } = await import('./restore-point')
    const result = await enableSystemProtection()
    expect(result.success).toBe(true)
  })

  it('returns error on PowerShell failure', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      cb(new Error('Access denied'), '', 'Access denied')
    })
    const { enableSystemProtection } = await import('./restore-point')
    const result = await enableSystemProtection()
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
  })
})

// ── Error handling edge cases ──

describe('restore-point edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createRestorePoint returns CIM_OK but verify fails, then WMI class succeeds', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      switch (callCount) {
        case 1: cb(null, 'OK', ''); return // isSystemRestoreAvailable
        case 2: cb(null, 'OK', ''); return // startVss
        case 3: cb(null, '', ''); return // bypassFrequencyLimit
        case 4: cb(null, 'ENABLED', ''); return // enableSystemProtectionC
        case 5: cb(null, '0', ''); return // getCurrentCount
        case 6: cb(null, 'CIM_OK', ''); return // CIM create
        case 7: cb(null, '0|0', ''); return // verifyCreation after CIM (not verified)
        case 8: cb(null, 'WMICLASS_OK', ''); return // WMI class succeeds
        case 9: cb(null, '1|5', ''); return // verifyCreation after WMI (verified!)
        default: cb(null, '', '')
      }
    })
    const { createRestorePoint } = await import('./restore-point')
    const result = await createRestorePoint('Test fallback')
    expect(result.success).toBe(true)
    expect(result.sequenceNumber).toBe(5)
  })

  it('createRestorePoint falls back through all methods and Checkpoint-Computer finally succeeds', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      switch (callCount) {
        case 1: cb(null, 'OK', ''); return
        case 2: cb(null, 'OK', ''); return
        case 3: cb(null, '', ''); return
        case 4: cb(null, 'ENABLED', ''); return
        case 5: cb(null, '0', ''); return
        case 6: cb(null, 'CIM_OK', ''); return // CIM create
        case 7: cb(null, '0|0', ''); return // verifyCreation after CIM — not verified
        case 8: cb(null, 'WMICLASS_FAILED:error', ''); return // WMI class fails → no verify call
        case 9: cb(null, '', ''); return // Checkpoint-Computer succeeds
        case 10: cb(null, '1|5', ''); return // verifyCreation after Checkpoint (verified!)
        default: cb(null, '', '')
      }
    })
    const { createRestorePoint } = await import('./restore-point')
    const result = await createRestorePoint('Test')
    expect(result.success).toBe(true)
    expect(result.sequenceNumber).toBe(5)
  })

  it('createRestorePoint falls back through WMI to Checkpoint-Computer when CIM fails', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      switch (callCount) {
        case 1: cb(null, 'OK', ''); return
        case 2: cb(null, 'OK', ''); return
        case 3: cb(null, '', ''); return
        case 4: cb(null, 'ENABLED', ''); return
        case 5: cb(null, '0', ''); return
        case 6: cb(null, 'CIM_FAILED:timeout', ''); return
        case 7: cb(null, 'WMICLASS_FAILED:error', ''); return
        case 8: cb(new Error('Checkpoint-Computer error'), '', 'error'); return
        default: cb(null, '', '')
      }
    })
    const { createRestorePoint } = await import('./restore-point')
    const result = await createRestorePoint('Test')
    // Falls through to Checkpoint-Computer catch, returns generic error
    expect(result.success).toBe(false)
  })

  it('createRestorePoint returns VSS protection disabled error from Checkpoint-Computer', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      switch (callCount) {
        case 1: cb(null, 'OK', ''); return
        case 2: cb(null, 'OK', ''); return
        case 3: cb(null, '', ''); return
        case 4: cb(null, 'ENABLED', ''); return
        case 5: cb(null, '0', ''); return
        case 6: cb(null, 'CIM_FAILED:fallback', ''); return
        case 7: cb(null, 'WMICLASS_FAILED:fallback', ''); return
        case 8: cb(new Error('System Protection is not enabled'), '', 'protection is not enabled'); return
        default: cb(null, '', '')
      }
    })
    const { createRestorePoint } = await import('./restore-point')
    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('desabilitada')
  })

  it('createRestorePoint returns VSS shadow copy error from Checkpoint-Computer', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      switch (callCount) {
        case 1: cb(null, 'OK', ''); return
        case 2: cb(null, 'OK', ''); return
        case 3: cb(null, '', ''); return
        case 4: cb(null, 'ENABLED', ''); return
        case 5: cb(null, '0', ''); return
        case 6: cb(null, 'CIM_FAILED:fallback', ''); return
        case 7: cb(null, 'WMICLASS_FAILED:fallback', ''); return
        case 8: cb(new Error('VSS error: Volume Shadow Copy not available'), '', 'VSS error'); return
        default: cb(null, '', '')
      }
    })
    const { createRestorePoint } = await import('./restore-point')
    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('VSS')
  })

  it('createRestorePoint handles VSS start failure', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      switch (callCount) {
        case 1: cb(null, 'OK', ''); return // isSystemRestoreAvailable
        case 2: cb(new Error('VSS start failed'), '', 'VSS start failed'); return // startVss fails
        default: cb(null, '', '')
      }
    })
    const { createRestorePoint } = await import('./restore-point')
    const result = await createRestorePoint('Test')
    // Should not crash - return value depends on subsequent calls
    expect(result.success).toBe(false)
  })

  it('createRestorePoint handles VSS_NOT_FOUND from startVss', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      switch (callCount) {
        case 1: cb(null, 'OK', ''); return // isSystemRestoreAvailable
        case 2: cb(null, 'VSS_NOT_FOUND', ''); return // startVss returns VSS_NOT_FOUND
        default: cb(null, '', '')
      }
    })
    const { createRestorePoint } = await import('./restore-point')
    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('VSS')
  })

  it('deleteRestorePoint handles VSS start failure', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      cb(new Error('fail'), '', '')
    })
    const { deleteRestorePoint } = await import('./restore-point')
    const result = await deleteRestorePoint(1)
    expect(result.success).toBe(false)
  })

  it('systemRestoreDiagnostic returns VSS_NOT_FOUND message', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      // listRestorePoints: startVss -> isSystemRestoreAvailable -> systemRestoreDiagnostic
      if (callCount === 1) { cb(null, 'OK', '') } // startVss
      else if (callCount === 2) { cb(null, 'VSS_NOT_FOUND', '') } // isSystemRestoreAvailable (returns false)
      else if (callCount === 3) { cb(null, 'VSS_NOT_FOUND', '') } // systemRestoreDiagnostic
      else { cb(null, '', '') }
    })
    const { listRestorePoints } = await import('./restore-point')
    const result = await listRestorePoints()
    expect(result.success).toBe(false)
    expect(result.error).toContain('VSS')
  })

  it('systemRestoreDiagnostic returns VSS_NOT_RUNNING message', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      if (callCount === 1) { cb(null, 'OK', '') } // startVss
      else if (callCount === 2) { cb(null, 'VSS_NOT_RUNNING', '') } // isSystemRestoreAvailable (returns false)
      else if (callCount === 3) { cb(null, 'VSS_NOT_RUNNING', '') } // systemRestoreDiagnostic
      else { cb(null, '', '') }
    })
    const { listRestorePoints } = await import('./restore-point')
    const result = await listRestorePoints()
    expect(result.success).toBe(false)
    expect(result.error).toContain('não está em execução')
  })

  it('systemRestoreDiagnostic returns NO_WMI message', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      if (callCount === 1) { cb(null, 'OK', '') } // startVss
      else if (callCount === 2) { cb(null, 'NO_WMI', '') } // isSystemRestoreAvailable (returns false)
      else if (callCount === 3) { cb(null, 'NO_WMI', '') } // systemRestoreDiagnostic
      else { cb(null, '', '') }
    })
    const { listRestorePoints } = await import('./restore-point')
    const result = await listRestorePoints()
    expect(result.success).toBe(false)
    expect(result.error).toContain('WMI')
  })

  it('systemRestoreDiagnostic returns generic message for unknown output', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      if (callCount === 1) { cb(null, 'OK', '') }
      else if (callCount === 2) { cb(null, 'SOME_UNKNOWN_STATUS', '') }
      else { cb(null, '', '') }
    })
    const { listRestorePoints } = await import('./restore-point')
    const result = await listRestorePoints()
    expect(result.success).toBe(false)
    expect(result.error).toContain('não está disponível')
  })

  it('listRestorePoints handles PowerShell error after VSS start', async () => {
    mockedIsAdmin.mockReturnValue(true)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: (...args: never[]) => unknown) => {
      callCount++
      if (callCount === 1) { cb(null, 'OK', '') } // startVss
      else if (callCount === 2) { cb(null, 'OK', '') } // isSystemRestoreAvailable
      else { cb(new Error('PowerShell failure'), '', 'PowerShell failure') }
    })
    const { listRestorePoints } = await import('./restore-point')
    const result = await listRestorePoints()
    expect(result.success).toBe(false)
  })
})
