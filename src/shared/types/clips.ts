// ─── Clips / Game Capture ───────────────────────────────────

/** Alvo real da captura ativa: jogo conhecido, janela avulsa (HWND) ou monitor inteiro. */
export type ClipsCaptureMode = 'game' | 'window' | 'desktop'

/**
 * Ações de atalho. `screenshot` substituiu `toggleCapture` na UI (o atalho de "captura"
 * passa a tirar um printscreen do jogo); `toggleCapture`/`pushToTalk` continuam válidos
 * no tipo só por compatibilidade com configurações antigas — `migrateHotkeys` converte
 * ambos nos caminhos de escrita (load e `CLIPS_SET_CONFIG`), por isso nenhum caminho
 * de leitura (UI/engine) os vê — mas já não são oferecidos na interface.
 *
 * NÃO remover os membros: `migrateHotkeys` compara `hk.action === 'toggleCapture'` /
 * `'pushToTalk'` (o literal tem de estar na união) e os configs guardados em disco são
 * tipados como `HotkeyBinding[]` no load.
 */
export type HotkeyAction =
  | 'saveClip'
  /**
   * @deprecated Migrado para `screenshot` em todos os caminhos de escrita (ver
   * `migrateHotkeys` em `src/main/services/clips-config-manager.ts`); a UI já não
   * oferece este atalho. Mantido no tipo só por compatibilidade com configs antigas.
   */
  | 'toggleCapture'
  | 'toggleMic'
  /**
   * @deprecated Nunca existiu no enum C# `HotkeyAction` (`Hotkeys/HotkeyManager.cs`)
   * e o `<select>` de acção em `ClipsConfigGame.tsx` deixou de o oferecer (item 2b).
   * Migrado para `toggleMic` (PTT controlava o microfone) por `migrateHotkeys` no
   * load e no `CLIPS_SET_CONFIG`. Mantido no tipo só por compatibilidade com configs
   * guardadas antigas.
   */
  | 'pushToTalk'
  | 'screenshot'
export type HotkeyModifier = 'Ctrl' | 'Shift' | 'Alt'
export type PushToTalkMode = 'off' | 'hold' | 'toggle'

export interface HotkeyBinding {
  id: string
  vk: number
  modifiers: HotkeyModifier[]
  action: HotkeyAction
  replayDurationSeconds?: number
  enabled: boolean
}

export interface AudioSessionInfo {
  processId: number
  processName: string
  displayName: string
  isSelected: boolean
}

export interface ClipsEngineStatus {
  running: boolean
  capturing: boolean
  uptime: number
  fps: number
  replayTimeSeconds: number
  captureBackend?: string
  /**
   * Alvo da captura ativa. `desktop`/`window` explicam o que está sendo gravado quando
   * não há jogo detectado (`currentGame` ausente). Ausente = captura inativa.
   */
  captureMode?: ClipsCaptureMode
  encoder?: string
  estimatedRamMB?: number
  diskSpaceOk?: boolean
  currentGame?: string
  customGameProcess?: string
  lastCrashRecovered?: boolean
  audioLoopback?: boolean
  audioFallback?: boolean
  audioSampleRate?: number
  lastFrameMs?: number
  lastClipSize?: number
  activePipelines?: number
  watchdogOk?: boolean
  memoryMB?: number
  micLevel?: number
  replayBufferBytes?: number
  replayBufferVideoFrames?: number
  replayBufferVideoBytes?: number
  replayBufferAudioPackets?: number
  replayBufferAudioBytes?: number
  droppedFrames?: number
  gpuBusyDrops?: number
  /** Perfil calibrado da máquina aplicado na última captura (Weak/Medium/Strong) */
  calibrationTier?: string
  /**
   * Codec de ffmpeg em uso ("h264_nvenc", "hevc_amf", "libx264"...). Ausente = o engine não
   * rodou ainda ou parou, e o editor de clipes cai em software.
   */
  codec?: string
}

export interface ClipInfo {
  name: string
  path: string
  size: number
  createdAt: string
  duration: number
}

export interface MicDeviceInfo {
  id: string
  name: string
  isDefault: boolean
  channels: number
  sampleRate: number
}

