import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process.execFile
const mockExecFile = vi.fn()
vi.mock('child_process', () => ({ execFile: (...args: unknown[]) => mockExecFile(...args) }))

// Mock elevation
vi.mock('./elevation', () => ({ isAdmin: vi.fn() }))

import {
  createRestorePoint,
  listRestorePoints,
  deleteRestorePoint,
  restoreToPoint
} from './restore-point'
import { isAdmin } from './elevation'

const mockedIsAdmin = vi.mocked(isAdmin)

function mockPsSuccess(stdout: string) {
  let callCount = 0
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
    callCount++
    if (callCount === 1) {
      cb(null, 'OK', '')
    } else {
      cb(null, stdout, '')
    }
  })
}

function mockPsError(stderr: string) {
  let callCount = 0
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
    callCount++
    if (callCount === 1) {
      cb(null, 'OK', '')
    } else {
      cb(new Error(stderr), '', stderr)
    }
  })
}

function mockSrUnavailable() {
  let callCount = 0
  mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
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

describe('createRestorePoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

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
    mockPsSuccess('')

    const result = await createRestorePoint('Before Cleanup')
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()

    const script = mockExecFile.mock.calls[1][1][3]
    expect(script).toContain('Before Cleanup')
    expect(script).toContain('Checkpoint-Computer')
    expect(script).toContain('MODIFY_SETTINGS')
  })

  it('escapes single quotes in description', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsSuccess('')

    await createRestorePoint("Kudu's cleanup")
    const script = mockExecFile.mock.calls[1][1][3]
    expect(script).toContain("Kudu''s cleanup")
  })

  it('returns friendly error when Windows throttles (24h limit)', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsError('A restore point cannot be created because one was already created within the past 1440 minutes.')

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('24 horas')
  })

  it('returns friendly error on frequency keyword', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsError('The frequency of restore point creation is limited.')

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('24 horas')
  })

  it('returns generic error for other failures', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsError('System Protection is turned off')

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error).toContain('System Protection is turned off')
  })

  it('truncates long error messages to 500 chars', async () => {
    mockedIsAdmin.mockReturnValue(true)
    const longError = 'x'.repeat(1000)
    let callCount = 0
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: object, cb: Function) => {
      callCount++
      if (callCount === 1) {
        cb(null, 'OK', '')
      } else {
        cb(new Error(longError), '', longError)
      }
    })

    const result = await createRestorePoint('Test')
    expect(result.success).toBe(false)
    expect(result.error!.length).toBeLessThanOrEqual(500)
  })
})

describe('listRestorePoints', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('returns error when not admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const result = await listRestorePoints()
    expect(result.success).toBe(false)
    expect(result.points).toEqual([])
    expect(result.error).toContain('Privilégios de administrador')
  })

  it('returns error when System Restore is disabled', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockSrUnavailable()

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
    expect(result.points[0].sequenceNumber).toBe(42)
    expect(result.points[0].description).toBe('Test Point')
    expect(result.points[0].restorePointType).toBe('0')
    expect(result.points[1].sequenceNumber).toBe(43)
    expect(result.points[1].restorePointType).toBe('12')
  })

  it('handles single restore point (not array)', async () => {
    mockedIsAdmin.mockReturnValue(true)
    const fakeJson = JSON.stringify({ SequenceNumber: 1, Description: 'Single', CreationTime: '2026-01-01T00:00:00', RestorePointType: '14' })
    mockPsSuccess(fakeJson)

    const result = await listRestorePoints()
    expect(result.success).toBe(true)
    expect(result.points).toHaveLength(1)
    expect(result.points[0].sequenceNumber).toBe(1)
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
  beforeEach(() => { vi.clearAllMocks() })

  it('returns error when not admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const result = await deleteRestorePoint(42)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Privilégios de administrador')
  })

  it('returns error when System Restore is disabled', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockSrUnavailable()

    const result = await deleteRestorePoint(42)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Restauração do Sistema está desabilitada')
  })

  it('returns success on valid deletion', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsSuccess('')

    const result = await deleteRestorePoint(42)
    expect(result.success).toBe(true)
    const script = mockExecFile.mock.calls[1][1][3]
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
  beforeEach(() => { vi.clearAllMocks() })

  it('returns error when not admin', async () => {
    mockedIsAdmin.mockReturnValue(false)
    const result = await restoreToPoint(42)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Privilégios de administrador')
  })

  it('returns error when System Restore is disabled', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockSrUnavailable()

    const result = await restoreToPoint(42)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Restauração do Sistema está desabilitada')
  })

  it('returns success and calls Restore-Computer', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsSuccess('')

    const result = await restoreToPoint(42)
    expect(result.success).toBe(true)
    const script = mockExecFile.mock.calls[1][1][3]
    expect(script).toContain('Restore-Computer')
    expect(script).toContain('42')
  })

  it('uses 300s timeout', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsSuccess('')

    await restoreToPoint(1)
    expect(mockExecFile.mock.calls[1][2]).toEqual(expect.objectContaining({ timeout: 300_000 }))
  })

  it('returns error on powershell failure', async () => {
    mockedIsAdmin.mockReturnValue(true)
    mockPsError('Restore failed')

    const result = await restoreToPoint(1)
    expect(result.success).toBe(false)
    expect(result.error).toContain('Restore failed')
  })
})
