import type { HotkeyBinding } from '@shared/types'
import { createJsonStore } from './store-base'

interface ClipsPersistedConfig {
  replayTimeSeconds: number
  micEnabled: boolean
  noiseSuppression: boolean
  audioLoopback: boolean
  fps: number
  width: number
  height: number
  bitrateKbps: number
  cq: number
  maxrateKbps: number
  bufsizeKbps: number
  bframes: number
  lookahead: number
  encoderPreset: string
  codec: string
  adapterIndex: number
  outputDirectory: string
  forceSoftware: boolean
  hotkeys: HotkeyBinding[]
  pushToTalk: 'off' | 'hold' | 'toggle'
  pushToTalkKeys: number[]
  gameDetection: boolean
  gameAudioOnly: boolean
  customGameProcess: string
  micDeviceId: string
  autoStartCapture: boolean
  useExcludeMode: boolean
  excludeProcessId: number
  gameVolume: number
  micVolume: number
  selectedAudioSessions: number[]
  audioSampleRate: number
  autoCleanupEnabled: boolean
  autoCleanupThresholdGB: number
  adaptiveQuality: boolean
}

const DEFAULTS: ClipsPersistedConfig = {
  replayTimeSeconds: 300,
  micEnabled: true,
  noiseSuppression: false,
  audioLoopback: false,
  fps: 60,
  width: 1920,
  height: 1080,
  bitrateKbps: 40000,
  cq: 22,
  maxrateKbps: 30000,
  bufsizeKbps: 60000,
  bframes: 3,
  lookahead: 32,
  encoderPreset: 'p4',
  codec: 'auto',
  adapterIndex: -1,
  outputDirectory: '',
  forceSoftware: false,
  hotkeys: [
    {
      id: 'hk-save-8',
      vk: 123,
      modifiers: [],
      action: 'saveClip',
      replayDurationSeconds: 300,
      enabled: true,
    },
    {
      id: 'hk-1782208376874',
      vk: 122,
      modifiers: [],
      action: 'saveClip',
      replayDurationSeconds: 120,
      enabled: true,
    },
    {
      id: 'hk-1782222941097',
      vk: 49,
      modifiers: ['Alt'],
      action: 'toggleCapture',
      replayDurationSeconds: 60,
      enabled: true,
    },
  ],
  pushToTalk: 'hold',
  pushToTalkKeys: [5, 20],
  gameDetection: true,
  gameAudioOnly: true,
  customGameProcess: 'FiveM_GTAProcess.exe',
  micDeviceId: '{0.0.1.00000000}.{72784dd9-f435-4683-bc5a-7265069f0d42}',
  autoStartCapture: true,
  useExcludeMode: false,
  excludeProcessId: 0,
  gameVolume: 1.0,
  micVolume: 1.0,
  selectedAudioSessions: [],
  audioSampleRate: 48000,
  autoCleanupEnabled: true,
  autoCleanupThresholdGB: 20,
  adaptiveQuality: true,
}

const store = createJsonStore<ClipsPersistedConfig>({
  name: 'clips-config.json',
  defaults: DEFAULTS,
})

export function loadClipsConfig(): ClipsPersistedConfig {
  return store.load()
}

export function saveClipsConfig(config: Partial<ClipsPersistedConfig>): ClipsPersistedConfig {
  return store.update((current) => ({ ...current, ...config }))
}

export function resetClipsConfig(): void {
  store.save({ ...DEFAULTS })
}

export type { ClipsPersistedConfig }
