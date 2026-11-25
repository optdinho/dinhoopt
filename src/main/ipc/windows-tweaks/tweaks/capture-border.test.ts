import { beforeEach, describe, expect, it, vi } from 'vitest'

const { execFileAsyncMock, mockHandlers, mockLogger, validateSenderMock } = vi.hoisted(() => {
  const execFileAsyncMock = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
  const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()
  const mockLogger = { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() }
  const validateSenderMock = vi.fn((..._args: unknown[]) => true)
  return { execFileAsyncMock, mockHandlers, mockLogger, validateSenderMock }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
      return handler
    }),
  },
}))

vi.mock('../../sender-validation', () => ({
  validateSender: (...args: unknown[]) => validateSenderMock(...args),
}))

vi.mock('../../../services/exec-utf8', () => ({
  execFileAsync: execFileAsyncMock,
}))

vi.mock('../../../services/logger.service', () => ({
  getLogger: () => mockLogger,
}))

import { IPC } from '@shared/channels'
import {
  getCaptureBorderStatus,
  parseConsentValue,
  registerCaptureBorderTweaks,
  setCaptureBorderAllowed,
} from './capture-border'

let rootOut = ''
let desktopOut = ''
const queryFailures = new Set<string>()
const writeFailures = new Set<string>()
const writes: string[] = []

function key(file: string, args: string[]): string {
  return `${file}|${args.join(' ')}`
}

beforeEach(() => {
  mockHandlers.clear()
  execFileAsyncMock.mockReset()
  validateSenderMock.mockReset()
  validateSenderMock.mockReturnValue(true)
  rootOut = ''
  desktopOut = ''
  queryFailures.clear()
  writeFailures.clear()
  writes.length = 0
  for (const fn of [mockLogger.info, mockLogger.warning, mockLogger.error, mockLogger.success, mockLogger.debug]) {
    fn.mockReset()
  }

  execFileAsyncMock.mockImplementation(async (file: string, args: string[]) => {
    const k = key(file, args)
    const joined = args.join(' ')
    if (file !== 'reg.exe') return { stdout: '', stderr: '' }

    if (args[0] === 'query') {
      if (queryFailures.has(k)) throw new Error('reg query failed')
      return { stdout: joined.includes('NonPackaged') ? desktopOut : rootOut, stderr: '' }
    }

    if (args[0] === 'add') {
      writes.push(`add ${joined}`)
      if (writeFailures.has(k)) throw new Error('reg add failed')
      return { stdout: '', stderr: '' }
    }

    if (args[0] === 'delete') {
      writes.push(`delete ${joined}`)
      return { stdout: '', stderr: '' }
    }

    return { stdout: '', stderr: '' }
  })
})

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const h = mockHandlers.get(channel)
  if (!h) throw new Error(`Handler not registered for ${channel}`)
  return h
}

describe('parseConsentValue', () => {
  it('reads Allow and Deny from reg.exe output with CRLF and padding', () => {
    expect(parseConsentValue('    Value    REG_SZ    Allow\r\n')).toBe('Allow')
    expect(parseConsentValue('    Value    REG_SZ    Deny\r\n')).toBe('Deny')
  })

  it('returns null when the value is missing or unrecognised', () => {
    expect(parseConsentValue('')).toBeNull()
    expect(parseConsentValue('    Value    REG_DWORD    0x1')).toBeNull()
  })
})

describe('registerCaptureBorderTweaks', () => {
  it('registers the GET and SET channels', () => {
    registerCaptureBorderTweaks(() => null)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_CAPTURE_BORDER_GET)).toBe(true)
    expect(mockHandlers.has(IPC.WINDOWS_TWEAKS_CAPTURE_BORDER_SET)).toBe(true)
  })
})