export interface ClipsConfig {
  replayTimeSeconds: number
  micEnabled: boolean
  audioLoopback: boolean
  fps: number
  width: number
  height: number
  bitrateKbps: number
  /** Quality value — CQ for NVENC/AV1, CRF for x264/x265 (0-51, lower = better, default 20) */
  cq: number
  /** VBV max bitrate in Kbps (default 30000 = 30Mbps) */
  maxrateKbps: number
  /** VBV buffer size in Kbps (default 60000 = 60Mbps) */
  bufsizeKbps: number
  /** Number of B-frames (0-16, default 3) */
  bframes: number
  /** RC lookahead frames (0-256, default 16) */
  lookahead: number
  /** NVENC preset (p4, p5, etc., default p5) */
  encoderPreset: string
  /** Codec preference: auto | h264 | hevc | av1 | libx264 | libx265 */
  codec?: string
  /** GPU adapter index for multi-GPU systems (-1 = auto) */
  adapterIndex?: number
  outputDirectory: string
  forceSoftware: boolean
  hotkeys: HotkeyBinding[]
  pushToTalk: PushToTalkMode
  pushToTalkKeys: number[]
  gameDetection: boolean
  gameAudioOnly: boolean
  customGameProcess?: string
  micDeviceId?: string
  autoStartCapture?: boolean
  /** Volume do áudio do jogo no clip (0.0 a 2.0, default 1.0) */
  gameVolume?: number
  /** Volume do microfone no clip (0.0 a 2.0, default 1.0) */
  micVolume?: number
  selectedAudioSessions: number[]
  useExcludeMode: boolean
  excludeProcessId: number
  /** Sample rate de áudio: 44100, 48000, 96000 (default 48000) */
  audioSampleRate?: number
  /** AutoCleanup: remove clips antigos quando o disco está cheio */
  autoCleanupEnabled: boolean
  /** Limite em GB de espaço total que o usuário quer usar para clips (default 100) */
  autoCleanupThresholdGB: number
  /** RNNoise/anlmdn noise suppression on microphone */
  noiseSuppression?: boolean
  /** RAM-aware adaptive quality: adjusts CQ/resolution/replay based on available system RAM (default false) */
  adaptiveQuality?: boolean
  /** Remove black bars (letterboxing) by stretching to fill the full 16:9 frame instead of preserving aspect ratio (default true) */
  stretchToFit?: boolean
  /** Buffer de replay: 'ram' = só RAM (excedente descartado); 'hybrid' = RAM cap 3min + excedente no disco; 'disk' = só disco (RAM staging ~1s, vídeo+áudio spill) */
  replayBufferMode?: 'ram' | 'hybrid' | 'disk'
}

export interface ClipTrimResult {
  success: boolean
  path?: string
  error?: string
  /** True when the user cancelled the operation instead of it failing. */
  cancelled?: boolean
}

export interface ClipMergeResult {
  success: boolean
  path?: string
  error?: string
  /** True when the user cancelled the operation instead of it failing. */
  cancelled?: boolean
}

/** AMF enhancement applied during re-encode (AMD GPUs only). 'none' = no enhancement. */
export type EnhanceOption = 'none' | 'sr' | 'frc' | 'sr+frc'

/**
 * Ceiling for the `cas` sharpening strength exposed by the clip editor.
 *
 * ffmpeg accepts 0..1, but near 1 the filter stops being a sharpener and starts
 * amplifying whatever it finds: high-frequency grain, chroma noise on flat color
 * areas, and ringing along edges — the classic "deep frying" look. It also
 * crushes dynamic range and distorts color transitions. 0.9 is the highest value
 * that still reads as clean sharpening, so the slider and the IPC clamp both
 * stop here instead of exposing the full 0..1 range.
 */
export const MAX_SHARPNESS = 0.9

/**
 * Progress of a running re-encode (clip trim or merge), pushed from the main
 * process while ffmpeg works.
 *
 * `jobKey` identifies which job the reading belongs to - the source clip path
 * for a trim, the joined source paths for a merge - so a stale reading from a
 * finished or superseded job is never attributed to the current one.
 */
export interface ClipEncodeProgressEvent {
  jobKey: string
  /** Completion percentage, clamped to [0, 100]. */
  percent: number
  /** Output position reached so far, in seconds. */
  outTimeSeconds: number
  /** Total expected output duration, in seconds. */
  totalSeconds: number
  /** Estimated seconds remaining, or null while it cannot be computed. */
  etaSeconds: number | null
  /** ffmpeg's speed factor (e.g. 12.4 for "12.4x"), or null when unknown. */
  speed: number | null
  /** True once ffmpeg reported completion for the job. */
  done: boolean
}
