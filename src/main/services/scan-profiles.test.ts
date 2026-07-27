import { describe, expect, it } from 'vitest'
import type { ScanProfile } from './scan-profiles'
import { SCAN_PROFILES } from './scan-profiles'

describe('ScanProfiles', () => {
  it('all 4 profiles exist with correct structure', () => {
    const expectedIds = ['quick', 'normal', 'full', 'custom']
    for (const id of expectedIds) {
      const profile = SCAN_PROFILES[id]!
      expect(profile).toBeDefined()
      expect(profile.id).toBe(id)
      expect(typeof profile.name).toBe('string')
      expect(typeof profile.description).toBe('string')
      expect(typeof profile.icon).toBe('string')
      expect(Array.isArray(profile.scanDirs)).toBe(true)
      expect(Array.isArray(profile.scanTypes)).toBe(true)
      expect(typeof profile.maxFileSize).toBe('number')
      expect(typeof profile.maxDepth).toBe('number')
      expect(['quick', 'normal', 'full']).toContain(profile.duration)
    }
  })

  it('quick profile has minimal scan types', () => {
    const quick = SCAN_PROFILES.quick as ScanProfile
    expect(quick.scanTypes).toEqual(['yara'])
    expect(quick.maxFileSize).toBe(10)
    expect(quick.maxDepth).toBe(2)
    expect(quick.duration).toBe('quick')
    expect(quick.scanDirs.length).toBe(2)
  })

  it('full profile scans all users', () => {
    const full = SCAN_PROFILES.full as ScanProfile
    expect(full.scanDirs.length).toBe(4)
    for (const dir of full.scanDirs) {
      expect(dir).toContain('C:\\Users\\*')
    }
    expect(full.scanTypes).toContain('yara')
    expect(full.scanTypes).toContain('heuristic')
    expect(full.scanTypes).toContain('persistence')
    expect(full.maxFileSize).toBe(200)
    expect(full.maxDepth).toBe(10)
    expect(full.duration).toBe('full')
  })

  it('custom profile has empty dirs', () => {
    const custom = SCAN_PROFILES.custom as ScanProfile
    expect(custom.scanDirs).toEqual([])
    expect(custom.scanTypes.length).toBe(6)
    expect(custom.id).toBe('custom')
    expect(custom.duration).toBe('normal')
  })

  it('profile IDs match expected values', () => {
    const ids = Object.keys(SCAN_PROFILES)
    expect(ids).toEqual(['quick', 'normal', 'full', 'custom'])
  })

  it('normal profile has all scan types', () => {
    const normal = SCAN_PROFILES.normal as ScanProfile
    expect(normal.scanTypes).toEqual(['yara', 'heuristic', 'script', 'persistence', 'ads', 'hosts'])
    expect(normal.scanDirs.length).toBe(5)
    expect(normal.maxFileSize).toBe(50)
    expect(normal.duration).toBe('normal')
  })

  it('profile can be used to configure scan options', () => {
    const profile = SCAN_PROFILES.normal as ScanProfile
    const scanOptions = {
      directories: profile.scanDirs,
      scanTypes: profile.scanTypes,
      maxFileSize: profile.maxFileSize,
      maxDepth: profile.maxDepth,
    }
    expect(scanOptions.directories).toEqual(profile.scanDirs)
    expect(scanOptions.scanTypes).toContain('yara')
    expect(scanOptions.maxFileSize).toBe(50)
    expect(scanOptions.maxDepth).toBe(5)
  })
})
