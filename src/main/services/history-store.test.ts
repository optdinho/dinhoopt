import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  send: vi.fn(),
  getAllWindows: vi.fn(),
}))

vi.mock('node:fs', () => ({
  existsSync: (...args: unknown[]) => mocks.existsSync(...args),
  readFileSync: (...args: unknown[]) => mocks.readFileSync(...args),
  writeFileSync: (...args: unknown[]) => mocks.writeFileSync(...args),
  mkdirSync: (...args: unknown[]) => mocks.mkdirSync(...args),
}))

vi.mock('node:path', () => ({
  join: (...args: string[]) => args.join('/'),
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => '/fake/userdata',
  },
  BrowserWindow: {
    getAllWindows: (...args: unknown[]) => mocks.getAllWindows(...args),
  },
}))

import type { ScanHistoryEntry } from '@shared/types'
import { addHistoryEntry, clearHistory, getHistory } from './history-store'

const SAMPLE_ENTRY: ScanHistoryEntry = {
  id: 'test-1',
  type: 'cleaner',
  timestamp: Date.now(),
  summary: 'Cleaned 100 MB',
  totalSize: 100 * 1024 * 1024,
  details: {},
}

beforeEach(() => {
  vi.clearAllMocks()
  // Default: store file doesn't exist yet
  mocks.existsSync.mockReturnValue(false)
  mocks.getAllWindows.mockReturnValue([])
})

afterEach(() => {
  vi.resetAllMocks()
})

describe('getHistory', () => {
  it('returns empty array when file does not exist', () => {
    const history = getHistory()
    expect(history).toEqual([])
  })

  it('returns parsed history when file exists', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue(JSON.stringify([SAMPLE_ENTRY]))
    const history = getHistory()
    expect(history).toHaveLength(1)
    expect(history[0]!.id).toBe('test-1')
  })

  it('returns empty array on parse error', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue('invalid json')
    const history = getHistory()
    expect(history).toEqual([])
  })

  it('returns empty array for non-array data', () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue('{"some": "object"}')
    const history = getHistory()
    expect(history).toEqual([])
  })
})

describe('addHistoryEntry', () => {
  it('prepends entry to history and sends IPC', async () => {
    // Setup: existing file has empty array
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue('[]')
    mocks.getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send: mocks.send } }])

    addHistoryEntry(SAMPLE_ENTRY)

    // Wait for the write lock chain to resolve
    await vi.waitFor(
      () => {
        expect(mocks.writeFileSync).toHaveBeenCalled()
      },
      { timeout: 3000, interval: 50 },
    )

    // Verify the written data
    const writeCall = mocks.writeFileSync.mock.calls[0]
    expect(writeCall).toBeDefined()
    const written = JSON.parse(writeCall[1] as string)
    expect(written).toHaveLength(1)
    expect(written[0].id).toBe('test-1')

    // Verify IPC sent
    expect(mocks.send).toHaveBeenCalledWith('history:changed')
  })

  it('limits history to 100 entries', async () => {
    mocks.existsSync.mockReturnValue(true)
    const existing = Array.from({ length: 100 }, (_, i) => ({
      ...SAMPLE_ENTRY,
      id: `old-${i}`,
    }))
    mocks.readFileSync.mockReturnValue(JSON.stringify(existing))
    mocks.getAllWindows.mockReturnValue([{ isDestroyed: () => false, webContents: { send: mocks.send } }])

    addHistoryEntry(SAMPLE_ENTRY)

    await vi.waitFor(
      () => {
        expect(mocks.writeFileSync).toHaveBeenCalled()
      },
      { timeout: 3000, interval: 50 },
    )

    const writeCall = mocks.writeFileSync.mock.calls[0]
    const written = JSON.parse(writeCall[1] as string)
    expect(written).toHaveLength(100)
    expect(written[0].id).toBe('test-1')
  })

  it('handles missing window gracefully', async () => {
    mocks.existsSync.mockReturnValue(true)
    mocks.readFileSync.mockReturnValue('[]')
    mocks.getAllWindows.mockReturnValue([])

    addHistoryEntry(SAMPLE_ENTRY)

    // Should still write, even without windows
    await vi.waitFor(
      () => {
        expect(mocks.writeFileSync).toHaveBeenCalled()
      },
      { timeout: 3000, interval: 50 },
    )
  })
})

describe('clearHistory', () => {
  it('writes empty array', () => {
    clearHistory()
    expect(mocks.writeFileSync).toHaveBeenCalledWith(expect.stringContaining('history.json'), '[]')
  })
})
