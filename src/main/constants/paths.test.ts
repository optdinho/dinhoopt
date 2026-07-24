import { describe, expect, it } from 'vitest'
import {
  APP_PATHS,
  BROWSER_PATHS,
  DEFAULT_STEAM_LIBRARIES,
  GAMING_PATHS,
  GPU_CACHE_PATHS,
  STEAM_REDIST_PATTERNS,
  SYSTEM_PATHS,
  UNINSTALL_LEFTOVER_DIRS,
} from './paths'

describe('SYSTEM_PATHS', () => {
  it('contains all expected keys', () => {
    const keys = Object.keys(SYSTEM_PATHS)
    expect(keys).toContain('userTemp')
    expect(keys).toContain('systemTemp')
    expect(keys).toContain('prefetch')
    expect(keys).toContain('windowsLogs')
    expect(keys).toContain('setupLogs')
    expect(keys).toContain('thumbnailCache')
    expect(keys).toContain('fontCache')
    expect(keys).toContain('dxShaderCache')
    expect(keys).toContain('inetCache')
    expect(keys).toContain('windowsUpdateCache')
    expect(keys).toContain('deliveryOptimization')
    expect(keys).toContain('errorReports')
    expect(keys).toContain('systemErrorReports')
    expect(keys).toContain('crashDumps')
    expect(keys).toContain('memoryDumps')
    expect(keys).toContain('fullMemoryDump')
    expect(keys).toContain('installerPatchCache')
    expect(keys).toContain('appxStaging')
    expect(keys).toContain('eventLogs')
    expect(keys).toContain('defenderScanHistory')
    expect(keys).toContain('windowsOld')
    expect(keys.length).toBe(21)
  })

  it('all paths are non-empty strings', () => {
    for (const v of Object.values(SYSTEM_PATHS)) {
      expect(typeof v).toBe('string')
      expect(v.length).toBeGreaterThan(0)
    }
  })
})

describe('BROWSER_PATHS', () => {
  it('covers all expected browsers', () => {
    expect(Object.keys(BROWSER_PATHS)).toEqual(['chrome', 'edge', 'brave', 'opera', 'operaGX', 'vivaldi', 'firefox'])
  })

  it('each chromium-based browser has cache keys', () => {
    for (const key of ['chrome', 'edge', 'brave', 'opera', 'operaGX', 'vivaldi'] as const) {
      const entry = BROWSER_PATHS[key]
      if ('codeCache' in entry) {
        expect(entry.base).toBeTruthy()
        expect(entry.cache).toBeTruthy()
        expect(entry.codeCache).toBeTruthy()
        expect(entry.gpuCache).toBeTruthy()
        expect(entry.serviceWorker).toBeTruthy()
      }
    }
  })

  it('firefox has base and cache', () => {
    expect(BROWSER_PATHS.firefox.base).toBeTruthy()
    expect(BROWSER_PATHS.firefox.cache).toBeTruthy()
  })
})

describe('APP_PATHS', () => {
  it('contains all expected app entries', () => {
    const ids = APP_PATHS.map((a) => a.id)
    expect(ids).toContain('discord')
    expect(ids).toContain('teams')
    expect(ids).toContain('slack')
    expect(ids).toContain('zoom')
    expect(ids).toContain('telegram')
    expect(ids).toContain('vscode')
    expect(ids).toContain('jetbrains')
    expect(ids).toContain('spotify')
    expect(ids).toContain('obs')
    expect(ids).toContain('adobe')
    expect(ids).toContain('npm')
    expect(ids).toContain('yarn')
    expect(ids).toContain('pnpm')
    expect(ids).toContain('bun')
    expect(ids).toContain('pip')
    expect(ids).toContain('nuget')
    expect(ids).toContain('cargo')
    expect(ids).toContain('go')
    expect(ids).toContain('gradle')
    expect(ids).toContain('maven')
    expect(ids).toContain('composer')
    expect(ids).toContain('docker')
  })

  it('each entry has id, name, and non-empty paths', () => {
    for (const entry of APP_PATHS) {
      expect(typeof entry.id).toBe('string')
      expect(entry.id.length).toBeGreaterThan(0)
      expect(typeof entry.name).toBe('string')
      expect(entry.name.length).toBeGreaterThan(0)
      expect(Array.isArray(entry.paths)).toBe(true)
      expect(entry.paths.length).toBeGreaterThan(0)
      for (const p of entry.paths) {
        expect(typeof p).toBe('string')
        expect(p.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('GAMING_PATHS', () => {
  it('contains all expected gaming launchers', () => {
    const ids = GAMING_PATHS.map((g) => g.id)
    expect(ids).toContain('steam')
    expect(ids).toContain('epic')
    expect(ids).toContain('ea')
    expect(ids).toContain('ubisoft')
    expect(ids).toContain('gog')
    expect(ids).toContain('battlenet')
    expect(ids).toContain('riot')
    expect(ids).toContain('xbox')
  })

  it('each entry has id, name, and non-empty paths', () => {
    for (const entry of GAMING_PATHS) {
      expect(typeof entry.id).toBe('string')
      expect(typeof entry.name).toBe('string')
      expect(Array.isArray(entry.paths)).toBe(true)
      expect(entry.paths.length).toBeGreaterThan(0)
    }
  })
})

describe('GPU_CACHE_PATHS', () => {
  it('contains nvidia and amd entries', () => {
    const ids = GPU_CACHE_PATHS.map((g) => g.id)
    expect(ids).toContain('nvidia')
    expect(ids).toContain('amd')
  })
})

describe('UNINSTALL_LEFTOVER_DIRS', () => {
  it('contains all expected directories', () => {
    const ids = UNINSTALL_LEFTOVER_DIRS.map((d) => d.id)
    expect(ids).toEqual(['localappdata', 'appdata', 'programfiles', 'programfiles-x86', 'programdata'])
  })
})

describe('STEAM_REDIST_PATTERNS', () => {
  it('contains common redist folder names', () => {
    expect(STEAM_REDIST_PATTERNS).toContain('_CommonRedist')
    expect(STEAM_REDIST_PATTERNS).toContain('Redist')
    expect(STEAM_REDIST_PATTERNS.length).toBeGreaterThan(10)
  })
})

describe('DEFAULT_STEAM_LIBRARIES', () => {
  it('contains at least the default paths', () => {
    expect(DEFAULT_STEAM_LIBRARIES.length).toBeGreaterThanOrEqual(3)
    expect(DEFAULT_STEAM_LIBRARIES.some((p) => p.includes('Steam'))).toBe(true)
  })
})
