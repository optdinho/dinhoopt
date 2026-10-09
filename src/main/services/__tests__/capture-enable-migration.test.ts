import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'capture-enable-'))

vi.mock('electron', () => ({
  app: { getPath: () => tmp },
}))

const execNativeUtf8Mock = vi.hoisted(() =>
  vi.fn(
    async (_tool: string, _args: string[]): Promise<{ stdout: string; stderr: string }> => ({ stdout: '', stderr: '' }),
  ),
)
const execTrackedMock = vi.hoisted(() =>
  vi.fn(
    async (_file: string, _args: string[]): Promise<{ stdout: string; stderr: string }> => ({ stdout: '', stderr: '' }),
  ),
)
vi.mock('../exec-utf8', () => ({
  execNativeUtf8: execNativeUtf8Mock,
  execTracked: execTrackedMock,
}))

const isAdminMock = vi.hoisted(() => vi.fn(() => true))
vi.mock('../elevation', () => ({ isAdmin: isAdminMock }))

const logAuditMock = vi.hoisted(() => vi.fn())
vi.mock('../audit-log', () => ({ logAudit: logAuditMock }))

const loggerMock = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn(), warning: vi.fn() }))
vi.mock('../logger.service', () => ({ getLogger: () => loggerMock }))

import {
  applyCaptureEnableMigration,
  CAPTURE_ENABLE_KEYS,
  CAPTURE_ENABLE_VERSION,
  getCaptureEnableMarkerPath,
} from '../capture-enable-migration'

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function regAddCalls(): string[][] {
  return execNativeUtf8Mock.mock.calls.filter((c) => c[0] === 'reg').map((c) => c[1] as string[])
}

describe('applyCaptureEnableMigration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    execNativeUtf8Mock.mockResolvedValue({ stdout: '', stderr: '' })
    execTrackedMock.mockResolvedValue({ stdout: '', stderr: '' })
    isAdminMock.mockReturnValue(true)
    try {
      rmSync(getCaptureEnableMarkerPath(), { force: true })
    } catch {
      /* noop */
    }
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('enables every capture key and stamps the marker on a fresh install', async () => {
    const result = await applyCaptureEnableMigration()

    expect(result.applied).toBe(true)
    expect(result.version).toBe(CAPTURE_ENABLE_VERSION)

    const adds = regAddCalls()
    expect(adds).toHaveLength(CAPTURE_ENABLE_KEYS.length)
    for (const key of CAPTURE_ENABLE_KEYS) {
      expect(adds).toContainEqual([
        'add',
        `${key.hive}\\${key.path}`,
        '/v',
        key.key,
        '/t',
        'REG_DWORD',
        '/d',
        '1',
        '/f',
      ])
    }

    expect(execTrackedMock).toHaveBeenCalledWith('gpupdate', ['/target:computer', '/force'])

    const marker = JSON.parse(readFileSync(getCaptureEnableMarkerPath(), 'utf-8')) as { version: number }
    expect(marker.version).toBe(CAPTURE_ENABLE_VERSION)

    expect(logAuditMock).toHaveBeenCalledWith(
      'capture-enable-applied',
      'system',
      expect.objectContaining({ version: CAPTURE_ENABLE_VERSION }),
    )
  })

  it('is idempotent — never rewrites once the marker is at the current version', async () => {
    await applyCaptureEnableMigration()
    vi.clearAllMocks()

    const result = await applyCaptureEnableMigration()

    expect(result.applied).toBe(false)
    expect(result.reason).toBe('already-applied')
    expect(execNativeUtf8Mock).not.toHaveBeenCalled()
    expect(execTrackedMock).not.toHaveBeenCalled()
  })

  it('does nothing on a non-Windows platform', async () => {
    setPlatform('linux')

    const result = await applyCaptureEnableMigration()

    expect(result.applied).toBe(false)
    expect(result.reason).toBe('not-win32')
    expect(execNativeUtf8Mock).not.toHaveBeenCalled()
    expect(existsSync(getCaptureEnableMarkerPath())).toBe(false)
  })

  it('skips without stamping when not elevated, so a later elevated boot retries', async () => {
    isAdminMock.mockReturnValue(false)

    const result = await applyCaptureEnableMigration()

    expect(result.applied).toBe(false)
    expect(result.reason).toBe('not-admin')
    expect(execNativeUtf8Mock).not.toHaveBeenCalled()
    expect(existsSync(getCaptureEnableMarkerPath())).toBe(false)
  })

  it('does not stamp the marker when a registry write fails, so it retries', async () => {
    execNativeUtf8Mock.mockRejectedValueOnce(new Error('Access denied'))

    const result = await applyCaptureEnableMigration()

    expect(result.applied).toBe(false)
    expect(result.reason).toBe('failed')
    expect(existsSync(getCaptureEnableMarkerPath())).toBe(false)
    expect(execTrackedMock).not.toHaveBeenCalled()
  })

  it('still applies when gpupdate fails (best-effort)', async () => {
    execTrackedMock.mockRejectedValueOnce(new Error('gpupdate not found'))

    const result = await applyCaptureEnableMigration()

    expect(result.applied).toBe(true)
    expect(loggerMock.warning).toHaveBeenCalled()
    const marker = JSON.parse(readFileSync(getCaptureEnableMarkerPath(), 'utf-8')) as { version: number }
    expect(marker.version).toBe(CAPTURE_ENABLE_VERSION)
  })

  it('treats a corrupt marker file as never applied', async () => {
    writeFileSync(getCaptureEnableMarkerPath(), '{not json', 'utf-8')

    const result = await applyCaptureEnableMigration()

    expect(result.applied).toBe(true)
    expect(regAddCalls()).toHaveLength(CAPTURE_ENABLE_KEYS.length)
  })

  it('treats a non-integer marker as never applied', async () => {
    writeFileSync(getCaptureEnableMarkerPath(), JSON.stringify({ version: 'x' }), 'utf-8')

    const result = await applyCaptureEnableMigration()

    expect(result.applied).toBe(true)
  })
})
