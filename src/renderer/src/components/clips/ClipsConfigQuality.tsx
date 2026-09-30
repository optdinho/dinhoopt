import { ChevronDown, Gauge, Sparkles } from 'lucide-react'
import { useState } from 'react'
import {
  PRESET_DOTS,
  PRESET_LABEL_KEYS,
  PRESET_LEVEL,
  PRESET_ORDER,
  presetSubLabel,
  QUALITY_PRESETS,
  RESOLUTION_HEIGHT,
} from './clips-quality-presets'
import { SegmentedControl, TogglePill } from './clips-utils'
import type { ClipsState } from './useClipsState'

export function TipBadge({
  id,
  activeTip,
  setActiveTip,
}: {
  id: string
  activeTip: string | null
  setActiveTip: (tip: string | null) => void
}) {
  const active = activeTip === id
  return (
    <span className="relative inline-flex" data-tip={id}>
      <span
        role="button"
        tabIndex={0}
        className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold transition-all duration-150"
        style={{
          background: active ? 'rgba(139,92,246,0.2)' : 'rgba(113,113,122,0.15)',
          color: active ? 'var(--accent)' : 'var(--text-dim)',
        }}
        onClick={() => setActiveTip(active ? null : id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setActiveTip(active ? null : id)
        }}
      >
        ?
      </span>
    </span>
  )
}

/** A escada de pontos é uma lista fixa, então a chave React é o id do ponto, não o índice. */
const DOT_IDS = Array.from({ length: PRESET_DOTS }, (_, i) => `dot-${i}`)

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold tracking-wide uppercase"
      style={{ color: 'var(--text-dim)' }}
    >
      {children}
    </p>
  )
}

