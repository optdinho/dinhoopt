import { clipPathInOutputDir, getDefaultOutputDir } from './clips-config-paths'
import { baseConfigPayload, config, migrateHotkeys, modifierVk, normalizeFps } from './clips-config-schema'
import { loadClipsConfig, saveClipsConfig } from './clips-config-store'
import { defaultHotkeys } from './clips-default-hotkeys'

/**
 * Clips config orchestrator — facade over the split modules.
 *
 * Fase 3 (item 11) split this file's responsibilities:
 *  - `clips-config-schema.ts` — config state shape, defaults, validation/normalization
 *    (`normalizeFps`, `migrateHotkeys`, `modifierVk`, `baseConfigPayload`);
 *  - `clips-config-paths.ts`  — output-directory resolution + clip path containment;
 *  - `clips-config-store.ts`  — JSON persistence (`loadClipsConfig`/`saveClipsConfig`);
 *  - this file — orchestration: load/persist wiring and engine/UI payload derivation.
 *
 * Every name below is re-exported with the SAME signature as before, so no consumer
 * (`ipc/clips.ipc.ts`, `ipc/clips-engine-connection.ts`, `ipc/clips-engine.ts`,
 * `ipc/clips-encode.ipc.ts`, `ipc/clip-video-protocol.ts`) needs to change its import.
 */

export type { ConfigState } from './clips-config-schema'
export { clipPathInOutputDir, config, getDefaultOutputDir, migrateHotkeys, normalizeFps }

export function buildEngineConfig(): Record<string, unknown> {
  const hks = config.hotkeys.length > 0 ? config.hotkeys : defaultHotkeys()
  return {
    ...baseConfigPayload(getDefaultOutputDir),
    Hotkeys: hks.map((hk) => ({
      vk: hk.vk,
      modifiers: hk.modifiers.map(modifierVk),
      action: hk.action.charAt(0).toUpperCase() + hk.action.slice(1),
      replayDurationSeconds: hk.replayDurationSeconds,
      enabled: hk.enabled,
    })),
    electronPid: process.pid,
  }
}

export function getCurrentConfigPayload(): Record<string, unknown> {
  return {
    ...baseConfigPayload(getDefaultOutputDir),
    selectedAudioSessions: config.selectedAudioSessions,
    hotkeys: config.hotkeys.length > 0 ? config.hotkeys : defaultHotkeys(),
    excludeProcessId: config.useExcludeMode ? process.pid : config.excludeProcessId,
  }
}

export function loadPersistedClipsConfig(): void {
  const saved = loadClipsConfig()
  config.width = saved.width
  config.height = saved.height
  config.bitrateKbps = saved.bitrateKbps
  config.cq = saved.cq ?? 20
  config.maxrateKbps = saved.maxrateKbps ?? 30000
  config.bufsizeKbps = saved.bufsizeKbps ?? 60000
  config.bframes = saved.bframes ?? 3
  config.lookahead = saved.lookahead ?? 16
  config.encoderPreset = saved.encoderPreset ?? 'p5'
  config.codec = 'auto'
  config.adapterIndex = saved.adapterIndex ?? -1
  config.micEnabled = saved.micEnabled
  config.audioLoopback = saved.audioLoopback
  config.forceSoftware = false
  config.pushToTalk = saved.pushToTalk
  config.pushToTalkKeys = saved.pushToTalkKeys
  config.gameDetection = saved.gameDetection
  config.gameAudioOnly = saved.gameAudioOnly
  config.customGameProcess = saved.customGameProcess ?? ''
  config.micDeviceId = saved.micDeviceId ?? ''
  config.autoStartCapture = saved.autoStartCapture ?? false
  config.useExcludeMode = saved.useExcludeMode ?? false
  config.excludeProcessId = saved.excludeProcessId ?? 0
  config.gameVolume = saved.gameVolume ?? 1.0
  config.micVolume = saved.micVolume ?? 1.0
  config.selectedAudioSessions = saved.selectedAudioSessions ?? []
  config.noiseSuppression = saved.noiseSuppression ?? false
  config.adaptiveQuality = saved.adaptiveQuality ?? false
  config.stretchToFit = saved.stretchToFit ?? true
  config.replayBufferMode = saved.replayBufferMode ?? 'disk'
  config.audioSampleRate = saved.audioSampleRate ?? 48000
  config.autoCleanupEnabled = saved.autoCleanupEnabled ?? true
  config.autoCleanupThresholdGB = saved.autoCleanupThresholdGB ?? 100
  config.hotkeys = migrateHotkeys(saved.hotkeys)
  config.outputDirectory = saved.outputDirectory
  config.engineReplayTimeSeconds = saved.replayTimeSeconds
  config.engineFps = normalizeFps(saved.fps)
}

export function persistClipsConfig(): void {
  saveClipsConfig({
    width: config.width,
    height: config.height,
    bitrateKbps: config.bitrateKbps,
    cq: config.cq,
    maxrateKbps: config.maxrateKbps,
    bufsizeKbps: config.bufsizeKbps,
    bframes: config.bframes,
    lookahead: config.lookahead,
    encoderPreset: config.encoderPreset,
    codec: config.codec,
    adapterIndex: config.adapterIndex,
    micEnabled: config.micEnabled,
    audioLoopback: config.audioLoopback,
    forceSoftware: config.forceSoftware,
    pushToTalk: config.pushToTalk,
    pushToTalkKeys: config.pushToTalkKeys,
    gameDetection: config.gameDetection,
    gameAudioOnly: config.gameAudioOnly,
    customGameProcess: config.customGameProcess,
    micDeviceId: config.micDeviceId,
    autoStartCapture: config.autoStartCapture,
    useExcludeMode: config.useExcludeMode,
    excludeProcessId: config.excludeProcessId,
    gameVolume: config.gameVolume,
    micVolume: config.micVolume,
    selectedAudioSessions: config.selectedAudioSessions,
    noiseSuppression: config.noiseSuppression,
    adaptiveQuality: config.adaptiveQuality,
    stretchToFit: config.stretchToFit,
    replayBufferMode: config.replayBufferMode,
    audioSampleRate: config.audioSampleRate,
    autoCleanupEnabled: config.autoCleanupEnabled,
    autoCleanupThresholdGB: config.autoCleanupThresholdGB,
    hotkeys: config.hotkeys,
    outputDirectory: getDefaultOutputDir(),
    replayTimeSeconds: config.engineReplayTimeSeconds,
    fps: config.engineFps,
  })
}

loadPersistedClipsConfig()
