import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const tmp = mkdtempSync(join(tmpdir(), 'tweaks-snapshot-'))
const mockGetHwidSync = vi.fn().mockReturnValue('machine-1')

vi.mock('electron', () => ({
  app: { getPath: () => tmp },
}))

vi.mock('../hwid', () => ({
  getHwidSync: () => mockGetHwidSync(),
}))

import { getSnapshotEntry, getSnapshotFilePath, loadSnapshotEntries, saveSnapshotEntry } from './snapshot-store'

describe('snapshot-store', () => {
  beforeEach(() => {
    mockGetHwidSync.mockReturnValue('machine-1')
    try {
      rmSync(getSnapshotFilePath(), { force: true })
    } catch {
      /* noop */
    }
  })

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true })
  })

  it('saves and reloads an entry', () => {
    saveSnapshotEntry('mouse-speed', { exists: true, data: '0x1', regType: 'REG_DWORD' })
    expect(loadSnapshotEntries()).toEqual({
      'mouse-speed': { exists: true, data: '0x1', regType: 'REG_DWORD' },
    })
    expect(getSnapshotEntry('mouse-speed')).toEqual({ exists: true, data: '0x1', regType: 'REG_DWORD' })
  })

  it('persists the machineId so the file is per-machine', () => {
    saveSnapshotEntry('a', { exists: true, data: '0x1', regType: 'REG_DWORD' })
    const raw = JSON.parse(readFileSync(getSnapshotFilePath(), 'utf-8')) as { machineId: string }
    expect(raw.machineId).toBe('machine-1')
  })

  it('ignores entries created on another machine', () => {
    saveSnapshotEntry('a', { exists: true, data: '0x1', regType: 'REG_DWORD' })
    mockGetHwidSync.mockReturnValue('machine-2')
    expect(loadSnapshotEntries()).toEqual({})
    expect(getSnapshotEntry('a')).toBeUndefined()
  })

  it('treats a corrupt file as an empty snapshot', () => {
    writeFileSync(getSnapshotFilePath(), '{not json', 'utf-8')
    expect(loadSnapshotEntries()).toEqual({})
    expect(getSnapshotEntry('a')).toBeUndefined()
  })

  it('saving the same tweak replaces the previous entry', () => {
    saveSnapshotEntry('a', { exists: true, data: '0x1', regType: 'REG_DWORD' })
    saveSnapshotEntry('a', { exists: false })
    expect(loadSnapshotEntries()).toEqual({ a: { exists: false } })
  })
})