function ToggleRow({
  title,
  tip,
  activeTip,
  setActiveTip,
  enabled,
  tooltipId,
  onToggle,
}: {
  title: string
  tip?: string
  activeTip?: ClipsState['activeTip']
  setActiveTip?: ClipsState['setActiveTip']
  enabled: boolean
  tooltipId: string
  onToggle: () => void
}) {
  return (
    <div
      className="flex items-center justify-between rounded-xl px-3 py-2.5"
      style={{
        background: `linear-gradient(180deg, rgba(255,255,255,0.03), transparent 55%), var(--card-bg)`,
        border: `1px solid ${enabled ? `rgba(59,130,246,0.35)` : 'var(--border-subtle)'}`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="text-[10px] font-medium" style={{ color: 'var(--text-primary)' }}>
          {title}
        </span>
        {tip && activeTip && setActiveTip && (
          <TipBadge id={tooltipId} activeTip={activeTip} setActiveTip={setActiveTip} />
        )}
      </div>
      <TogglePill accent="blue" enabled={enabled} onToggle={onToggle} />
    </div>
  )
}

export function QualitySection({
  config,
  status: _status,
  activeTip,
  setActiveTip,
  gpuList,
  estimatedRamMB,
  handleConfigUpdate,
  t,
}: Pick<
  ClipsState,
  'config' | 'status' | 'activeTip' | 'setActiveTip' | 'gpuList' | 'estimatedRamMB' | 'handleConfigUpdate' | 't'
>) {
  const [gpuOpen, setGpuOpen] = useState(false)
  if (!config) return null
  const replayPresets = [30, 120, 300]
  const isCustomReplay = !replayPresets.includes(config.replayTimeSeconds)
  const formatReplay = (s: number) =>
    s < 60
      ? `${s}${t('s')}`
      : s % 60 === 0
        ? `${s / 60}${t('min')}`
        : `${Math.floor(s / 60)}${t('min')} ${s % 60}${t('s')}`
  return (
    <div className="space-y-3">
      {/* Quick Preset */}
      <div className="grid grid-cols-5 gap-1">
        {PRESET_ORDER.map((id) => {
          const preset = QUALITY_PRESETS[id]
          const active = config.cq === preset.cq && config.maxrateKbps === preset.maxrateKbps
          const level = PRESET_LEVEL[id]
          return (
            <button
              key={id}
              type="button"
              onClick={() => handleConfigUpdate(preset)}
              className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-lg border px-1 py-2 transition-all duration-150 hover:border-[rgba(139,92,246,0.45)]"
              style={{
                background: active
                  ? 'linear-gradient(160deg, rgba(139,92,246,0.22), rgba(139,92,246,0.06))'
                  : 'rgba(113,113,122,0.05)',
                borderColor: active ? 'rgba(139,92,246,0.5)' : 'var(--border-subtle)',
                boxShadow: active ? '0 4px 16px rgba(139,92,246,0.15)' : 'none',
              }}
            >
              <span className="flex items-center gap-[3px]" aria-hidden="true">
                {DOT_IDS.map((dotId, i) => (
                  <span
                    key={dotId}
                    className="h-[3px] w-[3px] rounded-full transition-colors duration-150"
                    style={{
                      background: i < level ? (active ? '#a78bfa' : 'var(--text-secondary)') : 'rgba(113,113,122,0.25)',
                    }}
                  />
                ))}
              </span>
              <span
                className="max-w-full truncate text-[11px] leading-none font-semibold"
                style={{ color: active ? '#fff' : 'var(--text-primary)' }}
              >
                {t(PRESET_LABEL_KEYS[id])}
              </span>
              <span
                className="max-w-full truncate text-[7px] leading-none font-medium tracking-tight"
                style={{ color: active ? 'rgba(255,255,255,0.7)' : 'var(--text-dim)', opacity: active ? 1 : 0.7 }}
              >
                {presetSubLabel(preset)}
              </span>
            </button>
          )
        })}
      </div>

      {/* GPU selector */}
      {gpuList.length > 0 && (
        <div>
          <FieldLabel>
            {t('gpuLabel')}
            <TipBadge id="gpu" activeTip={activeTip} setActiveTip={setActiveTip} />
          </FieldLabel>
          <div className="relative">
            <button
              type="button"
              onClick={() => setGpuOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-[11px] transition-all"
              style={{
                background: 'rgba(113,113,122,0.06)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              <span className="truncate">
                {config.adapterIndex === undefined || config.adapterIndex === -1
                  ? t('codecAuto')
                  : (gpuList.find((g) => g.index === config.adapterIndex)?.name ?? t('codecAuto'))}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 transition-transform" style={{ color: 'var(--text-dim)' }} />
            </button>
            {gpuOpen && (
              <>
                <div aria-hidden="true" className="fixed inset-0 z-20" onMouseDown={() => setGpuOpen(false)} />
                <div
                  className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-xl py-1"
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-medium)',
                    boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
                  }}
                >
                  {[{ index: -1, name: t('codecAuto') }, ...gpuList].map((gpu) => (
                    <button
                      key={gpu.index}
                      type="button"
                      onClick={() => {
                        handleConfigUpdate({ adapterIndex: gpu.index })
                        setGpuOpen(false)
                      }}
                      className="block w-full truncate px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.05]"
                      style={{
                        color: (config.adapterIndex ?? -1) === gpu.index ? 'var(--accent)' : 'var(--text-primary)',
                      }}
                    >
                      {gpu.name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Resolution + FPS side by side */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <FieldLabel>
            {t('resolution')}
            <TipBadge id="resolution" activeTip={activeTip} setActiveTip={setActiveTip} />
          </FieldLabel>
          <SegmentedControl
            layoutId="resolution"
            options={[
              { value: '854', label: '480p' },
              { value: '1280', label: '720p' },
              { value: '1600', label: '900p' },
              { value: '1920', label: '1080p' },
            ]}
            value={String(config.width) as '854' | '1280' | '1600' | '1920'}
            onChange={(v) => {
              const w = Number(v)
              handleConfigUpdate({ width: w, height: RESOLUTION_HEIGHT[w] ?? 720 })
            }}
          />
        </div>
        <div>
          <FieldLabel>
            {t('fps')}
            <TipBadge id="fps" activeTip={activeTip} setActiveTip={setActiveTip} />
          </FieldLabel>
          <SegmentedControl
            layoutId="fps"
            options={[
              { value: '30', label: '30' },
              { value: '60', label: '60' },
            ]}
            value={String(config.fps) as '30' | '60'}
            onChange={(v) => handleConfigUpdate({ fps: Number(v) })}
          />
        </div>
      </div>

      {/* Stretch to fit (remove black bars) */}
      <ToggleRow
        title={t('stretchToFit')}
        tip={t('stretchToFitTooltip')}
        tooltipId="stretch-to-fit"
        activeTip={activeTip}
        setActiveTip={setActiveTip}
        enabled={config.stretchToFit ?? true}
        onToggle={() => handleConfigUpdate({ stretchToFit: !(config.stretchToFit ?? true) })}
      />

      {/* Replay buffer mode (RAM / hybrid / disk-only) */}
      <div
        className="rounded-xl px-3 py-2.5"
        style={{ background: 'rgba(113,113,122,0.05)', border: '1px solid var(--border-subtle)' }}
      >
        <FieldLabel>
          {t('replayBufferMode')}
          <TipBadge id="replay-buffer-mode" activeTip={activeTip} setActiveTip={setActiveTip} />
        </FieldLabel>
        <SegmentedControl
          layoutId="replay-buffer-mode"
          value={config.replayBufferMode ?? 'disk'}
          onChange={(v) => handleConfigUpdate({ replayBufferMode: v })}
          options={[
            { value: 'ram', label: t('replayBufferModeRam'), sub: t('replayBufferModeRamSub') },
            { value: 'hybrid', label: t('replayBufferModeHybrid'), sub: t('replayBufferModeHybridSub') },
            { value: 'disk', label: t('replayBufferModeDisk'), sub: t('replayBufferModeDiskSub') },
          ]}
        />
      </div>

      {/* Replay Time */}
      <div
        className="rounded-xl px-3 py-2.5"
        style={{ background: 'rgba(113,113,122,0.05)', border: '1px solid var(--border-subtle)' }}
      >
        <FieldLabel>
          {t('replayTime')}
          <TipBadge id="replay" activeTip={activeTip} setActiveTip={setActiveTip} />
        </FieldLabel>
        <SegmentedControl
          layoutId="replay"
          options={[
            { value: '30', label: t('replayPreset30s') },
            { value: '120', label: t('replayPreset2min') },
            { value: '300', label: t('replayPreset5min') },
            {
              value: 'custom',
              label: t('replayCustom'),
              ...(isCustomReplay ? { title: `${formatReplay(config.replayTimeSeconds)}` } : {}),
            },
          ]}
          value={isCustomReplay ? 'custom' : String(config.replayTimeSeconds)}
          onChange={(v) =>
            handleConfigUpdate({
              replayTimeSeconds: v === 'custom' ? (isCustomReplay ? config.replayTimeSeconds : 150) : Number(v),
            })
          }
        />
        {isCustomReplay && (
          <div className="mt-2">
            <input
              type="range"
              min={30}
              max={600}
              step={5}
              value={Math.max(30, Math.min(600, config.replayTimeSeconds))}
              onChange={(e) => handleConfigUpdate({ replayTimeSeconds: Number(e.target.value) })}
              className="clip-range w-full"
              style={{
                background: `linear-gradient(to right, var(--accent) ${
                  ((Math.max(30, Math.min(600, config.replayTimeSeconds)) - 30) / 570) * 100
                }%, rgba(113,113,122,0.2) ${((Math.max(30, Math.min(600, config.replayTimeSeconds)) - 30) / 570) * 100}%)`,
              }}
            />
            <div className="mt-1 flex justify-between text-[10px]">
              <span style={{ color: 'var(--text-dim)' }}>{t('replayMin')}</span>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
                {formatReplay(config.replayTimeSeconds)}
              </span>
              <span style={{ color: 'var(--text-dim)' }}>{t('replayMax')}</span>
            </div>
          </div>
        )}
        {config.replayTimeSeconds >= 300 && (
          <div
            className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] leading-snug"
            style={{ color: '#f87171' }}
          >
            {t('replayRamWarning')}
          </div>
        )}
      </div>

      {/* Adaptive Quality */}
      <ToggleRow
        title={t('adaptiveQuality')}
        tip={t('tooltipAdaptiveQuality')}
        tooltipId="adaptive-quality"
        activeTip={activeTip}
        setActiveTip={setActiveTip}
        enabled={config.adaptiveQuality ?? false}
        onToggle={() => handleConfigUpdate({ adaptiveQuality: !(config.adaptiveQuality ?? false) })}
      />
      {(config.adaptiveQuality ?? false) && _status.calibrationTier && (
        <div
          className="flex items-center gap-2 rounded-xl border px-3 py-2"
          style={{
            background: 'linear-gradient(90deg, rgba(139,92,246,0.16), rgba(59,130,246,0.1))',
            borderColor: 'rgba(139,92,246,0.35)',
          }}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="text-[10px] font-medium" style={{ color: 'var(--text-secondary)' }}>
            {t('calibrationActive', { tier: _status.calibrationTier })}
          </span>
        </div>
      )}

      {/* Buffer Usage */}
      {estimatedRamMB > 0 && (
        <div
          className="rounded-xl px-3 py-2.5"
          style={{ background: 'rgba(113,113,122,0.05)', border: '1px solid var(--border-subtle)' }}
        >
          <div className="mb-1.5 flex justify-between text-[10px]">
            <span className="flex items-center gap-1 font-medium" style={{ color: 'var(--text-dim)' }}>
              <Gauge className="h-3 w-3" />
              {t('ramLabel')}
            </span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {_status.replayBufferBytes
                ? `${Math.round(_status.replayBufferBytes / 1024 / 1024)} ${t('megabytes')}`
                : `~${estimatedRamMB} ${t('megabytes')}`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(113,113,122,0.12)' }}>
            <div
              className="relative h-full rounded-full transition-all duration-300"
              style={{
                width: `${
                  _status.replayBufferBytes
                    ? Math.min((_status.replayBufferBytes / 1024 / 1024 / estimatedRamMB) * 100, 100)
                    : 0
                }%`,
                background: estimatedRamMB > 3000 ? '#ef4444' : estimatedRamMB > 1500 ? '#f59e0b' : '#3b82f6',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
