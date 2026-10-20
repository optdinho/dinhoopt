import type { HotkeyBinding } from '@shared/types'

/**
 * Validation / normalization / migration + the config state shape and its defaults.
 *
 * Split out of `clips-config-manager.ts` (Fase 3, item 11) so that consumers that only
 * need validation (e.g. `normalizeFps`, `migrateHotkeys` in `ipc/clips.ipc.ts`) do not
 * pull in the path/persistence orchestration. The manager re-exports every name below,
 * so no consumer import changes. This module is a leaf: it must NOT import the manager.
 */

const MODIFIER_VK_MAP: Record<string, number> = {
  Ctrl: 0x11,
  Shift: 0x10,
  Alt: 0x12,
}

/** Maps a modifier name to its Windows virtual-key code (0 for unknown names). */
export function modifierVk(modifier: string): number {
  return MODIFIER_VK_MAP[modifier] ?? 0
}

// Clip recording only supports 30/60 FPS (UI + engine whitelist). Any other
// value (75/120 legacy persisted) is normalized back to 60 for consistency.
export function normalizeFps(fps: number): number {
  return fps === 30 || fps === 60 ? fps : 60
}

export interface ConfigState {
  engineFps: number
  engineReplayTimeSeconds: number
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
  micEnabled: boolean
  audioLoopback: boolean
  forceSoftware: boolean
  pushToTalk: 'off' | 'hold' | 'toggle'
  pushToTalkKeys: number[]
  gameDetection: boolean
  gameAudioOnly: boolean
  customGameProcess: string
  micDeviceId: string
  autoStartCapture: boolean
  useExcludeMode: boolean
  excludeProcessId: number
  hotkeys: HotkeyBinding[]
  outputDirectory: string
  gameVolume: number
  micVolume: number
  selectedAudioSessions: number[]
  noiseSuppression: boolean
  audioSampleRate: number
  autoCleanupEnabled: boolean
  autoCleanupThresholdGB: number
  adaptiveQuality: boolean
  stretchToFit: boolean
  replayBufferMode: 'ram' | 'hybrid' | 'disk'
}

export const config: ConfigState = {
  engineFps: 60,
  engineReplayTimeSeconds: 120,
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
  micEnabled: true,
  audioLoopback: false,
  forceSoftware: false,
  pushToTalk: 'hold',
  pushToTalkKeys: [5, 20],
  gameDetection: true,
  gameAudioOnly: true,
  customGameProcess: '',
  micDeviceId: '',
  autoStartCapture: true,
  useExcludeMode: false,
  excludeProcessId: 0,
  hotkeys: [],
  outputDirectory: '',
  gameVolume: 1.0,
  micVolume: 1.0,
  selectedAudioSessions: [],
  noiseSuppression: false,
  audioSampleRate: 48000,
  autoCleanupEnabled: true,
  autoCleanupThresholdGB: 100,
  adaptiveQuality: false,
  stretchToFit: true,
  replayBufferMode: 'disk',
}

// 2026-10-19 (item 2): o set canónico de defaults vive em clips-default-hotkeys.ts
// (fonte única partilhada com o store). O fallback antigo aqui era F8/F9/F10 — a segunda
// fonte de verdade que discordava do store.
// ⚠️ O engine C# tem o SEU próprio fallback (ConfigManager.cs:22-24: F8 save / F9 screenshot /
// F10 toggleMic) usado APENAS quando o engine corre sem Electron (standalone/CLI). NÃO alinhar
// esse ficheiro com este set: em produção o Electron envia sempre a config completa no start
// (buildEngineConfig abaixo), logo o fallback C# é inalcançável na app e mantém-se por desenho.

/**
 * Migra atalhos legados para as acções que a UI oferece hoje:
 * - `toggleCapture` → `screenshot` (decisão do usuário: o atalho de "captura" virou printscreen);
 * - `pushToTalk` → `toggleMic` (semântica mais próxima: PTT controlava o microfone.
 *   `pushToTalk` nunca existiu no enum C# `HotkeyAction` e o `<select>` de acção em
 *   ClipsConfigGame.tsx deixou de o oferecer — sem esta migração, configs guardadas
 *   ficavam com o select sem correspondência / valor branco).
 *
 * Aplicado em TODOS os caminhos de escrita de `config.hotkeys`: `loadPersistedClipsConfig`
 * (leitura do disco) e `CLIPS_SET_CONFIG` em `ipc/clips.ipc.ts` (escrita vindora da UI).
 * Assim os caminhos de leitura — `getCurrentConfigPayload()` (alimenta a UI via
 * CLIPS_GET_CONFIG) e `buildEngineConfig()` (alimenta o engine) — nunca veem acções legadas.
 */
export function migrateHotkeys(hotkeys: HotkeyBinding[] | undefined): HotkeyBinding[] {
  if (!hotkeys) return []
  return hotkeys.map((hk) => {
    if (hk.action === 'toggleCapture') return { ...hk, action: 'screenshot' as HotkeyBinding['action'] }
    if (hk.action === 'pushToTalk') return { ...hk, action: 'toggleMic' as HotkeyBinding['action'] }
    return hk
  })
}

/**
 * Builds the shared payload fields sent to both the engine and the UI config channel.
 * `outputDirectory` is resolved through the injected `getOutputDir` callback so this
 * module stays a leaf (no import back into the manager/paths module).
 */
export function baseConfigPayload(getOutputDir: () => string): Record<string, unknown> {
  const c = config
  return {
    replayTimeSeconds: c.engineReplayTimeSeconds,
    micEnabled: c.micEnabled,
    audioLoopback: c.audioLoopback,
    fps: c.engineFps,
    width: c.width,
    height: c.height,
    bitrateKbps: c.bitrateKbps,
    cq: c.cq,
    maxrateKbps: c.maxrateKbps,
    bufsizeKbps: c.bufsizeKbps,
    bframes: c.bframes,
    lookahead: c.lookahead,
    encoderPreset: c.encoderPreset,
    codec: c.codec,
    adapterIndex: c.adapterIndex,
    outputDirectory: getOutputDir(),
    forceSoftware: c.forceSoftware,
    pushToTalk: c.pushToTalk,
    pushToTalkKeys: c.pushToTalkKeys,
    gameDetection: c.gameDetection,
    gameAudioOnly: c.gameAudioOnly,
    customGameProcess: c.customGameProcess || undefined,
    micDeviceId: c.micDeviceId || undefined,
    autoStartCapture: c.autoStartCapture || undefined,
    useExcludeMode: c.useExcludeMode,
    excludeProcessId: c.useExcludeMode ? process.pid : c.excludeProcessId,
    gameVolume: c.gameVolume,
    micVolume: c.micVolume,
    audioSampleRate: c.audioSampleRate,
    autoCleanupEnabled: c.autoCleanupEnabled,
    autoCleanupThresholdGB: c.autoCleanupThresholdGB,
    noiseSuppression: c.noiseSuppression,
    adaptiveQuality: c.adaptiveQuality,
    stretchToFit: c.stretchToFit,
    replayBufferMode: c.replayBufferMode,
  }
}
