import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  existsSync: vi.fn(),
  execNativeUtf8: vi.fn(),
  execFileAsync: vi.fn(),
  cacheItems: vi.fn(),
  validateStringArray: vi.fn(),
  randomUUID: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
}))

vi.mock('fs', () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
}))

vi.mock('crypto', () => ({
  randomUUID: (...args: unknown[]) => mocks.randomUUID(...args),
}))

vi.mock('../services/exec-utf8', () => ({
  execNativeUtf8: (...args: unknown[]) => mocks.execNativeUtf8(...args),
  execFileAsync: (...args: unknown[]) => mocks.execFileAsync(...args),
  psUtf8: (s: string) => s,
}))

vi.mock('../services/scan-cache', () => ({
  cacheItems: (...args: unknown[]) => mocks.cacheItems(...args),
}))

vi.mock('../services/ipc-validation', () => ({
  validateStringArray: (...args: unknown[]) => mocks.validateStringArray(...args),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

import { registerEnvironmentCleanerIpc } from './environment-cleaner.ipc'

function getHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

describe('registerEnvironmentCleanerIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.randomUUID.mockReturnValue('mock-uuid')
    mocks.cacheItems.mockReturnValue(undefined)
  })

  it('registers both IPC handlers', () => {
    registerEnvironmentCleanerIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('cleaner:environment:scan')
    expect(channels).toContain('cleaner:environment:clean')
    expect(channels.length).toBe(2)
  })

  describe('ENVIRONMENT_SCAN handler', () => {
    beforeEach(() => {
      mocks.existsSync.mockReturnValue(true)
    })

    it('returns empty results when no orphaned entries found on Windows', async () => {
      // Mock reg query to return empty (no PATH env vars)
      mocks.execNativeUtf8.mockResolvedValue({ stdout: '' })
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as { length: number }[]
      expect(result.length).toBe(0)
    })

    it('scans PATH entries and reports orphaned ones on Windows', async () => {
      mocks.execNativeUtf8
        // system reg query
        .mockResolvedValueOnce({
          stdout: 'HKEY_LOCAL_MACHINE\\...\n    Path    REG_EXPAND_SZ    %SystemRoot%\\system32;C:\\Existing',
        })
        // user reg query (empty)
        .mockResolvedValueOnce({ stdout: 'HKEY_CURRENT_USER\\Environment' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p.includes('Existing') || p.includes('SystemRoot') || p.includes('system32')
      })
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as {
        subcategory: string
        items: { path: string }[]
        totalSize: number
        itemCount: number
      }[]
      // All paths exist, so no orphaned entries
      expect(result.length).toBe(0)
    })

    it('reports orphaned PATH entries when directories are missing', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({
          stdout: 'HKEY_LOCAL_MACHINE\\...\n    Path    REG_EXPAND_SZ    C:\\Existing;C:\\Missing',
        })
        .mockResolvedValueOnce({ stdout: 'HKEY_CURRENT_USER\\Environment' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\Existing'
      })
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as {
        subcategory: string
        items: { path: string }[]
        totalSize: number
        itemCount: number
      }[]
      expect(result.length).toBeGreaterThan(0)
      const pathResult = result.find((r) => r.subcategory.includes('PATH'))
      expect(pathResult).toBeDefined()
      expect(pathResult!.items[0]!.path).toContain('C:\\Missing')
    })

    it('scans environment variables for known dev vars', async () => {
      mocks.execNativeUtf8
        // scanWindowsPathEntries: system + user (both empty, no PATH)
        .mockResolvedValueOnce({ stdout: 'HKEY_LOCAL_MACHINE\\...' })
        .mockResolvedValueOnce({ stdout: 'HKEY_CURRENT_USER\\Environment' })
        // scanWindowsEnvVars: system + user
        .mockResolvedValueOnce({ stdout: 'HKEY_LOCAL_MACHINE\\...' })
        .mockResolvedValueOnce({
          stdout:
            'HKEY_CURRENT_USER\\Environment\n    JAVA_HOME    REG_SZ    C:\\Java\n    PATH    REG_SZ    C:\\Windows',
        })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\Windows'
      })
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as {
        subcategory: string
        items: { path: string }[]
        totalSize: number
        itemCount: number
      }[]
      expect(result.length).toBeGreaterThan(0)
    })

    it('skips dev env vars that point to existing directories on Windows', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: 'HKEY_LOCAL_MACHINE\\...' })
        .mockResolvedValueOnce({ stdout: 'HKEY_CURRENT_USER\\Environment' })
        .mockResolvedValueOnce({ stdout: '    JAVA_HOME    REG_SZ    C:\\Java' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockReturnValue(true)
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as { length: number }[]
      expect(result).toEqual([])
    })

    it('resolves %VAR% references from cross-scope registry vars', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    SystemRoot    REG_SZ    C:\\Windows' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_EXPAND_SZ    %SystemRoot%\\system32' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\Windows\\system32'
      })
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as { length: number }[]
      expect(result.length).toBe(0)
    })

    it('falls back to process.env for variable expansion', async () => {
      const origTestVar = process.env.TEST_ENV_VAR
      process.env.TEST_ENV_VAR = 'C:\\Windows'
      try {
        mocks.execNativeUtf8
          .mockResolvedValueOnce({ stdout: '' })
          .mockResolvedValueOnce({ stdout: '    Path    REG_EXPAND_SZ    %TEST_ENV_VAR%\\system32' })
          .mockResolvedValueOnce({ stdout: '' })
          .mockResolvedValueOnce({ stdout: '' })
        mocks.existsSync.mockImplementation((p: string) => {
          if (typeof p !== 'string') return false
          return p === 'C:\\Windows\\system32'
        })
        registerEnvironmentCleanerIpc(() => null)
        const handler = getHandler('cleaner:environment:scan')
        const result = (await handler()) as { length: number }[]
        expect(result.length).toBe(0)
      } finally {
        delete process.env.TEST_ENV_VAR
        if (origTestVar !== undefined) process.env.TEST_ENV_VAR = origTestVar
      }
    })

    it('leaves unresolvable variable unexpanded in PATH', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_EXPAND_SZ    %UNKNOWN_VAR%\\missing' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockReturnValue(false)
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as { subcategory: string; items: { path: string }[] }[]
      expect(result.length).toBeGreaterThan(0)
      const pathResult = result.find((r) => r.subcategory.includes('PATH'))
      expect(pathResult).toBeDefined()
      expect(pathResult!.items[0]!.path).toContain('%UNKNOWN_VAR%')
    })

    it('handles inaccessible registry key gracefully', async () => {
      mocks.execNativeUtf8.mockRejectedValue(new Error('Access denied'))
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:scan')
      const result = await handler()
      expect(result).toEqual([])
    })

    it('filters PATH and non-DEV vars during environment variable scan', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({
          stdout:
            'HKEY_CURRENT_USER\\Environment\n    PATH    REG_SZ    C:\\bin\n    JAVA_HOME    REG_SZ    C:\\Java\n    MY_CUSTOM_VAR    REG_SZ    C:\\Custom',
        })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\bin'
      })
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as { subcategory: string; items: { path: string }[] }[]
      expect(result.length).toBeGreaterThan(0)
      const envResult = result.find((r) => r.subcategory.includes('Environment Variables'))
      expect(envResult).toBeDefined()
      expect(envResult!.items[0]!.path).toContain('JAVA_HOME')
    })

    it('reports orphaned PATH entries from user scope', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\system\\bin' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\user\\bin;C:\\user\\missing' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\system\\bin' || p === 'C:\\user\\bin'
      })
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:scan')
      const result = (await handler()) as { subcategory: string; items: unknown[]; itemCount: number }[]
      expect(result.length).toBeGreaterThan(0)
      const userResult = result.find((r) => r.subcategory.includes('user'))
      expect(userResult).toBeDefined()
      expect(userResult!.itemCount).toBe(1)
    })

    it('does not send progress when window is destroyed', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\Missing' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockReturnValue(false)
      const send = vi.fn()
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => true, webContents: { send } }) as any)
      const handler = getHandler('cleaner:environment:scan')
      const result = await handler()
      expect(send).not.toHaveBeenCalled()
      expect(result).toBeDefined()
    })
  })

  describe('ENVIRONMENT_CLEAN handler', () => {
    it('skips clean when validation fails', async () => {
      mocks.validateStringArray.mockReturnValue(null)
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:clean')
      const result = (await handler(null, ['invalid'])) as { filesDeleted: number }
      expect(result.filesDeleted).toBe(0)
      expect(mocks.execNativeUtf8).not.toHaveBeenCalled()
    })

    it('returns skipped for unknown IDs', async () => {
      mocks.validateStringArray.mockReturnValue(['unknown-id'])
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:clean')
      const result = (await handler(null, ['unknown-id'])) as { filesSkipped: number }
      expect(result.filesSkipped).toBe(1)
    })

    async function setupScanForPathOrphans() {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\existing'
      })
    }

    async function runScanAndGetPathId(
      getWindow: () => unknown = () => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }),
    ): Promise<string> {
      registerEnvironmentCleanerIpc(getWindow as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const pathResult = scanResults.find((r) => r.subcategory.includes('PATH'))
      return pathResult!.items[0]!.id
    }

    it('removes orphaned PATH entry on Windows', async () => {
      await setupScanForPathOrphans()
      const id = await runScanAndGetPathId()
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as {
        filesDeleted: number
        filesSkipped: number
        errors: unknown[]
      }
      expect(result.filesDeleted).toBe(1)
      expect(result.filesSkipped).toBe(0)
      expect(result.errors).toHaveLength(0)
    })

    it('removes orphaned environment variable on Windows', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({
          stdout: 'HKEY_CURRENT_USER\\Environment\n    JAVA_HOME    REG_SZ    C:\\Java',
        })
      mocks.existsSync.mockReturnValue(false)
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const envResult = scanResults.find((r) => r.subcategory.includes('Environment Variables'))
      const id = envResult!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8.mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as { filesDeleted: number; errors: unknown[] }
      expect(result.filesDeleted).toBe(1)
      expect(result.errors).toHaveLength(0)
    })

    it('reports permission-denied error on Windows', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\existing'
      })
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const id = scanResults.find((r) => r.subcategory.includes('PATH'))!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockRejectedValueOnce(new Error('Access is denied'))

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as {
        filesDeleted: number
        filesSkipped: number
        errors: { reason: string }[]
      }
      expect(result.filesDeleted).toBe(0)
      expect(result.filesSkipped).toBe(1)
      expect(result.errors[0]!.reason).toBe('permission-denied')
    })

    it('reports generic error in cleaning', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\existing'
      })
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const id = scanResults.find((r) => r.subcategory.includes('PATH'))!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockRejectedValueOnce(new Error('Some unexpected error'))

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as { filesDeleted: number; errors: { reason: string }[] }
      expect(result.filesDeleted).toBe(0)
      expect(result.errors[0]!.reason).toBe('Some unexpected error')
    })

    it('refuses to remove the last PATH entry', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\only' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockReturnValue(false)
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const id = scanResults.find((r) => r.subcategory.includes('PATH'))!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8.mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\only' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as { filesSkipped: number; errors: { reason: string }[] }
      expect(result.filesSkipped).toBe(1)
      expect(result.errors[0]!.reason).toContain('Refusing to remove the last PATH entry')
    })

    it('broadcasts environment change after Windows clean', async () => {
      await setupScanForPathOrphans()
      const id = await runScanAndGetPathId()
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })

      expect(mocks.execFileAsync).not.toHaveBeenCalled()

      const cleanHandler = getHandler('cleaner:environment:clean')
      await cleanHandler(null, [id])

      expect(mocks.execFileAsync).toHaveBeenCalledTimes(1)
    })

    it('handles broadcast failure gracefully', async () => {
      await setupScanForPathOrphans()
      const id = await runScanAndGetPathId()
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.execFileAsync.mockRejectedValueOnce(new Error('Broadcast failed'))

      const cleanHandler = getHandler('cleaner:environment:clean')
      await expect(cleanHandler(null, [id])).resolves.not.toThrow()
    })

    it('sends progress during clean operations', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\existing'
      })
      const send = vi.fn()
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const id = scanResults.find((r) => r.subcategory.includes('PATH'))!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      await cleanHandler(null, [id])
      expect(send).toHaveBeenCalled()
      expect(send).toHaveBeenCalledWith('scan:progress', expect.objectContaining({ phase: 'cleaning' }))
    })

    it('uses fallback message when thrown value is not an Error', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({
          stdout: 'HKEY_CURRENT_USER\\Environment\n    JAVA_HOME    REG_SZ    C:\\Java',
        })
      mocks.existsSync.mockReturnValue(false)
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const id = scanResults.find((r) => r.subcategory.includes('Environment Variables'))!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8.mockRejectedValue('raw-string-error')

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as { errors: { reason: string }[] }
      expect(result.errors[0]!.reason).toBe('unknown error')
    })

    it('handles multiple items with rate-limited progress', async () => {
      let uuidCounter = 0
      mocks.randomUUID.mockImplementation(() => `uuid-${uuidCounter++}`)

      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\missing1;C:\\missing2' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockReturnValue(false)
      const send = vi.fn()
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const ids = scanResults.find((r) => r.subcategory.includes('PATH'))!.items.map((i) => i.id)
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      expect(ids.length).toBe(2)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\missing1;C:\\missing2' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\missing1;C:\\missing2' })
        .mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      await cleanHandler(null, ids)
      // Progress should be sent for each item (both trigger the send because of rate limit or last item)
      expect(send).toHaveBeenCalled()
      expect(send.mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    it('does not send progress when window is destroyed during clean', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\existing'
      })
      const send = vi.fn()
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => true, webContents: { send } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const id = scanResults.find((r) => r.subcategory.includes('PATH'))!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      await cleanHandler(null, [id])
      expect(send).not.toHaveBeenCalled()
    })

    it('skips progress send when getWindow returns null during clean', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\existing'
      })
      registerEnvironmentCleanerIpc(() => null)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const id = scanResults.find((r) => r.subcategory.includes('PATH'))!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing;C:\\orphaned' })
        .mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as { filesDeleted: number }
      expect(result.filesDeleted).toBe(1)
    })

    it('handles three items covering all rate-limit branch outcomes', async () => {
      let uuidCounter = 0
      mocks.randomUUID.mockImplementation(() => `uuid-${uuidCounter++}`)

      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\x;C:\\y;C:\\z' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockReturnValue(false)
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const ids = scanResults.find((r) => r.subcategory.includes('PATH'))!.items.map((i) => i.id)
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      expect(ids.length).toBe(3)

      mocks.execNativeUtf8.mockReset()
      for (let i = 0; i < 3; i++) {
        mocks.execNativeUtf8
          .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\x;C:\\y;C:\\z' })
          .mockResolvedValueOnce({ stdout: '' })
      }

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, ids)) as { filesDeleted: number }
      expect(result.filesDeleted).toBe(3)
    })

    it('skips registry lines that do not match expected format', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    SomeFlag    REG_DWORD    0x00000001' })
        .mockResolvedValueOnce({ stdout: '    Path    REG_SZ    C:\\existing' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockReturnValue(true)
      registerEnvironmentCleanerIpc(() => null)
      const handler = getHandler('cleaner:environment:scan')
      const result = await handler()
      expect(result).toEqual([])
    })

    it('removes system-scope environment variable on Windows', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '    JAVA_HOME    REG_SZ    C:\\Java' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockReturnValue(false)
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const envResult = scanResults.find((r) => r.subcategory.includes('Environment Variables'))
      expect(envResult!.subcategory).toContain('system')
      const id = envResult!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8.mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as { filesDeleted: number }
      expect(result.filesDeleted).toBe(1)
    })

    it('removes system-scope PATH entry with uppercase key', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    PATH    REG_SZ    C:\\system_existing;C:\\system_missing' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\system_existing'
      })
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const pathResult = scanResults.find((r) => r.subcategory.includes('PATH'))
      expect(pathResult).toBeDefined()
      expect(pathResult!.subcategory).toContain('system')
      const id = pathResult!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    PATH    REG_SZ    C:\\system_existing;C:\\system_missing' })
        .mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as { filesDeleted: number }
      expect(result.filesDeleted).toBe(1)
    })

    it('removes orphaned PATH entry with lowercase key', async () => {
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    path    REG_SZ    C:\\existing;C:\\missing' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
        .mockResolvedValueOnce({ stdout: '' })
      mocks.existsSync.mockImplementation((p: string) => {
        if (typeof p !== 'string') return false
        return p === 'C:\\existing'
      })
      registerEnvironmentCleanerIpc(() => ({ isDestroyed: () => false, webContents: { send: vi.fn() } }) as any)
      const scanHandler = getHandler('cleaner:environment:scan')
      const scanResults = (await scanHandler()) as { items: { id: string }[]; subcategory: string }[]
      const pathResult = scanResults.find((r) => r.subcategory.includes('PATH'))
      expect(pathResult).toBeDefined()
      const id = pathResult!.items[0]!.id
      mocks.validateStringArray.mockImplementation((arr: string[]) => arr)

      mocks.execNativeUtf8.mockReset()
      mocks.execNativeUtf8
        .mockResolvedValueOnce({ stdout: '    path    REG_SZ    C:\\existing;C:\\missing' })
        .mockResolvedValueOnce({ stdout: '' })

      const cleanHandler = getHandler('cleaner:environment:clean')
      const result = (await cleanHandler(null, [id])) as { filesDeleted: number }
      expect(result.filesDeleted).toBe(1)
    })
  })
})
