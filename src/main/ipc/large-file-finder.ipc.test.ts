import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  ipcHandle: vi.fn(),
  dialogShowOpenDialog: vi.fn(),
  shellTrashItem: vi.fn(),
  shellShowItemInFolder: vi.fn(),
  readdir: vi.fn(),
  stat: vi.fn(),
  rm: vi.fn(),
  logger: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

vi.mock('electron', () => ({
  ipcMain: { handle: (...args: unknown[]) => mocks.ipcHandle(...args) },
  dialog: { showOpenDialog: (...args: unknown[]) => mocks.dialogShowOpenDialog(...args) },
  shell: {
    trashItem: (...args: unknown[]) => mocks.shellTrashItem(...args),
    showItemInFolder: (...args: unknown[]) => mocks.shellShowItemInFolder(...args),
  },
  BrowserWindow: vi.fn(),
}))

vi.mock('fs/promises', () => ({
  readdir: (...args: unknown[]) => mocks.readdir(...args),
  stat: (...args: unknown[]) => mocks.stat(...args),
  rm: (...args: unknown[]) => mocks.rm(...args),
}))

vi.mock('../services/logger.service', () => ({
  getLogger: () => mocks.logger,
}))

import { registerLargeFileFinderIpc } from './large-file-finder.ipc'

function getHandler(channel: string): (...args: unknown[]) => any {
  const call = mocks.ipcHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`No handler for ${channel}`)
  return call[1] as (...args: unknown[]) => any
}

function makeEntry(name: string, isFile: boolean, _size = 0, _mtimeMs = Date.now() - 60000) {
  return {
    name,
    isFile: () => isFile,
    isDirectory: () => !isFile,
    isSymbolicLink: () => false,
  }
}

