import { describe, expect, it } from 'vitest'
import { GAMING_SYSTEM_TWEAKS } from './gaming-system'

const CAPTURE_BREAKING_IDS = ['gamedvr-enabled', 'app-capture-off', 'gamedvr-policy', 'gamedvr-pm']

const KEPT_IDS = [
  'gamedvr-fse',
  'gamedvr-honor-fse',
  'gamedvr-dxgi',
  'gamedvr-efse',
  'auto-game-mode',
  'allow-auto-game-mode',
  'perfopt-csgo',
  'perfopt-fivem',
]

const CAPTURE_DISABLING_KEYS = ['GameDVR_Enabled', 'AppCaptureEnabled', 'AllowGameDVR']

describe('GAMING_SYSTEM_TWEAKS', () => {
  it('no longer offers tweaks that disable Game DVR / capture (WGC conflict)', () => {
    const ids = GAMING_SYSTEM_TWEAKS.map((t) => t.id)
    for (const id of CAPTURE_BREAKING_IDS) {
      expect(ids).not.toContain(id)
    }
  })

  it('keeps the FSE, GameMode and per-game priority tweaks', () => {
    const ids = GAMING_SYSTEM_TWEAKS.map((t) => t.id)
    for (const id of KEPT_IDS) {
      expect(ids).toContain(id)
    }
  })

  it('does not write any capture-disabling registry value', () => {
    for (const tweak of GAMING_SYSTEM_TWEAKS) {
      expect(CAPTURE_DISABLING_KEYS).not.toContain(tweak.key)
    }
  })

  it('no policy-manager tweak remains (only registry-based tweaks)', () => {
    for (const tweak of GAMING_SYSTEM_TWEAKS) {
      expect(tweak.path).not.toContain('PolicyManager')
      expect(tweak.path).not.toContain('Policies\\Microsoft\\Windows\\GameDVR')
    }
  })
})
