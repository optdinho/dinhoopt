import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

const TEST_DIR = join(tmpdir(), `kudu-settings-full-${randomUUID()}`)

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getPath: () => TEST_DIR,
  },
}))

import {
  flushSettings,
  getMachineId,
  getOnboardingComplete,
  getSettings,
  setOnboardingComplete,
  setSettings,
  updateScheduleEntry,
} from './settings-store'
import { createJsonStore } from './store-base'

describe('settings-store readStore migration', () => {
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('migrates old schedule format to new schedule entry format', () => {
    mkdirSync(join(TEST_DIR, 'DiNho-Dev'), { recursive: true })
    writeFileSync(
      join(TEST_DIR, 'DiNho-Dev', 'config.json'),
      JSON.stringify({
        settings: {
          schedule: { enabled: true, frequency: 'daily', day: 3, hour: 22 },
          schedules: [],
        },
      }),
      'utf-8',
    )
    const s = getSettings()
    expect(s.schedules).toHaveLength(1)
    expect(s.schedules[0]!.frequency).toBe('daily')
    expect(s.schedules[0]!.hour).toBe(22)
    expect(s.schedules[0]!.day).toBe(3)
    expect(s.schedule.enabled).toBe(false)
  })
})

describe('settings-store readStore error', () => {
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it('returns defaults when config file is corrupt', () => {
    mkdirSync(join(TEST_DIR, 'DiNho-Dev'), { recursive: true })
    writeFileSync(join(TEST_DIR, 'DiNho-Dev', 'config.json'), '{corrupt json}', 'utf-8')
    const s = getSettings()
    expect(s.theme).toBe('dark')
    expect(s.language).toBe('en')
  })
})

describe('settings-store onboarding', () => {
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await flushSettings()
  })

  it('getOnboardingComplete returns false initially', () => {
    expect(getOnboardingComplete()).toBe(false)
  })

  it('setOnboardingComplete persists true', async () => {
    await setOnboardingComplete(true)
    await flushSettings()
    expect(getOnboardingComplete()).toBe(true)
  })
})

describe('settings-store getMachineId', () => {
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await flushSettings()
  })

  it('generates and returns a string ID', () => {
    const id = getMachineId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })

  it('returns the same ID on repeated calls', () => {
    const id1 = getMachineId()
    const id2 = getMachineId()
    expect(id1).toBe(id2)
  })
})

describe('settings-store updateScheduleEntry', () => {
  afterAll(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true })
  })

  beforeEach(async () => {
    await flushSettings()
  })

  it('updates a matching schedule entry', async () => {
    const entry = {
      id: randomUUID(),
      name: 'Test Scan',
      enabled: true,
      frequency: 'weekly' as const,
      day: 1,
      hour: 9,
      minute: 0,
      tasks: ['cleaner:system' as const],
      autoApply: false,
      lastRunAt: null,
      lastRunStatus: 'never' as const,
      createdAt: new Date().toISOString(),
    }
    setSettings({ schedules: [entry] })
    await flushSettings()

    updateScheduleEntry(entry.id, { name: 'Updated Scan', autoApply: true })
    await flushSettings()
    const updated = getSettings().schedules.find((s) => s.id === entry.id)
    expect(updated?.name).toBe('Updated Scan')
    expect(updated?.autoApply).toBe(true)
  })

  it('ignores non-matching schedule id', async () => {
    const before = getSettings().schedules.length
    updateScheduleEntry('no-such-id', { name: 'Ghost Scan' })
    await flushSettings()
    expect(getSettings().schedules.length).toBe(before)
  })
})

describe('store-base createJsonStore', () => {
  it('path getter returns the store file path', () => {
    const s = createJsonStore({ name: 'test.json', defaults: { a: 1 } })
    expect(s.path).toContain('test.json')
  })

  it('update reads, mutates, and saves data', () => {
    const s = createJsonStore<{ items: number[] }>({
      name: 'list-store.json',
      defaults: { items: [] },
    })
    const result = s.update((data) => {
      data.items.push(42)
      return data
    })
    expect(result.items).toEqual([42])
    // Verify persistence
    const loaded = s.load()
    expect(loaded.items).toEqual([42])
  })
})
