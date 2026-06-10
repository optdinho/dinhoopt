import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockAppendFileSync, mockMkdirSync, mockStatSync, mockRenameSync, mockUnlinkSync } = vi.hoisted(() => ({
  mockAppendFileSync: vi.fn(),
  mockMkdirSync: vi.fn(),
  mockStatSync: vi.fn(),
  mockRenameSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}))

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/test-dinho/logs'),
  },
}))

vi.mock('fs', () => ({
  appendFileSync: mockAppendFileSync,
  mkdirSync: mockMkdirSync,
  statSync: mockStatSync,
  renameSync: mockRenameSync,
  unlinkSync: mockUnlinkSync,
}))

import { logInfo, logError, logDebug } from './logger'

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('logInfo writes formatted line to log file', () => {
    logInfo('test message')
    expect(mockAppendFileSync).toHaveBeenCalledOnce()
    const line = mockAppendFileSync.mock.calls[0][1] as string
    expect(line).toContain('INFO: test message')
    expect(line).toMatch(/^\[\d{4}-\d{2}-\d{2}T/)
  })

  it('logError writes formatted line with error message', () => {
    logError('something failed', new Error('oops'))
    const line = mockAppendFileSync.mock.calls[0][1] as string
    expect(line).toContain('ERROR: something failed oops')
  })

  it('logError handles non-Error error parameter', () => {
    logError('fail', 'string error')
    const line = mockAppendFileSync.mock.calls[0][1] as string
    expect(line).toContain('ERROR: fail string error')
  })

  it('logError handles undefined error', () => {
    logError('fail')
    const line = mockAppendFileSync.mock.calls[0][1] as string
    expect(line).toContain('ERROR: fail')
  })

  it('logDebug writes formatted line with data', () => {
    logDebug('scan complete', { count: 42 })
    const line = mockAppendFileSync.mock.calls[0][1] as string
    expect(line).toContain('DEBUG: scan complete {"count":42}')
  })

  it('logDebug writes formatted line without data', () => {
    logDebug('no data')
    const line = mockAppendFileSync.mock.calls[0][1] as string
    expect(line).toContain('DEBUG: no data')
  })

  it('handles appendFileSync error gracefully', () => {
    mockAppendFileSync.mockImplementationOnce(() => { throw new Error('disk full') })
    expect(() => logInfo('should not throw')).not.toThrow()
  })

  it('handles rotation stat error gracefully', () => {
    mockStatSync.mockImplementationOnce(() => { throw new Error('ENOENT') })
    expect(() => logInfo('no file yet')).not.toThrow()
    expect(mockAppendFileSync).toHaveBeenCalled()
  })
})
