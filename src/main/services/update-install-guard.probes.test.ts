import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isEngineCapturing: vi.fn(() => false),
  getActiveScanControllers: vi.fn(() => new Map<string, AbortController>()),
  runningClipJobCount: vi.fn(() => 0),
  activePublishCount: vi.fn(() => 0),
}))

vi.mock('../ipc/clips-engine-connection', () => ({
  isEngineCapturing: mocks.isEngineCapturing,
}))

vi.mock('./malware-scanner.service', () => ({
  getActiveScanControllers: mocks.getActiveScanControllers,
}))

vi.mock('./clip-encode-job', () => ({
  runningClipJobCount: mocks.runningClipJobCount,
}))

vi.mock('../ipc/clips.ipc', () => ({
  activePublishCount: mocks.activePublishCount,
}))

import { BUSY_PROBE_KEYS, getBusyReasons, isBusyForUpdate, resetBusyProbes } from './update-install-guard'
import { registerUpdateBusyProbes } from './update-install-guard.probes'

afterEach(() => {
  resetBusyProbes()
  vi.clearAllMocks()
  mocks.isEngineCapturing.mockReturnValue(false)
  mocks.getActiveScanControllers.mockReturnValue(new Map())
  mocks.runningClipJobCount.mockReturnValue(0)
  mocks.activePublishCount.mockReturnValue(0)
})

describe('registerUpdateBusyProbes', () => {
  it('is idle when nothing is happening', () => {
    registerUpdateBusyProbes()
    expect(isBusyForUpdate()).toBe(false)
    expect(getBusyReasons()).toEqual([])
  })

  it('reports a busy reason while a recording is in progress', () => {
    mocks.isEngineCapturing.mockReturnValue(true)
    registerUpdateBusyProbes()
    expect(getBusyReasons()).toEqual([{ key: BUSY_PROBE_KEYS.recording, label: 'busyClipRecording' }])
  })

  it('reports a busy reason while a malware scan holds a controller', () => {
    mocks.getActiveScanControllers.mockReturnValue(new Map([['scan-1', new AbortController()]]))
    registerUpdateBusyProbes()
    expect(getBusyReasons()).toEqual([{ key: BUSY_PROBE_KEYS.malwareScan, label: 'busyMalwareScan' }])
  })

  it('reports a busy reason while ffmpeg is re-encoding', () => {
    mocks.runningClipJobCount.mockReturnValue(1)
    registerUpdateBusyProbes()
    expect(getBusyReasons()).toEqual([{ key: BUSY_PROBE_KEYS.clipEncode, label: 'busyClipEncoding' }])
  })

  it('reports a busy reason while a clip is uploading', () => {
    mocks.activePublishCount.mockReturnValue(1)
    registerUpdateBusyProbes()
    expect(getBusyReasons()).toEqual([{ key: BUSY_PROBE_KEYS.publishing, label: 'busyClipPublishing' }])
  })

  it('reports every concurrent reason at once', () => {
    mocks.isEngineCapturing.mockReturnValue(true)
    mocks.runningClipJobCount.mockReturnValue(2)
    mocks.activePublishCount.mockReturnValue(1)
    registerUpdateBusyProbes()
    expect(getBusyReasons().map((r) => r.key)).toEqual([
      BUSY_PROBE_KEYS.recording,
      BUSY_PROBE_KEYS.clipEncode,
      BUSY_PROBE_KEYS.publishing,
    ])
  })

  it('is safe to call twice: re-registering replaces instead of duplicating', () => {
    mocks.isEngineCapturing.mockReturnValue(true)
    registerUpdateBusyProbes()
    registerUpdateBusyProbes()
    expect(getBusyReasons()).toHaveLength(1)
  })

  it('reads live state, not a snapshot taken at registration time', () => {
    registerUpdateBusyProbes()
    expect(isBusyForUpdate()).toBe(false)
    mocks.isEngineCapturing.mockReturnValue(true)
    expect(isBusyForUpdate()).toBe(true)
    mocks.isEngineCapturing.mockReturnValue(false)
    expect(isBusyForUpdate()).toBe(false)
  })

  it('does not consult the ffmpeg or upload counters while only a recording runs', () => {
    mocks.isEngineCapturing.mockReturnValue(true)
    registerUpdateBusyProbes()
    getBusyReasons()
    expect(mocks.runningClipJobCount).toHaveBeenCalledTimes(1)
    expect(mocks.activePublishCount).toHaveBeenCalledTimes(1)
  })
})
