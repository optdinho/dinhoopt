import { describe, expect, it } from 'vitest'
import { validateHistoryEntry, validateSettingsPartial, validateStringArray } from './ipc-validation'

describe('validateSettingsPartial', () => {
  it('accepts valid boolean settings', () => {
    const input = { minimizeToTray: true, autoUpdate: false }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('rejects null', () => {
    expect(validateSettingsPartial(null)).toBeNull()
  })

  it('rejects arrays', () => {
    expect(validateSettingsPartial([1, 2])).toBeNull()
  })

  it('rejects primitives', () => {
    expect(validateSettingsPartial('string')).toBeNull()
    expect(validateSettingsPartial(42)).toBeNull()
  })

  it('ignores unknown top-level keys', () => {
    expect(validateSettingsPartial({ hackerField: true })).toBeNull()
  })

  it('rejects wrong types for boolean fields', () => {
    expect(validateSettingsPartial({ minimizeToTray: 'yes' })).toBeNull()
    expect(validateSettingsPartial({ runAtStartup: 1 })).toBeNull()
  })

  it('accepts valid exclusions array', () => {
    const input = { exclusions: ['C:\\keep', '*.log'] }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('rejects non-array exclusions', () => {
    expect(validateSettingsPartial({ exclusions: 'C:\\keep' })).toBeNull()
  })

  it('rejects exclusions with non-string entries', () => {
    expect(validateSettingsPartial({ exclusions: [123] })).toBeNull()
  })

  it('rejects too many exclusions', () => {
    const exclusions = Array.from({ length: 201 }, (_, i) => `path-${i}`)
    expect(validateSettingsPartial({ exclusions })).toBeNull()
  })

  it('rejects empty string exclusions', () => {
    expect(validateSettingsPartial({ exclusions: [''] })).toBeNull()
  })

  it('rejects overly long exclusion strings', () => {
    expect(validateSettingsPartial({ exclusions: ['x'.repeat(501)] })).toBeNull()
  })

  it('accepts valid ignoredSoftwareUpdates array', () => {
    const input = { ignoredSoftwareUpdates: ['Google.Chrome', 'Mozilla.Firefox'] }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('rejects non-array ignoredSoftwareUpdates', () => {
    expect(validateSettingsPartial({ ignoredSoftwareUpdates: 'Google.Chrome' })).toBeNull()
  })

  it('rejects ignoredSoftwareUpdates with non-string entries', () => {
    expect(validateSettingsPartial({ ignoredSoftwareUpdates: [42] })).toBeNull()
  })

  it('rejects empty string in ignoredSoftwareUpdates', () => {
    expect(validateSettingsPartial({ ignoredSoftwareUpdates: [''] })).toBeNull()
  })

  it('accepts valid schedule', () => {
    const input = { schedule: { enabled: true, frequency: 'daily', day: 0, hour: 9 } }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('rejects invalid schedule frequency', () => {
    expect(validateSettingsPartial({ schedule: { frequency: 'yearly' } })).toBeNull()
  })

  it('rejects out-of-range schedule hour', () => {
    expect(validateSettingsPartial({ schedule: { hour: 24 } })).toBeNull()
    expect(validateSettingsPartial({ schedule: { hour: -1 } })).toBeNull()
  })

  it('rejects out-of-range schedule day', () => {
    expect(validateSettingsPartial({ schedule: { day: 7 } })).toBeNull()
  })

  it('rejects schedule as array', () => {
    expect(validateSettingsPartial({ schedule: [] })).toBeNull()
  })

  it('rejects unknown schedule keys', () => {
    expect(validateSettingsPartial({ schedule: { enabled: true, foo: 'bar' } })).toBeNull()
  })

  it('accepts valid cleaner settings', () => {
    const input = { cleaner: { skipRecentMinutes: 120, secureDelete: true } }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('rejects cleaner with invalid skipRecentMinutes', () => {
    expect(validateSettingsPartial({ cleaner: { skipRecentMinutes: -1 } })).toBeNull()
    expect(validateSettingsPartial({ cleaner: { skipRecentMinutes: 600000 } })).toBeNull()
  })

  it('rejects cleaner with wrong boolean types', () => {
    expect(validateSettingsPartial({ cleaner: { secureDelete: 'yes' } })).toBeNull()
  })

  it('rejects unknown cleaner keys', () => {
    expect(validateSettingsPartial({ cleaner: { unknownKey: true } })).toBeNull()
  })

  it('accepts a valid backupPath', () => {
    // path.isAbsolute is platform-aware, so use a path absolute on the current OS.
    const backupPath = process.platform === 'win32' ? 'C:\\Users\\dave\\Backups' : '/Users/dave/Backups'
    const input = { backupPath }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('accepts an empty backupPath (means default)', () => {
    expect(validateSettingsPartial({ backupPath: '' })).toEqual({ backupPath: '' })
  })

  it('rejects non-string backupPath', () => {
    expect(validateSettingsPartial({ backupPath: 42 })).toBeNull()
  })

  it('rejects backupPath with path traversal', () => {
    expect(validateSettingsPartial({ backupPath: 'C:\\..\\evil' })).toBeNull()
  })

  it('rejects overly long backupPath', () => {
    expect(validateSettingsPartial({ backupPath: 'x'.repeat(1001) })).toBeNull()
  })

  it('rejects a relative backupPath', () => {
    // Relative paths would be silently ignored at runtime, so reject at the boundary.
    expect(validateSettingsPartial({ backupPath: 'relative/dir' })).toBeNull()
  })

  it('accepts valid theme values', () => {
    expect(validateSettingsPartial({ theme: 'dark' })).toEqual({ theme: 'dark' })
    expect(validateSettingsPartial({ theme: 'light' })).toEqual({ theme: 'light' })
    expect(validateSettingsPartial({ theme: 'system' })).toEqual({ theme: 'system' })
  })

  it('rejects invalid theme values', () => {
    expect(validateSettingsPartial({ theme: 'blue' })).toBeNull()
    expect(validateSettingsPartial({ theme: 123 })).toBeNull()
  })

  it('rejects windowsPackageManager (deprecated config key)', () => {
    expect(validateSettingsPartial({ windowsPackageManager: 'winget' })).toBeNull()
    expect(validateSettingsPartial({ windowsPackageManager: 123 })).toBeNull()
    expect(validateSettingsPartial({ windowsPackageManager: '' })).toBeNull()
  })

  it('accepts empty object', () => {
    expect(validateSettingsPartial({})).toEqual({})
  })

  it('accepts valid schedules array', () => {
    const input = {
      schedules: [
        {
          id: 'abc-123',
          name: 'Weekly Clean',
          enabled: true,
          frequency: 'weekly',
          day: 1,
          hour: 9,
          minute: 0,
          tasks: ['cleaner:system', 'cleaner:browsers'],
          autoApply: false,
          lastRunAt: null,
          lastRunStatus: 'never',
          createdAt: '2025-01-01T00:00:00Z',
        },
      ],
    }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('rejects schedules with invalid task types', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            minute: 0,
            tasks: ['badtask'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects non-array schedules', () => {
    expect(validateSettingsPartial({ schedules: 'not-array' })).toBeNull()
  })

  it('rejects too many schedules', () => {
    const schedules = Array.from({ length: 11 }, (_, i) => ({
      id: `id-${i}`,
      name: `S${i}`,
      enabled: true,
      frequency: 'daily',
      day: 0,
      hour: 9,
      minute: 0,
      tasks: ['cleaner:system'],
      autoApply: false,
      lastRunAt: null,
      lastRunStatus: 'never',
      createdAt: '2025-01-01T00:00:00Z',
    }))
    expect(validateSettingsPartial({ schedules })).toBeNull()
  })

  it('rejects schedule entry with missing fields', () => {
    expect(
      validateSettingsPartial({
        schedules: [{ id: 'x', name: 'X' }],
      }),
    ).toBeNull()
  })

  // ── gameMode validation ──────────────────────────

  it('accepts valid gameMode settings', () => {
    const input = {
      gameMode: {
        enabledOptimizations: ['svc-wsearch', 'mem-clear-standby', 'net-flush-dns'],
        customProcessKillList: ['spotify.exe'],
      },
    }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('accepts gameMode with empty arrays', () => {
    const input = { gameMode: { enabledOptimizations: [], customProcessKillList: [] } }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('rejects gameMode with invalid optimization IDs', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: ['invalid-id'], customProcessKillList: [] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with non-array enabledOptimizations', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: 'svc-wsearch', customProcessKillList: [] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with too many optimizations', () => {
    const enabledOptimizations = Array.from({ length: 31 }, () => 'svc-wsearch')
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations, customProcessKillList: [] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with non-string process names', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [123] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with empty process name strings', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [''] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with path traversal in process names', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: ['..\\..\\evil.exe'] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with special characters in process names', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: ['evil;rm -rf /'] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with too many custom processes', () => {
    const customProcessKillList = Array.from({ length: 51 }, (_, i) => `proc${i}.exe`)
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with overly long process names', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: ['x'.repeat(101)] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with unknown keys', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [], extraField: true },
      }),
    ).toBeNull()
  })

  it('rejects gameMode as non-object', () => {
    expect(validateSettingsPartial({ gameMode: 'string' })).toBeNull()
    expect(validateSettingsPartial({ gameMode: [] })).toBeNull()
  })

  it('accepts all valid optimization IDs', () => {
    const allIds = [
      'svc-wsearch',
      'svc-sysmain',
      'svc-wuauserv',
      'svc-spooler',
      'svc-diagtrack',
      'proc-kill-browsers',
      'proc-kill-chat',
      'proc-kill-updaters',
      'proc-kill-custom',
      'mem-clear-standby',
      'sys-focus-assist',
      'sys-power-plan',
      'sys-prevent-sleep',
      'sys-disable-game-bar',
      'sys-disable-fse-opt',
      'sys-disable-transparency',
      'net-flush-dns',
      'net-disable-nagle',
    ]
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: allIds, customProcessKillList: [] },
      }),
    ).not.toBeNull()
  })

  it('accepts process names with dots, hyphens, underscores, and spaces', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          enabledOptimizations: [],
          customProcessKillList: ['my-app.exe', 'My App_v2.exe', 'test 123'],
        },
      }),
    ).not.toBeNull()
  })

  // registryIgnoredTweaks — persisted "ignore this tweak" signatures (issue #172)
  it('accepts a registryIgnoredTweaks array of signature strings', () => {
    const input = { registryIgnoredTweaks: ['hklm\\system\\currentcontrolset\\services\\sysmain|start'] }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('accepts an empty registryIgnoredTweaks array', () => {
    expect(validateSettingsPartial({ registryIgnoredTweaks: [] })).toEqual({ registryIgnoredTweaks: [] })
  })

  it('rejects registryIgnoredTweaks that is not an array', () => {
    expect(validateSettingsPartial({ registryIgnoredTweaks: 'sysmain|start' })).toBeNull()
  })

  it('rejects non-string or empty entries in registryIgnoredTweaks', () => {
    expect(validateSettingsPartial({ registryIgnoredTweaks: [42] })).toBeNull()
    expect(validateSettingsPartial({ registryIgnoredTweaks: [''] })).toBeNull()
  })

  it('rejects an oversized registryIgnoredTweaks list', () => {
    expect(validateSettingsPartial({ registryIgnoredTweaks: Array(201).fill('a|b') })).toBeNull()
  })

  it('accepts valid language codes', () => {
    expect(validateSettingsPartial({ language: 'en' })).toEqual({ language: 'en' })
    expect(validateSettingsPartial({ language: 'zh-CN' })).toEqual({ language: 'zh-CN' })
    expect(validateSettingsPartial({ language: 'pt-BR' })).toEqual({ language: 'pt-BR' })
  })

  it('rejects invalid language codes', () => {
    expect(validateSettingsPartial({ language: 't' })).toBeNull()
    expect(validateSettingsPartial({ language: 'eng' })).toBeNull()
    expect(validateSettingsPartial({ language: 'en_US' })).toBeNull()
    expect(validateSettingsPartial({ language: 'x'.repeat(11) })).toBeNull()
    expect(validateSettingsPartial({ language: 42 })).toBeNull()
  })

  it('accepts valid updateCheckIntervalHours', () => {
    expect(validateSettingsPartial({ updateCheckIntervalHours: 1 })).toEqual({ updateCheckIntervalHours: 1 })
    expect(validateSettingsPartial({ updateCheckIntervalHours: 168 })).toEqual({ updateCheckIntervalHours: 168 })
    expect(validateSettingsPartial({ updateCheckIntervalHours: 24 })).toEqual({ updateCheckIntervalHours: 24 })
  })

  it('rejects invalid updateCheckIntervalHours', () => {
    expect(validateSettingsPartial({ updateCheckIntervalHours: 0 })).toBeNull()
    expect(validateSettingsPartial({ updateCheckIntervalHours: 169 })).toBeNull()
    expect(validateSettingsPartial({ updateCheckIntervalHours: '24' })).toBeNull()
    expect(validateSettingsPartial({ updateCheckIntervalHours: -1 })).toBeNull()
  })

  it('rejects gameMode customGameProcesses with non-array', () => {
    expect(
      validateSettingsPartial({ gameMode: { customGameProcesses: 'spotify.exe', enabledOptimizations: [] } }),
    ).toBeNull()
  })

  it('rejects gameMode customGameProcesses with empty string', () => {
    expect(
      validateSettingsPartial({
        gameMode: { customGameProcesses: [''], enabledOptimizations: [], customProcessKillList: [] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode customGameProcesses with special characters', () => {
    expect(
      validateSettingsPartial({
        gameMode: { customGameProcesses: ['evil;rm'], enabledOptimizations: [], customProcessKillList: [] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode customGameProcesses with overly long name', () => {
    expect(
      validateSettingsPartial({
        gameMode: { customGameProcesses: ['x'.repeat(101)], enabledOptimizations: [], customProcessKillList: [] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode customGameProcesses that exceeds max count', () => {
    const customGameProcesses = Array.from({ length: 51 }, (_, i) => `game${i}.exe`)
    expect(
      validateSettingsPartial({
        gameMode: { customGameProcesses, enabledOptimizations: [], customProcessKillList: [] },
      }),
    ).toBeNull()
  })

  it('accepts valid gameMode customGameProcesses', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          customGameProcesses: ['steam.exe', 'epic.exe'],
          enabledOptimizations: [],
          customProcessKillList: [],
        },
      }),
    ).not.toBeNull()
  })

  it('accepts gameMode gameProfiles', () => {
    const input = {
      gameMode: {
        enabledOptimizations: [],
        customProcessKillList: [],
        gameProfiles: {
          'steam.exe': { gameName: 'Steam', enabledOptimizations: ['mem-clear-standby'] },
        },
      },
    }
    expect(validateSettingsPartial(input)).toEqual(input)
  })

  it('accepts gameMode gameProfiles with multiple profiles under 30 limit', () => {
    const profiles: Record<string, { gameName: string; enabledOptimizations: string[] }> = {}
    for (let i = 0; i < 30; i++) {
      profiles[`proc${i}.exe`] = { gameName: `Game ${i}`, enabledOptimizations: ['svc-wsearch'] }
    }
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [], gameProfiles: profiles },
      }),
    ).not.toBeNull()
  })

  it('rejects gameMode gameProfiles as non-object', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [], gameProfiles: 'string' },
      }),
    ).toBeNull()
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [], gameProfiles: [] },
      }),
    ).toBeNull()
  })

  it('rejects gameMode gameProfiles with too many profiles', () => {
    const profiles: Record<string, { gameName: string; enabledOptimizations: string[] }> = {}
    for (let i = 0; i < 31; i++) {
      profiles[`proc${i}.exe`] = { gameName: `Game ${i}`, enabledOptimizations: ['svc-wsearch'] }
    }
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [], gameProfiles: profiles },
      }),
    ).toBeNull()
  })

  it('rejects gameMode gameProfiles with invalid process name key', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          enabledOptimizations: [],
          customProcessKillList: [],
          gameProfiles: { 'evil;rm': { gameName: 'X', enabledOptimizations: ['mem-clear-standby'] } },
        },
      }),
    ).toBeNull()
  })

  it('rejects gameMode gameProfiles with null profile value', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          enabledOptimizations: [],
          customProcessKillList: [],
          gameProfiles: { 'steam.exe': null },
        },
      }),
    ).toBeNull()
  })

  it('rejects gameMode gameProfiles with missing gameName', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          enabledOptimizations: [],
          customProcessKillList: [],
          gameProfiles: { 'steam.exe': { enabledOptimizations: ['mem-clear-standby'] } },
        },
      }),
    ).toBeNull()
  })

  it('rejects gameMode gameProfiles with gameName too long', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          enabledOptimizations: [],
          customProcessKillList: [],
          gameProfiles: { 'steam.exe': { gameName: 'x'.repeat(101), enabledOptimizations: ['mem-clear-standby'] } },
        },
      }),
    ).toBeNull()
  })

  it('rejects gameMode gameProfiles with non-array enabledOptimizations', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          enabledOptimizations: [],
          customProcessKillList: [],
          gameProfiles: { 'steam.exe': { gameName: 'Steam', enabledOptimizations: 'not-array' } },
        },
      }),
    ).toBeNull()
  })

  it('rejects gameMode gameProfiles with too many optimizations', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          enabledOptimizations: [],
          customProcessKillList: [],
          gameProfiles: { 'steam.exe': { gameName: 'Steam', enabledOptimizations: Array(31).fill('svc-wsearch') } },
        },
      }),
    ).toBeNull()
  })

  it('rejects gameMode gameProfiles with invalid optimization ID', () => {
    expect(
      validateSettingsPartial({
        gameMode: {
          enabledOptimizations: [],
          customProcessKillList: [],
          gameProfiles: { 'steam.exe': { gameName: 'Steam', enabledOptimizations: ['invalid-id'] } },
        },
      }),
    ).toBeNull()
  })

  it('rejects exclusions with path traversal', () => {
    expect(validateSettingsPartial({ exclusions: ['safe.exe', '../evil.exe'] })).toBeNull()
    expect(validateSettingsPartial({ exclusions: ['..\\evil.exe'] })).toBeNull()
  })

  it('rejects exclusions with UNC prefix', () => {
    expect(validateSettingsPartial({ exclusions: ['\\\\server\\share\\file'] })).toBeNull()
  })

  it('rejects too many ignoredSoftwareUpdates', () => {
    expect(
      validateSettingsPartial({ ignoredSoftwareUpdates: Array.from({ length: 501 }, (_, i) => `upd-${i}`) }),
    ).toBeNull()
  })

  it('rejects overly long ignoredSoftwareUpdate entry', () => {
    expect(validateSettingsPartial({ ignoredSoftwareUpdates: ['x'.repeat(201)] })).toBeNull()
  })

  it('rejects schedule as null', () => {
    expect(validateSettingsPartial({ schedule: null })).toBeNull()
  })

  it('rejects schedule as primitive', () => {
    expect(validateSettingsPartial({ schedule: 42 })).toBeNull()
    expect(validateSettingsPartial({ schedule: 'daily' })).toBeNull()
  })

  it('rejects schedule with non-boolean enabled', () => {
    expect(validateSettingsPartial({ schedule: { enabled: 'yes', frequency: 'daily', day: 0, hour: 9 } })).toBeNull()
  })

  it('rejects schedule entry as null', () => {
    expect(validateSettingsPartial({ schedules: [null] })).toBeNull()
  })

  it('rejects schedule entry as primitive', () => {
    expect(validateSettingsPartial({ schedules: ['string-entry'] })).toBeNull()
  })

  it('rejects schedule entry as array', () => {
    expect(validateSettingsPartial({ schedules: [[]] })).toBeNull()
  })

  it('rejects schedule entry with invalid id', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 123,
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with invalid name', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 123,
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with non-boolean enabled', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: 'yes',
            frequency: 'daily',
            day: 0,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with invalid frequency', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'yearly',
            day: 0,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with out-of-range day', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 32,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with out-of-range hour', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 24,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with invalid minute', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            minute: 60,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with non-array tasks', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            tasks: 'cleaner:system',
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with non-boolean autoApply', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: 'yes',
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with invalid lastRunAt', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: 123,
            lastRunStatus: 'never',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with invalid lastRunStatus', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'unknown',
            createdAt: '2025-01-01T00:00:00Z',
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects schedule entry with invalid createdAt', () => {
    expect(
      validateSettingsPartial({
        schedules: [
          {
            id: 'x',
            name: 'X',
            enabled: true,
            frequency: 'daily',
            day: 0,
            hour: 9,
            tasks: ['cleaner:system'],
            autoApply: false,
            lastRunAt: null,
            lastRunStatus: 'never',
            createdAt: 123,
          },
        ],
      }),
    ).toBeNull()
  })

  it('rejects cleaner as non-object', () => {
    expect(validateSettingsPartial({ cleaner: 'string' })).toBeNull()
    expect(validateSettingsPartial({ cleaner: 42 })).toBeNull()
  })

  it('rejects cleaner with non-boolean closeBrowsersBeforeClean', () => {
    expect(validateSettingsPartial({ cleaner: { closeBrowsersBeforeClean: 'yes' } })).toBeNull()
  })

  it('rejects overly long registryIgnoredTweak', () => {
    expect(validateSettingsPartial({ registryIgnoredTweaks: ['x'.repeat(1025)] })).toBeNull()
  })

  it('rejects gameMode with non-boolean autoDetect', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [], autoDetect: 'yes' },
      }),
    ).toBeNull()
  })

  it('rejects gameMode with non-boolean autoDeactivate', () => {
    expect(
      validateSettingsPartial({
        gameMode: { enabledOptimizations: [], customProcessKillList: [], autoDeactivate: 'yes' },
      }),
    ).toBeNull()
  })
})

