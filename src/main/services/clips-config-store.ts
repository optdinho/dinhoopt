import type { HotkeyBinding } from '@shared/types'
import { defaultHotkeys } from './clips-default-hotkeys'
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
  stretchToFit: boolean
  replayBufferMode: 'ram' | 'hybrid' | 'disk'
}

const DEFAULTS: ClipsPersistedConfig = {
  replayTimeSeconds: 120,
  micEnabled: true,
  noiseSuppression: false,
  audioLoopback: false,
  fps: 60,
  width: 1280,
  height: 720,
  bitrateKbps: 30000,
  cq: 20,
  maxrateKbps: 30000,
  bufsizeKbps: 60000,
  bframes: 3,
  lookahead: 16,
  encoderPreset: 'p5',
  codec: 'auto',
  adapterIndex: -1,
  outputDirectory: '',
  forceSoftware: false,
  hotkeys: defaultHotkeys(),
  pushToTalk: 'hold',
  pushToTalkKeys: [5, 20],
  gameDetection: true,
  gameAudioOnly: true,
  customGameProcess: '',
  micDeviceId: '',
  autoStartCapture: true,
  useExcludeMode: false,
  excludeProcessId: 0,
  gameVolume: 1.0,
  micVolume: 1.0,
  selectedAudioSessions: [],
  audioSampleRate: 48000,
  autoCleanupEnabled: true,
  autoCleanupThresholdGB: 100,
  adaptiveQuality: false,
  stretchToFit: true,
  replayBufferMode: 'disk',
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
