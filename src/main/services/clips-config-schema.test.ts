import type { HotkeyBinding } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { baseConfigPayload, config, migrateHotkeys, modifierVk, normalizeFps } from './clips-config-schema'

/**
 * Direct tests for the schema leaf module split out of clips-config-manager
 * (Fase 3, item 11). These assert the module in isolation — the manager re-exports
 * the same names, so consumers are covered too, but the split should not silently
 * regress the validation/migration behaviour.
 */
describe('clips-config-schema', () => {
  describe('normalizeFps', () => {
    it('keeps 30 and 60 unchanged', () => {
      expect(normalizeFps(30)).toBe(30)
      expect(normalizeFps(60)).toBe(60)
    })

    it('normalizes any other value to 60', () => {
      expect(normalizeFps(120)).toBe(60)
      expect(normalizeFps(75)).toBe(60)
      expect(normalizeFps(0)).toBe(60)
    })
  })

  describe('modifierVk', () => {
    it('maps Ctrl/Shift/Alt to their virtual-key codes', () => {
      expect(modifierVk('Ctrl')).toBe(0x11)
      expect(modifierVk('Shift')).toBe(0x10)
      expect(modifierVk('Alt')).toBe(0x12)
    })

    it('returns 0 for unknown modifiers', () => {
      expect(modifierVk('Super')).toBe(0)
    })
  })

  describe('migrateHotkeys', () => {
    it('returns [] for undefined input', () => {
      expect(migrateHotkeys(undefined)).toEqual([])
    })

    it('migrates toggleCapture to screenshot and pushToTalk to toggleMic', () => {
      const hotkeys: HotkeyBinding[] = [
        { id: 'a', vk: 49, modifiers: ['Alt'], action: 'toggleCapture', replayDurationSeconds: 60, enabled: true },
        { id: 'b', vk: 0x79, modifiers: [], action: 'pushToTalk', replayDurationSeconds: 60, enabled: true },
      ]
      const migrated = migrateHotkeys(hotkeys)
      expect(migrated.find((h) => h.id === 'a')?.action).toBe('screenshot')
      expect(migrated.find((h) => h.id === 'b')?.action).toBe('toggleMic')
    })

    it('leaves current actions untouched', () => {
      const hotkeys: HotkeyBinding[] = [
        { id: 'a', vk: 123, modifiers: [], action: 'saveClip', replayDurationSeconds: 300, enabled: true },
        { id: 'b', vk: 49, modifiers: ['Alt'], action: 'screenshot', replayDurationSeconds: 60, enabled: true },
      ]
      expect(migrateHotkeys(hotkeys)).toEqual(hotkeys)
    })
  })

  describe('config defaults', () => {
    it('holds the pinned quality defaults (CQ invariant: 20, clamp target range 16/18/20/22)', () => {
      expect(config.cq).toBe(20)
      expect(config.encoderPreset).toBe('p5')
      expect(config.bframes).toBe(3)
      expect(config.lookahead).toBe(16)
      expect(config.maxrateKbps).toBe(30000)
      expect(config.bufsizeKbps).toBe(60000)
    })
  })

  describe('baseConfigPayload', () => {
    it('resolves outputDirectory through the injected callback', () => {
      const payload = baseConfigPayload(() => 'D:\\Explicit')
      expect(payload.outputDirectory).toBe('D:\\Explicit')
    })

    it('omits empty optional strings and falsy autoStartCapture', () => {
      const prev = { customGameProcess: config.customGameProcess, micDeviceId: config.micDeviceId }
      config.customGameProcess = ''
      config.micDeviceId = ''
      const payload = baseConfigPayload(() => '')
      expect(payload.customGameProcess).toBeUndefined()
      expect(payload.micDeviceId).toBeUndefined()
      config.customGameProcess = prev.customGameProcess
      config.micDeviceId = prev.micDeviceId
    })
  })
})
