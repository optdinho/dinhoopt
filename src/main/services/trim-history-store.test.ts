import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let testDir: string

vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getPath: () => testDir,
  },
}))

import {
  _resetTrimHistoryPathCache,
  getLastTrimAt,
  getTrimHistory,
  isThrottled,
  setLastTrimAt,
} from './trim-history-store'

describe('trim-history-store', () => {
  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'kudu-trim-test-'))
    _resetTrimHistoryPathCache()
  })

  afterEach(() => {
    if (testDir && existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('returns empty object when no file exists', () => {
    expect(getTrimHistory()).toEqual({})
    expect(getLastTrimAt('C')).toBeNull()
  })

  it('persists and reads back a timestamp', () => {
    const now = Date.now()
    setLastTrimAt('C', now)
    expect(getLastTrimAt('C')).toBe(now)
    expect(existsSync(join(testDir, 'trim-history.json'))).toBe(true)
  })

  it('keeps multiple drives independently', () => {
    setLastTrimAt('C', 1000)
    setLastTrimAt('/home', 2000)
    expect(getLastTrimAt('C')).toBe(1000)
    expect(getLastTrimAt('/home')).toBe(2000)
  })

  it('recovers from a malformed JSON file by treating it as empty', () => {
    writeFileSync(join(testDir, 'trim-history.json'), '{not json', 'utf-8')
    expect(getTrimHistory()).toEqual({})
    setLastTrimAt('C', 5000)
    expect(getLastTrimAt('C')).toBe(5000)
  })

  it('ignores non-numeric values in the persisted file', () => {
    writeFileSync(join(testDir, 'trim-history.json'), JSON.stringify({ C: 'bad', D: 1234, E: null }), 'utf-8')
    expect(getTrimHistory()).toEqual({ D: 1234 })
  })

  it('isThrottled is true within 24h, false outside', () => {
    const now = Date.now()
    setLastTrimAt('C', now - 1000)
    expect(isThrottled('C', now)).toBe(true)

    setLastTrimAt('C', now - 25 * 60 * 60 * 1000)
    expect(isThrottled('C', now)).toBe(false)
  })

  it('isThrottled is false when there is no history for the drive', () => {
    expect(isThrottled('Z')).toBe(false)
  })
})