describe('validateHistoryEntry', () => {
  const validEntry = {
    id: 'entry-1',
    type: 'cleaner',
    timestamp: '2025-01-01T00:00:00Z',
    duration: 5000,
    totalItemsFound: 100,
    totalItemsCleaned: 90,
    totalItemsSkipped: 10,
    totalSpaceSaved: 1048576,
    errorCount: 0,
    categories: [{ name: 'Temp Files', itemsFound: 50, itemsCleaned: 45, spaceSaved: 524288 }],
  }

  it('accepts a valid history entry', () => {
    expect(validateHistoryEntry(validEntry)).toEqual(validEntry)
  })

  it('rejects null', () => {
    expect(validateHistoryEntry(null)).toBeNull()
  })

  it('rejects non-object', () => {
    expect(validateHistoryEntry('string')).toBeNull()
  })

  it('rejects invalid type values', () => {
    expect(validateHistoryEntry({ ...validEntry, type: 'unknown' })).toBeNull()
  })

  it('accepts all valid type values', () => {
    for (const type of ['cleaner', 'registry', 'debloater', 'network', 'drivers']) {
      expect(validateHistoryEntry({ ...validEntry, type })).not.toBeNull()
    }
  })

  it('rejects negative duration', () => {
    expect(validateHistoryEntry({ ...validEntry, duration: -1 })).toBeNull()
  })

  it('rejects overly long id', () => {
    expect(validateHistoryEntry({ ...validEntry, id: 'x'.repeat(101) })).toBeNull()
  })

  it('rejects non-array categories', () => {
    expect(validateHistoryEntry({ ...validEntry, categories: 'none' })).toBeNull()
  })

  it('rejects too many categories', () => {
    const categories = Array.from({ length: 51 }, (_, i) => ({
      name: `cat-${i}`,
      itemsFound: 1,
      itemsCleaned: 1,
      spaceSaved: 100,
    }))
    expect(validateHistoryEntry({ ...validEntry, categories })).toBeNull()
  })

  it('rejects missing required fields', () => {
    const { id, ...noId } = validEntry
    expect(validateHistoryEntry(noId)).toBeNull()
  })

  it('rejects array input', () => {
    expect(validateHistoryEntry([])).toBeNull()
  })

  it('rejects non-string timestamp', () => {
    expect(validateHistoryEntry({ ...validEntry, timestamp: 12345 })).toBeNull()
  })

  it('rejects overly long timestamp', () => {
    expect(validateHistoryEntry({ ...validEntry, timestamp: 'x'.repeat(51) })).toBeNull()
  })

  it('rejects non-number duration', () => {
    expect(validateHistoryEntry({ ...validEntry, duration: 'slow' })).toBeNull()
  })

  it('rejects non-number totalItemsFound', () => {
    expect(validateHistoryEntry({ ...validEntry, totalItemsFound: 'many' })).toBeNull()
  })

  it('rejects non-number totalItemsCleaned', () => {
    expect(validateHistoryEntry({ ...validEntry, totalItemsCleaned: 'some' })).toBeNull()
  })

  it('rejects non-number totalItemsSkipped', () => {
    expect(validateHistoryEntry({ ...validEntry, totalItemsSkipped: 'none' })).toBeNull()
  })

  it('rejects non-number totalSpaceSaved', () => {
    expect(validateHistoryEntry({ ...validEntry, totalSpaceSaved: 'big' })).toBeNull()
  })

  it('rejects non-number errorCount', () => {
    expect(validateHistoryEntry({ ...validEntry, errorCount: 'zero' })).toBeNull()
  })

  it('accepts all remaining valid type values beyond the initial five', () => {
    for (const type of [
      'malware',
      'privacy',
      'startup',
      'services',
      'software-update',
      'compliance',
      'vulnerability',
    ]) {
      expect(validateHistoryEntry({ ...validEntry, type })).not.toBeNull()
    }
  })
})

