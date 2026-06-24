import type { HotkeyBinding } from '@shared/types'
import { createJsonStore } from './store-base'

interface ClipsPersistedConfig {
  replayTimeSeconds: number
  micEnabled: boolean
  audioLoopback: boolean
  fps: number
  width: number
  height: number
  bitrateKbps: number
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
}

const DEFAULTS: ClipsPersistedConfig = {
  replayTimeSeconds: 60,
  micEnabled: true,
  audioLoopback: false,
  fps: 60,
  width: 1920,
  height: 1080,
  bitrateKbps: 20000,
  outputDirectory: '',
  forceSoftware: false,
  hotkeys: [],
  pushToTalk: 'off',
  pushToTalkKeys: [0x7a],
  gameDetection: false,
  gameAudioOnly: false,
  customGameProcess: '',
  micDeviceId: '',
  autoStartCapture: false,
  useExcludeMode: false,
  excludeProcessId: 0,
  gameVolume: 1.0,
  micVolume: 1.0,
  selectedAudioSessions: [],
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
