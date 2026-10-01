import { describe, expect, it } from 'vitest'
import { VALID_OPTIMIZATION_IDS } from '../../main/ipc/game-mode/validation'
import {
  CANONICAL_GAME_MODE_OPTIMIZATIONS,
  canonicalGameModeOptimizations,
  GAME_MODE_PRECONFIG_VERSION,
} from '../game-mode-preconfig'

describe('game-mode pre-config', () => {
  it('every canonical id is a valid optimization id', () => {
    for (const id of CANONICAL_GAME_MODE_OPTIMIZATIONS) {
      expect(VALID_OPTIMIZATION_IDS.has(id), `${id} must be in VALID_OPTIMIZATION_IDS`).toBe(true)
    }
  })

  it('has no duplicates', () => {
    expect(new Set(CANONICAL_GAME_MODE_OPTIMIZATIONS).size).toBe(CANONICAL_GAME_MODE_OPTIMIZATIONS.length)
  })

  it('ships the documented 16-optimization set', () => {
    expect(CANONICAL_GAME_MODE_OPTIMIZATIONS).toHaveLength(16)
  })

  it('includes the capture-stack and transparency tweaks', () => {
    expect(CANONICAL_GAME_MODE_OPTIMIZATIONS).toContain('sys-disable-game-bar')
    expect(CANONICAL_GAME_MODE_OPTIMIZATIONS).toContain('sys-disable-fse-opt')
    expect(CANONICAL_GAME_MODE_OPTIMIZATIONS).toContain('sys-disable-transparency')
  })

  it('hands out a fresh mutable copy each call', () => {
    const a = canonicalGameModeOptimizations()
    const b = canonicalGameModeOptimizations()
    expect(a).not.toBe(b)
    expect(a).toEqual(b)
    a.push('svc-diagtrack')
    expect(b).not.toContain('svc-diagtrack')
    expect(CANONICAL_GAME_MODE_OPTIMIZATIONS).not.toContain('svc-diagtrack')
  })

  it('exposes a positive integer pre-config version', () => {
    expect(Number.isInteger(GAME_MODE_PRECONFIG_VERSION)).toBe(true)
    expect(GAME_MODE_PRECONFIG_VERSION).toBeGreaterThan(0)
  })
})
