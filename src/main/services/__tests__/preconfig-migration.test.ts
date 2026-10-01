import { beforeEach, describe, expect, it, vi } from 'vitest'

const getSettings = vi.fn()
const setSettings = vi.fn()

function writtenGameMode(): {
  enabledOptimizations: string[]
  preconfigVersion: number
  customProcessKillList: unknown
  customGameProcesses: unknown
  autoDetect: boolean
  autoDeactivate: boolean
  gameProfiles: unknown
} {
  return setSettings.mock.calls[0]![0].gameMode
}

vi.mock('../settings-store', () => ({
  getSettings: () => getSettings(),
  setSettings: (partial: unknown) => setSettings(partial),
}))

import { CANONICAL_GAME_MODE_OPTIMIZATIONS, GAME_MODE_PRECONFIG_VERSION } from '@shared/game-mode-preconfig'
import { applyGameModePreconfig } from '../preconfig-migration'

const baseGameMode = {
  enabledOptimizations: ['svc-wsearch'] as never[],
  customProcessKillList: [],
  autoDetect: true,
  autoDeactivate: true,
  customGameProcesses: [],
  gameProfiles: {},
  preconfigVersion: 0,
}

describe('applyGameModePreconfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('seeds the canonical list on a legacy install that was never seeded', () => {
    getSettings.mockReturnValue({ gameMode: { ...baseGameMode, enabledOptimizations: ['svc-diagtrack'] } })

    const result = applyGameModePreconfig()

    expect(result.applied).toBe(true)
    expect(setSettings).toHaveBeenCalledTimes(1)
    const written = writtenGameMode()
    expect(written.enabledOptimizations).toEqual([...CANONICAL_GAME_MODE_OPTIMIZATIONS])
    expect(written.preconfigVersion).toBe(GAME_MODE_PRECONFIG_VERSION)
  })

  it('overwrites a previously customized list exactly once', () => {
    getSettings.mockReturnValue({
      gameMode: { ...baseGameMode, enabledOptimizations: ['svc-wsearch', 'svc-sysmain'], preconfigVersion: 0 },
    })

    applyGameModePreconfig()

    expect(setSettings).toHaveBeenCalledTimes(1)
    expect(writtenGameMode().enabledOptimizations).toHaveLength(CANONICAL_GAME_MODE_OPTIMIZATIONS.length)
  })

  it('is idempotent — never overwrites again once at the current version', () => {
    const userChoice = ['svc-diagtrack']
    getSettings.mockReturnValue({
      gameMode: { ...baseGameMode, enabledOptimizations: userChoice, preconfigVersion: GAME_MODE_PRECONFIG_VERSION },
    })

    const result = applyGameModePreconfig()

    expect(result.applied).toBe(false)
    expect(setSettings).not.toHaveBeenCalled()
    expect(getSettings().gameMode.enabledOptimizations).toEqual(userChoice)
  })

  it('does not downgrade an install already ahead of the shipped version', () => {
    getSettings.mockReturnValue({
      gameMode: { ...baseGameMode, preconfigVersion: GAME_MODE_PRECONFIG_VERSION + 5 },
    })

    expect(applyGameModePreconfig().applied).toBe(false)
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('treats a missing or non-integer marker as never seeded', () => {
    for (const marker of [undefined, null, Number.NaN, 'x', -1]) {
      getSettings.mockReturnValue({ gameMode: { ...baseGameMode, preconfigVersion: marker } })
      expect(applyGameModePreconfig().applied, `marker ${String(marker)}`).toBe(true)
      setSettings.mockClear()
    }
  })

  it('preserves every other gameMode field while seeding', () => {
    getSettings.mockReturnValue({
      gameMode: {
        ...baseGameMode,
        customProcessKillList: ['foo.exe'],
        customGameProcesses: ['bar.exe'],
        autoDetect: false,
        autoDeactivate: false,
        gameProfiles: { 'cs2.exe': { enabledOptimizations: ['svc-wsearch'] } },
      },
    })

    applyGameModePreconfig()

    const written = writtenGameMode()
    expect(written.customProcessKillList).toEqual(['foo.exe'])
    expect(written.customGameProcesses).toEqual(['bar.exe'])
    expect(written.autoDetect).toBe(false)
    expect(written.autoDeactivate).toBe(false)
    expect(written.gameProfiles).toEqual({ 'cs2.exe': { enabledOptimizations: ['svc-wsearch'] } })
  })

  it('never seeds an empty list', () => {
    getSettings.mockReturnValue({ gameMode: { ...baseGameMode, preconfigVersion: 0 } })

    applyGameModePreconfig()

    expect(writtenGameMode().enabledOptimizations.length).toBeGreaterThan(0)
  })

  it('reports the counts it replaced', () => {
    getSettings.mockReturnValue({
      gameMode: { ...baseGameMode, enabledOptimizations: ['a', 'b', 'c'], preconfigVersion: 0 },
    })

    const result = applyGameModePreconfig()

    expect(result.previousCount).toBe(3)
    expect(result.nextCount).toBe(CANONICAL_GAME_MODE_OPTIMIZATIONS.length)
    expect(result.version).toBe(GAME_MODE_PRECONFIG_VERSION)
  })
})
