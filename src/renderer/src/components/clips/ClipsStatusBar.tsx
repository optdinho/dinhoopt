import {
  Activity,
  AppWindow,
  CircleStop,
  Cpu,
  Download,
  Gamepad2,
  HardDrive,
  Loader2,
  Mic,
  Microscope,
  Monitor,
  ShieldAlert,
  TriangleAlert,
  Video,
} from 'lucide-react'
import { formatUptime } from './clips-utils'
import type { ClipsState } from './useClipsState'

type Tone = 'green' | 'amber' | 'zinc' | 'red' | 'blue'

const TONES: Record<Tone, { bg: string; color: string; dot: string }> = {
  green: { bg: 'rgba(34,197,94,0.12)', color: '#22c55e', dot: '#22c55e' },
  amber: { bg: 'rgba(234,179,8,0.12)', color: '#eab308', dot: '#eab308' },
  zinc: { bg: 'rgba(113,113,122,0.12)', color: '#71717a', dot: '#71717a' },
  red: { bg: 'rgba(239,68,68,0.12)', color: '#ef4444', dot: '#ef4444' },
  blue: { bg: 'rgba(59,130,246,0.12)', color: '#3b82f6', dot: '#3b82f6' },
}

function Chip({
  icon: Icon,
  title,
  tone,
  children,
}: {
  icon?: React.ElementType
  title?: string
  tone?: Tone
  children: React.ReactNode
}) {
  const t = tone ? TONES[tone] : null
  return (
    <span
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px]"
      style={{
        background: t?.bg ?? 'rgba(113,113,122,0.08)',
        color: t?.color ?? 'var(--text-dim)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  )
}

export function ClipsStatusBar({
  status,
  statusLoaded,
  starting,
  stopping,
  loading,
  estimatedRamMB,
  handleStartRecording,
  handleStopRecording,
  handleSaveClip,
  t,
}: ClipsState) {
  const recording = status.running && status.capturing
  const idle = status.running && !status.capturing
  const stateTone: Tone = recording ? 'green' : idle ? 'amber' : 'zinc'
  const stateLabel = recording ? t('recording') : idle ? t('idle') : t('stopped')
  const tone = TONES[stateTone]

  return (
    <div className="rounded-2xl border p-5 glass-card" style={{ borderColor: 'var(--border-medium)' }}>
      {!statusLoaded ? (
        <div className="space-y-3">
          <div className="h-4 w-32 animate-shimmer rounded-md" style={{ background: 'rgba(113,113,122,0.15)' }} />
          <div className="flex gap-2">
            <div className="h-7 w-20 animate-shimmer rounded-lg" style={{ background: 'rgba(113,113,122,0.12)' }} />
            <div className="h-7 w-24 animate-shimmer rounded-lg" style={{ background: 'rgba(113,113,122,0.12)' }} />
          </div>
        </div>
      ) : (
        <>
          {/* Hero: state + timer on the left, actions on the right */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {t('recordingStatus')}
              </h3>
              <div className="mt-2.5 flex items-center gap-3">
                <span
                  className="inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold"
                  style={{ background: tone.bg, color: tone.color }}
                >
                  <span className="relative flex h-2.5 w-2.5">
                    {recording && (
                      <span
                        className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-60"
                        style={{ background: tone.dot }}
                      />
                    )}
                    <span className="relative inline-flex h-2.5 w-2.5 rounded-full" style={{ background: tone.dot }} />
                  </span>
                  {stateLabel}
                </span>
                {status.running && status.uptime > 0 && (
                  <span
                    className="font-mono text-2xl font-semibold leading-none tabular-nums"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {formatUptime(status.uptime, t)}
                  </span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {stopping ? (
                <button
                  type="button"
                  disabled
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium opacity-60 transition-all"
                  style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('stoppingRecording')}
                </button>
              ) : recording ? (
                <>
                  <button
                    type="button"
                    onClick={handleStopRecording}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-all hover:bg-red-500/25"
                    style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444' }}
                  >
                    <CircleStop className="h-4 w-4" />
                    {t('stopRecording')}
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveClip}
                    disabled={loading}
                    className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50"
                    style={{
                      background: 'var(--accent)',
                      color: 'var(--text-on-accent)',
                      boxShadow: '0 4px 16px var(--accent-muted-border)',
                    }}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    {t('saveClip')}
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={handleStartRecording}
                  disabled={starting}
                  className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all hover:opacity-90 disabled:opacity-50"
                  style={{
                    background: 'var(--accent)',
                    color: 'var(--text-on-accent)',
                    boxShadow: '0 4px 16px var(--accent-muted-border)',
                  }}
                >
                  <Video className="h-4 w-4" />
                  {starting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t('startingRecording')}
                    </>
                  ) : (
                    t('startRecording')
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Telemetry chips */}
          {status.running && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <Chip>
                <span>
                  {t('fps')}: {status.fps}
                </span>
              </Chip>
              <Chip>
                <span>
                  {t('replayTime')}: {Math.floor(status.replayTimeSeconds / 60)}
                  {t('min')}
                </span>
              </Chip>
              {status.captureBackend && (
                <Chip icon={Cpu}>
                  <span>{status.captureBackend}</span>
                  {status.encoder && (
                    <>
                      <span aria-hidden="true">&middot;</span>
                      <span>{status.encoder}</span>
                    </>
                  )}
                </Chip>
              )}
              {status.currentGame && (
                <Chip icon={Gamepad2} tone="blue">
                  {status.currentGame}
                </Chip>
              )}
              {status.capturing && (status.captureMode === 'desktop' || status.captureMode === 'window') && (
                <Chip icon={status.captureMode === 'desktop' ? Monitor : AppWindow}>
                  {status.captureMode === 'desktop' ? t('captureModeDesktop') : t('captureModeWindow')}
                </Chip>
              )}
              {(status.replayBufferBytes || estimatedRamMB > 0) && (
                <Chip icon={HardDrive}>
                  {status.replayBufferBytes
                    ? `${Math.round(status.replayBufferBytes / 1024 / 1024)}${t('megabytes')}`
                    : `~${estimatedRamMB}${t('megabytes')}`}
                </Chip>
              )}
              {status.memoryMB != null && status.memoryMB > 0 && (
                <Chip icon={Activity} title={t('memoryMBDesc')}>
                  {t('memoryMB')}: {status.memoryMB} {t('megabytes')}
                </Chip>
              )}
              {status.micLevel != null && (
                <Chip icon={Mic} title={t('micLevel')}>
                  <span className="flex items-end gap-0.5">
                    {[0.25, 0.5, 0.75, 0.9, 1].map((th) => (
                      <span
                        key={th}
                        className="w-1 rounded-sm transition-colors"
                        style={{
                          height: `${3 + th * 7}px`,
                          background:
                            (status.micLevel ?? 0) >= th
                              ? th >= 0.9
                                ? '#ef4444'
                                : '#22c55e'
                              : 'rgba(113,113,122,0.25)',
                        }}
                      />
                    ))}
                  </span>
                </Chip>
              )}
            </div>
          )}

          {/* Alerts */}
          {(status.lastCrashRecovered ||
            status.audioFallback ||
            status.diskSpaceOk === false ||
            (status.running && status.watchdogOk === false)) && (
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              {status.lastCrashRecovered && (
                <Chip icon={Microscope} tone="amber">
                  {t('crashRecovered')}
                </Chip>
              )}
              {status.audioFallback && (
                <Chip icon={TriangleAlert} tone="amber" title={t('audioFallbackDesc')}>
                  {t('audioFallbackWarning')}
                </Chip>
              )}
              {status.diskSpaceOk === false && (
                <Chip icon={HardDrive} tone="red">
                  {t('lowDisk')}
                </Chip>
              )}
              {status.running && status.watchdogOk === false && (
                <Chip icon={ShieldAlert} tone="red" title={t('watchdogFailedDesc')}>
                  {t('watchdogFailed')}
                </Chip>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