describe('getCaptureBorderStatus', () => {
  it('reports enabled when both the global and desktop-app values are Allow', async () => {
    rootOut = 'Value REG_SZ Allow\r\n'
    desktopOut = 'Value REG_SZ Allow\r\n'
    await expect(getCaptureBorderStatus()).resolves.toEqual({
      enabled: true,
      global: true,
      desktopApps: true,
    })
  })

  it('reports disabled when only one of the two values is Allow', async () => {
    rootOut = 'Value REG_SZ Allow\r\n'
    desktopOut = 'Value REG_SZ Deny\r\n'
    await expect(getCaptureBorderStatus()).resolves.toEqual({
      enabled: false,
      global: true,
      desktopApps: false,
    })
  })

  it('treats a failed query as disabled rather than assuming Allow', async () => {
    queryFailures.add(
      key('reg.exe', [
        'query',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\graphicsCaptureWithoutBorder',
        '/v',
        'Value',
      ]),
    )
    await expect(getCaptureBorderStatus()).resolves.toEqual({
      enabled: false,
      global: false,
      desktopApps: false,
    })
  })
})

describe('setCaptureBorderAllowed', () => {
  it('writes Allow to both the global and NonPackaged values', async () => {
    const result = await setCaptureBorderAllowed(true)
    expect(result).toEqual({ success: true })
    expect(writes).toHaveLength(2)
    expect(writes[0]).toContain('graphicsCaptureWithoutBorder /v Value /t REG_SZ /d Allow /f')
    expect(writes[1]).toContain('graphicsCaptureWithoutBorder\\NonPackaged /v Value /t REG_SZ /d Allow /f')
  })

  it('writes Deny to both values when disabling', async () => {
    rootOut = 'Value REG_SZ Allow\r\n'
    desktopOut = 'Value REG_SZ Allow\r\n'
    await setCaptureBorderAllowed(false)
    expect(writes.filter((w) => w.includes('/d Deny'))).toHaveLength(2)
  })

  it('restores the previous value when the second write fails', async () => {
    rootOut = 'Value REG_SZ Allow\r\n'
    desktopOut = 'Value REG_SZ Allow\r\n'
    writeFailures.add(
      key('reg.exe', [
        'add',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\graphicsCaptureWithoutBorder\\NonPackaged',
        '/v',
        'Value',
        '/t',
        'REG_SZ',
        '/d',
        'Deny',
        '/f',
      ]),
    )
    const result = await setCaptureBorderAllowed(false)
    expect(result.success).toBe(false)
    expect(writes.some((w) => w.includes('graphicsCaptureWithoutBorder /v Value /t REG_SZ /d Allow /f'))).toBe(true)
  })

  it('deletes a value that did not exist before when rolling back', async () => {
    rootOut = ''
    desktopOut = 'Value REG_SZ Deny\r\n'
    writeFailures.add(
      key('reg.exe', [
        'add',
        'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\graphicsCaptureWithoutBorder\\NonPackaged',
        '/v',
        'Value',
        '/t',
        'REG_SZ',
        '/d',
        'Allow',
        '/f',
      ]),
    )
    const result = await setCaptureBorderAllowed(true)
    expect(result.success).toBe(false)
    expect(writes.some((w) => w.startsWith('delete ') && w.includes('graphicsCaptureWithoutBorder /v Value'))).toBe(
      true,
    )
  })
})

describe('capture border IPC handlers', () => {
  it('GET returns a disabled status for an invalid sender without querying the registry', async () => {
    validateSenderMock.mockReturnValue(false)
    registerCaptureBorderTweaks(() => null)
    await expect(getHandler(IPC.WINDOWS_TWEAKS_CAPTURE_BORDER_GET)()).resolves.toEqual({
      enabled: false,
      global: false,
      desktopApps: false,
    })
    expect(execFileAsyncMock).not.toHaveBeenCalled()
  })

  it('SET rejects an invalid sender without writing to the registry', async () => {
    validateSenderMock.mockReturnValue(false)
    registerCaptureBorderTweaks(() => null)
    await expect(getHandler(IPC.WINDOWS_TWEAKS_CAPTURE_BORDER_SET)(true)).resolves.toEqual({
      success: false,
      error: 'Invalid sender',
    })
    expect(writes).toHaveLength(0)
  })

  it('SET rejects a non-boolean argument without writing to the registry', async () => {
    registerCaptureBorderTweaks(() => null)
    const result = (await getHandler(IPC.WINDOWS_TWEAKS_CAPTURE_BORDER_SET)('true')) as {
      success: boolean
      error?: string
    }
    expect(result.success).toBe(false)
    expect(result.error).toBeTruthy()
    expect(writes).toHaveLength(0)
  })
})
