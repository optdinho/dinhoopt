import { describe, it, expect, vi, beforeEach } from 'vitest'
import { getCatalog, getCatalogByCategory, DNS_PRESETS, REG_TYPE_RE } from './windows-tweaks.ipc'
import type { WindowsTweakCategory } from '@shared/types'

const CATEGORY_EXPECTED_COUNTS: Record<WindowsTweakCategory, number> = {
  mouse: 4,
  keyboard: 1,
  accessibility: 4,
  network: 10,
  gpu: 4,
  system: 13,
  gaming: 12,
  privacy: 6,
  mmcss: 7,
  energy: 1,
}

const TOTAL_TWEAKS = Object.values(CATEGORY_EXPECTED_COUNTS).reduce((a, b) => a + b, 0)

describe('getCatalog', () => {
  it('returns all tweaks', () => {
    const catalog = getCatalog()
    expect(catalog.length).toBe(TOTAL_TWEAKS)
  })

  it('every tweak has all required fields', () => {
    const catalog = getCatalog()
    for (const t of catalog) {
      expect(t.id).toBeTruthy()
      expect(t.name).toBeTruthy()
      expect(t.category).toBeTruthy()
      expect(t.level).toMatch(/^(basico|medio|full)$/)
      expect(t.hive).toMatch(/^HKEY_(CURRENT_USER|LOCAL_MACHINE)$/)
      expect(t.path).toBeTruthy()
      expect(t.key).toBeTruthy()
      expect(t.kind).toMatch(/^(DWord|String)$/)
      expect(t.defaultValue !== undefined).toBe(true)
      expect(t.optimizedValue !== undefined).toBe(true)
    }
  })

  it('every tweak has a unique id', () => {
    const catalog = getCatalog()
    const ids = catalog.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('no tweak has shell-injectable characters in path or key', () => {
    const catalog = getCatalog()
    for (const t of catalog) {
      expect(t.path).not.toMatch(/[;&|`$(){}]/)
      expect(t.key).not.toMatch(/[;&|`$(){}]/)
    }
  })
})

describe('getCatalogByCategory', () => {
  for (const [cat, expectedCount] of Object.entries(CATEGORY_EXPECTED_COUNTS)) {
    it(`returns ${expectedCount} tweaks for category '${cat}'`, () => {
      const items = getCatalogByCategory(cat as WindowsTweakCategory)
      expect(items.length).toBe(expectedCount)
      for (const item of items) {
        expect(item.category).toBe(cat)
      }
    })
  }

  it('returns empty array for unknown category', () => {
    const items = getCatalogByCategory('unknown' as WindowsTweakCategory)
    expect(items.length).toBe(0)
  })
})

describe('DNS_PRESETS', () => {
  it('has 4 presets', () => {
    expect(DNS_PRESETS.length).toBe(4)
  })

  it('Cloudflare is first', () => {
    expect(DNS_PRESETS[0].name).toBe('Cloudflare')
    expect(DNS_PRESETS[0].primary).toBe('1.1.1.1')
    expect(DNS_PRESETS[0].secondary).toBe('1.0.0.1')
  })

  it('all presets have valid IPs', () => {
    const ipRe = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/
    for (const p of DNS_PRESETS) {
      expect(p.primary).toMatch(ipRe)
      expect(p.secondary).toMatch(ipRe)
    }
  })
})

describe('REG_TYPE_RE', () => {
  const re = REG_TYPE_RE

  it('matches standard reg.exe output line', () => {
    const line = '    MouseSpeed    REG_SZ    0'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_SZ')
    expect(match![2].trim()).toBe('0')
  })

  it('matches DWord value', () => {
    const line = '    HwSchMode    REG_DWORD    0x2'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_DWORD')
    expect(match![2].trim()).toBe('0x2')
  })

  it('matches string value with spaces', () => {
    const line = '    Scheduling Category    REG_SZ    High'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_SZ')
    expect(match![2].trim()).toBe('High')
  })

  it('matches REG_BINARY (future-proof)', () => {
    const line = '    SomeValue    REG_BINARY    DEADBEEF'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_BINARY')
  })

  it('matches REG_MULTI_SZ (future-proof)', () => {
    const line = '    MultiValue    REG_MULTI_SZ    val1'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_MULTI_SZ')
  })

  it('matches REG_EXPAND_SZ (future-proof)', () => {
    const line = '    ExpValue    REG_EXPAND_SZ    %PATH%'
    const match = line.match(re)
    expect(match).not.toBeNull()
    expect(match![1]).toBe('REG_EXPAND_SZ')
  })

  it('does not match line without key', () => {
    const line = 'HKEY_CURRENT_USER\\Control Panel\\Mouse'
    expect(line.match(re)).toBeNull()
  })

  it('does not match empty line', () => {
    expect(''.match(re)).toBeNull()
  })

  it('does not match garbage', () => {
    expect('abc'.match(re)).toBeNull()
  })
})
