import { beforeEach, describe, expect, it, vi } from 'vitest'
import { checkForUpdates, clearUpdateCache, isValidAppId, runUpdates } from './handlers'

const checkForUpdatesWingetMock = vi.hoisted(() => vi.fn())
const isWingetAvailableMock = vi.hoisted(() => vi.fn())
const runUpdatesWingetMock = vi.hoisted(() => vi.fn())

vi.mock('./checkers/winget', () => ({
  checkForUpdatesWinget: checkForUpdatesWingetMock,
  isWingetAvailable: isWingetAvailableMock,
  runUpdatesWinget: runUpdatesWingetMock,
}))

beforeEach(() => {
  vi.clearAllMocks()
  clearUpdateCache()
})

function noopProgress() {
  // no-op
}

// ─── checkForUpdates ────────────────────────────────────────

describe('checkForUpdates', () => {
  it('returns winget result when winget is available', async () => {
    isWingetAvailableMock.mockResolvedValue(true)
    checkForUpdatesWingetMock.mockResolvedValue({
      apps: [{ id: 'app1', name: 'App1', severity: 'major', selected: true, source: 'winget' }],
      totalCount: 1,
      majorCount: 1,
      minorCount: 0,
      patchCount: 0,
      packageManagerAvailable: true,
      packageManagerName: 'winget',
    })

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(true)
    expect(result.totalCount).toBe(1)
    expect(result.majorCount).toBe(1)
    expect(result.packageManagerName).toBe('winget')
    expect(result.apps).toHaveLength(1)
  })

  it('returns unavailable when winget is not available', async () => {
    isWingetAvailableMock.mockResolvedValue(false)

    const result = await checkForUpdates()
    expect(result.packageManagerAvailable).toBe(false)
    expect(result.packageManagerName).toBeNull()
    expect(result.apps).toEqual([])
    expect(result.totalCount).toBe(0)
  })

  it('caches result within TTL', async () => {
    isWingetAvailableMock.mockResolvedValue(true)
    checkForUpdatesWingetMock.mockResolvedValue({
      apps: [], totalCount: 0, majorCount: 0, minorCount: 0, patchCount: 0,
      packageManagerAvailable: true, packageManagerName: 'winget',
    })

    await checkForUpdates()
    await checkForUpdates()

    expect(checkForUpdatesWingetMock).toHaveBeenCalledTimes(1)
  })

  it('clears cache when clearUpdateCache is called', async () => {
    isWingetAvailableMock.mockResolvedValue(true)
    checkForUpdatesWingetMock.mockResolvedValue({
      apps: [], totalCount: 0, majorCount: 0, minorCount: 0, patchCount: 0,
      packageManagerAvailable: true, packageManagerName: 'winget',
    })

    await checkForUpdates()
    clearUpdateCache()
    await checkForUpdates()

    expect(checkForUpdatesWingetMock).toHaveBeenCalledTimes(2)
  })
})

// ─── runUpdates ─────────────────────────────────────────────

describe('runUpdates', () => {
  it('calls winget when available', async () => {
    isWingetAvailableMock.mockResolvedValue(true)
    runUpdatesWingetMock.mockResolvedValue({ succeeded: 2, failed: 0, errors: [] })

    const result = await runUpdates(['app'], noopProgress)
    expect(runUpdatesWingetMock).toHaveBeenCalledWith(['app'], noopProgress)
    expect(result.succeeded).toBe(2)
  })

  it('ignores source parameter and always uses winget', async () => {
    isWingetAvailableMock.mockResolvedValue(true)
    runUpdatesWingetMock.mockResolvedValue({ succeeded: 1, failed: 0, errors: [] })

    const result = await runUpdates(['app'], noopProgress, 'scoop')
    expect(runUpdatesWingetMock).toHaveBeenCalled()
    expect(result.succeeded).toBe(1)
  })

  it('returns failure when winget is not available', async () => {
    isWingetAvailableMock.mockResolvedValue(false)

    const result = await runUpdates(['app'], noopProgress)
    expect(result.failed).toBe(1)
    expect(result.errors[0]?.reason).toBe('No package manager available')
  })

  it('handles empty appIds', async () => {
    isWingetAvailableMock.mockResolvedValue(true)
    runUpdatesWingetMock.mockResolvedValue({ succeeded: 0, failed: 0, errors: [] })

    const result = await runUpdates([], noopProgress)
    expect(result.succeeded).toBe(0)
    expect(result.failed).toBe(0)
  })
})

// ─── isValidAppId ───────────────────────────────────────────

describe('isValidAppId', () => {
  it('accepts valid app IDs', () => {
    expect(isValidAppId('7zip.7zip')).toBe(true)
    expect(isValidAppId('Google.Chrome')).toBe(true)
    expect(isValidAppId('some-package-123')).toBe(true)
    expect(isValidAppId('a')).toBe(true)
  })

  it('rejects empty string', () => {
    expect(isValidAppId('')).toBe(false)
  })

  it('rejects IDs starting with dot', () => {
    expect(isValidAppId('.test')).toBe(false)
  })
})
