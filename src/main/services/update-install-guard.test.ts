import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  BUSY_PROBE_KEYS,
  getBusyReasons,
  isBusyForUpdate,
  registerBusyProbe,
  resetBusyProbes,
  unregisterBusyProbe,
} from './update-install-guard'

afterEach(() => {
  resetBusyProbes()
})

describe('update-install-guard registry', () => {
  it('reports idle when no probe is registered', () => {
    expect(getBusyReasons()).toEqual([])
    expect(isBusyForUpdate()).toBe(false)
  })

  it('reports idle when every probe returns null', () => {
    registerBusyProbe('a', () => null)
    registerBusyProbe('b', () => null)
    expect(getBusyReasons()).toEqual([])
    expect(isBusyForUpdate()).toBe(false)
  })

  it('surfaces the reason a probe returns', () => {
    registerBusyProbe('a', () => ({ key: 'a', label: 'gravando' }))
    expect(getBusyReasons()).toEqual([{ key: 'a', label: 'gravando' }])
    expect(isBusyForUpdate()).toBe(true)
  })

  it('collects every busy reason, not just the first', () => {
    registerBusyProbe('a', () => ({ key: 'a', label: 'A' }))
    registerBusyProbe('b', () => ({ key: 'b', label: 'B' }))
    registerBusyProbe('c', () => null)
    expect(getBusyReasons()).toEqual([
      { key: 'a', label: 'A' },
      { key: 'b', label: 'B' },
    ])
  })

  it('treats a re-registered key as a replacement, not a duplicate', () => {
    registerBusyProbe('a', () => ({ key: 'a', label: 'first' }))
    registerBusyProbe('a', () => ({ key: 'a', label: 'second' }))
    expect(getBusyReasons()).toEqual([{ key: 'a', label: 'second' }])
  })

  it('stops reporting a key after unregister', () => {
    registerBusyProbe('a', () => ({ key: 'a', label: 'A' }))
    unregisterBusyProbe('a')
    expect(getBusyReasons()).toEqual([])
    expect(isBusyForUpdate()).toBe(false)
  })

  it('ignores unregister for a key that was never registered', () => {
    expect(() => unregisterBusyProbe('ghost')).not.toThrow()
    expect(getBusyReasons()).toEqual([])
  })

  it('a throwing probe does not take the whole guard down', () => {
    registerBusyProbe('boom', () => {
      throw new Error('module exploded')
    })
    registerBusyProbe('ok', () => ({ key: 'ok', label: 'ok' }))
    expect(getBusyReasons()).toEqual([{ key: 'ok', label: 'ok' }])
    expect(isBusyForUpdate()).toBe(true)
  })

  it('a probe returning a malformed value is ignored instead of crashing', () => {
    registerBusyProbe('bad', () => undefined as unknown as null)
    registerBusyProbe('bad2', () => ({ label: 'no key' }) as unknown as null)
    expect(getBusyReasons()).toEqual([])
    expect(isBusyForUpdate()).toBe(false)
  })

  it('re-evaluates the probes on every call instead of caching', () => {
    let capturing = true
    registerBusyProbe('rec', () => (capturing ? { key: 'rec', label: 'rec' } : null))
    expect(isBusyForUpdate()).toBe(true)
    capturing = false
    expect(isBusyForUpdate()).toBe(false)
  })

  it('resetBusyProbes drops every registration', () => {
    registerBusyProbe('a', () => ({ key: 'a', label: 'A' }))
    resetBusyProbes()
    expect(getBusyReasons()).toEqual([])
  })

  it('exposes a stable set of probe keys for the real signals', () => {
    expect(BUSY_PROBE_KEYS).toEqual({
      recording: 'recording',
      malwareScan: 'malwareScan',
      clipEncode: 'clipEncode',
      publishing: 'publishing',
    })
  })
})

describe('update-install-guard integration shape', () => {
  it('accepts a probe that only flips a boolean, via a helper probe factory', () => {
    const makeProbe =
      (isActive: () => boolean, key: string, label: string) => (): { key: string; label: string } | null =>
        isActive() ? { key, label } : null

    let recording = false
    registerBusyProbe(
      BUSY_PROBE_KEYS.recording,
      makeProbe(() => recording, BUSY_PROBE_KEYS.recording, 'Gravando'),
    )
    expect(isBusyForUpdate()).toBe(false)

    recording = true
    expect(getBusyReasons()).toEqual([{ key: 'recording', label: 'Gravando' }])
  })

  it('does not call probes at registration time', () => {
    const probe = vi.fn(() => null)
    registerBusyProbe('lazy', probe)
    expect(probe).not.toHaveBeenCalled()
    getBusyReasons()
    expect(probe).toHaveBeenCalledTimes(1)
  })
})
