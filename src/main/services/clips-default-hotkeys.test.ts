import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/mock/user-data'),
    isPackaged: false,
  },
}))

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  renameSync: vi.fn(),
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}))

import { existsSync } from 'node:fs'
import type { HotkeyBinding } from '@shared/types'
import { loadClipsConfig } from './clips-config-store'
import { DEFAULT_HOTKEYS, defaultHotkeys } from './clips-default-hotkeys'

describe('clips-default-hotkeys (canonical source of truth)', () => {
  it('returns exactly the canonical set (F12 save 300s, F11 save 120s, Alt+1 screenshot)', () => {
    expect(defaultHotkeys()).toStrictEqual([
      {
        id: 'hk-save-8',
        vk: 123,
        modifiers: [],
        action: 'saveClip',
        replayDurationSeconds: 300,
        enabled: true,
      },
      {
        id: 'hk-1782208376874',
        vk: 122,
        modifiers: [],
        action: 'saveClip',
        replayDurationSeconds: 120,
        enabled: true,
      },
      {
        id: 'hk-1782222941097',
        vk: 49,
        modifiers: ['Alt'],
        action: 'screenshot',
        replayDurationSeconds: 60,
        enabled: true,
      },
    ])
  })

  it("matches the store's new-install defaults (single source of truth)", () => {
    vi.mocked(existsSync).mockReturnValue(false)
    expect(loadClipsConfig().hotkeys).toStrictEqual(DEFAULT_HOTKEYS)
  })

  it('returns fresh copies (entries and modifiers arrays) so callers can never mutate the canonical set', () => {
    const a = defaultHotkeys()
    const b = defaultHotkeys()
    expect(a).not.toBe(b)
    expect(a[0]).not.toBe(b[0])
    expect(a[0]?.modifiers).not.toBe(b[0]?.modifiers)
    a.length = 0
    a.push({
      id: 'mutated',
      vk: 1,
      modifiers: [],
      action: 'saveClip',
      replayDurationSeconds: 1,
      enabled: true,
    })
    expect(defaultHotkeys()).toHaveLength(3)
    expect(DEFAULT_HOTKEYS).toHaveLength(3)
    expect(defaultHotkeys()[0]?.vk).toBe(123)
  })

  it('canonical entries are fully populated HotkeyBinding objects', () => {
    for (const hk of defaultHotkeys()) {
      expect(typeof hk.id).toBe('string')
      expect(hk.id.length).toBeGreaterThan(0)
      expect(typeof hk.vk).toBe('number')
      expect(Array.isArray(hk.modifiers)).toBe(true)
      expect(typeof hk.enabled).toBe('boolean')
    }
    // The screenshot binding is the only one with a modifier and no fixed duration contract
    const screenshot = defaultHotkeys().find((hk: HotkeyBinding) => hk.action === 'screenshot')
    expect(screenshot?.modifiers).toStrictEqual(['Alt'])
    expect(screenshot?.vk).toBe(49)
  })
})
