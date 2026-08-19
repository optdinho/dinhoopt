import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  machineId: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  hostname: vi.fn(),
  userInfo: vi.fn(),
  randomBytes: vi.fn(),
  createHash: vi.fn(),
  getLogger: vi.fn(),
}))

vi.mock('node-machine-id', () => ({
  machineId: (...args: unknown[]) => mocks.machineId(...args),
}))

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
  readFileSync: (...args: unknown[]) => mocks.readFileSync(...args),
  writeFileSync: (...args: unknown[]) => mocks.writeFileSync(...args),
}))

vi.mock('node:os', () => ({
  hostname: (...args: unknown[]) => mocks.hostname(...args),
  userInfo: (...args: unknown[]) => mocks.userInfo(...args),
}))

vi.mock('node:crypto', () => ({
  createHash: (...args: unknown[]) => mocks.createHash(...args),
  randomBytes: (...args: unknown[]) => mocks.randomBytes(...args),
}))

vi.mock('electron', () => ({
  app: {
    getPath: () => '/fake/userdata',
    isPackaged: true,
  },
}))

vi.mock('./logger.service', () => ({
  getLogger: () => mocks.getLogger(),
}))

import { generateHwid, getHwProfileRaw } from './hwid'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createHash.mockReturnValue({
    update: vi.fn().mockReturnThis(),
    digest: vi.fn().mockReturnValue('abcdef1234567890abcdef1234567890'),
  })
  mocks.getLogger.mockReturnValue({ warning: vi.fn() })
})

describe('generateHwid', () => {
  it('returns machineId when it succeeds', async () => {
    mocks.machineId.mockResolvedValue('machine-id-123')
    const hwid = await generateHwid()
    expect(hwid).toBe('machine-id-123')
  })

  it('falls back to cached file when machineId fails', async () => {
    mocks.machineId.mockRejectedValue(new Error('not supported'))
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue('cached-hwid\n')

    const hwid = await generateHwid()
    expect(hwid).toBe('cached-hwid')
  })

  it('generates new hwid when machineId fails and no cache', async () => {
    mocks.machineId.mockRejectedValue(new Error('not supported'))
    mocks.existsSync.mockReturnValue(false)
    mocks.hostname.mockReturnValue('my-pc')
    mocks.randomBytes.mockReturnValue(Buffer.from('0123456789abcdef0123456789abcdef', 'hex'))

    const hwid = await generateHwid()
    expect(hwid).toBe('abcdef1234567890abcdef1234567890')
    expect(mocks.writeFileSync).toHaveBeenCalled()
  })

  it('returns unknown-hwid when everything fails', async () => {
    mocks.machineId.mockRejectedValue(new Error('not supported'))
    mocks.existsSync.mockImplementation(() => {
      throw new Error('fs error')
    })
    mocks.createHash.mockImplementation(() => {
      throw new Error('crypto error')
    })

    const hwid = await generateHwid()
    expect(hwid).toBe('unknown-hwid')
  })

  it('logs warning when writeFileSync fails to persist HWID', async () => {
    mocks.machineId.mockRejectedValue(new Error('not supported'))
    mocks.existsSync.mockReturnValue(false)
    mocks.hostname.mockReturnValue('my-pc')
    mocks.writeFileSync.mockImplementation(() => {
      throw new Error('disk full')
    })

    const hwid = await generateHwid()
    expect(hwid).toBe('abcdef1234567890abcdef1234567890')
    expect(mocks.getLogger().warning).toHaveBeenCalledWith(
      'Hwid',
      expect.stringContaining('Failed to persist fallback HWID'),
    )
  })

  it('logs warning when all HWID sources fail', async () => {
    mocks.machineId.mockRejectedValue(new Error('not supported'))
    mocks.existsSync.mockImplementation(() => {
      throw new Error('fs error')
    })
    mocks.createHash.mockImplementation(() => {
      throw new Error('crypto error')
    })

    const hwid = await generateHwid()
    expect(hwid).toBe('unknown-hwid')
    expect(mocks.getLogger().warning).toHaveBeenCalledWith('Hwid', expect.stringContaining('All HWID sources failed'))
  })
})

describe('getHwProfileRaw', () => {
  it('returns machineId when it succeeds', async () => {
    mocks.machineId.mockResolvedValue('raw-machine-id')
    const result = await getHwProfileRaw()
    expect(result).toBe('raw-machine-id')
  })

  it('returns unknown-hwid on failure', async () => {
    mocks.machineId.mockRejectedValue(new Error('error'))
    const result = await getHwProfileRaw()
    expect(result).toBe('unknown-hwid')
  })
})