describe('validateStringArray', () => {
  it('accepts a valid string array', () => {
    expect(validateStringArray(['a', 'b', 'c'])).toEqual(['a', 'b', 'c'])
  })

  it('rejects non-array input', () => {
    expect(validateStringArray(null)).toBeNull()
    expect(validateStringArray('string')).toBeNull()
    expect(validateStringArray(42)).toBeNull()
    expect(validateStringArray({})).toBeNull()
  })

  it('rejects arrays exceeding maxItems', () => {
    const arr = Array.from({ length: 10_001 }, (_, i) => `item-${i}`)
    expect(validateStringArray(arr)).toBeNull()
  })

  it('rejects arrays with non-string elements', () => {
    expect(validateStringArray(['a', 42, 'c'])).toBeNull()
  })

  it('rejects arrays with elements exceeding maxItemLength', () => {
    expect(validateStringArray(['a', 'x'.repeat(1025)])).toBeNull()
  })

  it('accepts custom maxItems and maxItemLength parameters', () => {
    expect(validateStringArray(['a', 'b'], 5, 10)).toEqual(['a', 'b'])
  })

  it('rejects based on custom maxItems', () => {
    expect(validateStringArray(['a', 'b', 'c'], 2, 10)).toBeNull()
  })

  it('accepts empty array', () => {
    expect(validateStringArray([])).toEqual([])
  })

  it('accepts array at the maxItems boundary', () => {
    const arr = Array.from({ length: 10_000 }, (_, i) => `item-${i}`)
    const result = validateStringArray(arr)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(10_000)
  })

  it('accepts elements at the maxItemLength boundary', () => {
    expect(validateStringArray(['x'.repeat(1024)])).toEqual(['x'.repeat(1024)])
  })
})