describe('registerLargeFileFinderIpc', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('registers all 5 IPC handlers', () => {
    registerLargeFileFinderIpc(() => null)
    const channels = mocks.ipcHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('large-files:select-dir')
    expect(channels).toContain('large-files:cancel')
    expect(channels).toContain('large-files:scan')
    expect(channels).toContain('large-files:delete')
    expect(channels).toContain('large-files:open-location')
    expect(channels.length).toBe(5)
  })

  describe('LARGE_FILES_SELECT_DIR handler', () => {
    it('returns selected directory path', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\Users\\Test'] })
      registerLargeFileFinderIpc(() => ({ isDestroyed: () => false }) as any)
      const handler = getHandler('large-files:select-dir')
      const result = await handler()
      expect(result).toBe('C:\\Users\\Test')
    })

    it('returns null when dialog is cancelled', async () => {
      mocks.dialogShowOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
      registerLargeFileFinderIpc(() => ({ isDestroyed: () => false }) as any)
      const handler = getHandler('large-files:select-dir')
      const result = await handler()
      expect(result).toBeNull()
    })
  })

  describe('LARGE_FILES_SCAN handler', () => {
    it('returns files larger than minFileSize', async () => {
      mocks.readdir.mockResolvedValue([
        makeEntry('small.txt', true, 100),
        makeEntry('large.txt', true, 20 * 1024 * 1024),
      ])
      mocks.stat.mockImplementation((p: string) => {
        if (p.includes('small.txt')) return { size: 100, mtimeMs: Date.now() - 60000 }
        return { size: 20 * 1024 * 1024, mtimeMs: Date.now() - 60000 }
      })
      registerLargeFileFinderIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('large-files:scan')
      const result = await handler(null, { directory: 'C:\\Test', minFileSize: 10_485_760 })
      expect(result.files).toHaveLength(1)
      expect(result.files[0].name).toBe('large.txt')
      expect(result.totalFilesScanned).toBe(2)
      expect(result.cancelled).toBe(false)
    })

    it('returns empty result for invalid options', async () => {
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:scan')
      const result = await handler(null, null)
      expect(result.files).toHaveLength(0)
      expect(result.totalFilesScanned).toBe(0)
    })

    it('returns empty result for non-object options', async () => {
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:scan')
      const result = await handler(null, 'not-an-object')
      expect(result.files).toHaveLength(0)
    })

    it('returns empty result when directory is not absolute', async () => {
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:scan')
      const result = await handler(null, { directory: 'relative/path', minFileSize: 1000 })
      expect(result.files).toHaveLength(0)
    })

    it('returns empty result when directory is unreadable', async () => {
      mocks.readdir.mockRejectedValue(new Error('ENOENT'))
      registerLargeFileFinderIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('large-files:scan')
      const result = await handler(null, { directory: 'C:\\NoAccess', minFileSize: 1000 })
      expect(result.files).toHaveLength(0)
    })

    it('caps results at 500 files', async () => {
      const entries = Array.from({ length: 600 }, (_, i) => makeEntry(`file${i}.bin`, true, 50 * 1024 * 1024))
      mocks.readdir.mockResolvedValue(entries)
      mocks.stat.mockResolvedValue({ size: 50 * 1024 * 1024, mtimeMs: Date.now() - 60000 })
      registerLargeFileFinderIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('large-files:scan')
      const result = await handler(null, { directory: 'C:\\Test', minFileSize: 1000 })
      expect(result.files).toHaveLength(500)
    })

    it('skips directories matching excludePatterns', async () => {
      mocks.readdir.mockImplementation((p: string) => {
        if (p === 'C:\\Test') return Promise.resolve([makeEntry('node_modules', false)])
        if (p === 'C:\\Test\\node_modules') return Promise.resolve([])
        return Promise.resolve([])
      })
      mocks.stat.mockResolvedValue({ size: 100, mtimeMs: Date.now() - 60000 })
      registerLargeFileFinderIpc(() => ({ webContents: { send: vi.fn() }, isDestroyed: () => false }) as any)
      const handler = getHandler('large-files:scan')
      const result = await handler(null, {
        directory: 'C:\\Test',
        minFileSize: 1000,
        excludePatterns: ['node_modules'],
      })
      expect(result.totalFilesScanned).toBe(0)
    })
  })

  describe('LARGE_FILES_DELETE handler', () => {
    it('moves files to recycle bin by default', async () => {
      mocks.stat.mockResolvedValue({ size: 1024 })
      mocks.shellTrashItem.mockResolvedValue(undefined)
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:delete')
      const result = await handler(null, ['C:\\file1.txt', 'C:\\file2.txt'], 'recycle')
      expect(mocks.shellTrashItem).toHaveBeenCalledTimes(2)
      expect(result.deleted).toBe(2)
      expect(result.spaceRecovered).toBe(2048)
    })

    it('permanently deletes files when mode is permanent', async () => {
      mocks.stat.mockResolvedValue({ size: 2048 })
      mocks.rm.mockResolvedValue(undefined)
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:delete')
      const result = await handler(null, ['C:\\bigfile.iso'], 'permanent')
      expect(mocks.rm).toHaveBeenCalledWith('C:\\bigfile.iso', { force: true })
      expect(result.deleted).toBe(1)
    })

    it('returns empty result for non-array paths', async () => {
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:delete')
      const result = await handler(null, null, 'recycle')
      expect(result.deleted).toBe(0)
      expect(result.failed).toBe(0)
    })

    it('reports errors for failed deletions', async () => {
      mocks.stat.mockRejectedValue(new Error('Access denied'))
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:delete')
      const result = await handler(null, ['C:\\protected.txt'], 'recycle')
      expect(result.failed).toBe(1)
      expect(result.errors).toHaveLength(1)
    })
  })

  describe('LARGE_FILES_OPEN_LOCATION handler', () => {
    it('opens file location in explorer', () => {
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:open-location')
      handler(null, 'C:\\Users\\file.txt')
      expect(mocks.shellShowItemInFolder).toHaveBeenCalledWith('C:\\Users\\file.txt')
    })

    it('does nothing for non-string path', () => {
      registerLargeFileFinderIpc(() => null)
      const handler = getHandler('large-files:open-location')
      handler(null, 123)
      expect(mocks.shellShowItemInFolder).not.toHaveBeenCalled()
    })
  })
})
