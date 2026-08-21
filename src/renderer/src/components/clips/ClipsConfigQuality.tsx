import { ChevronDown, Pen } from 'lucide-react'
import { useState } from 'react'
import { TogglePill } from './clips-utils'
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
  return (
    <span className="relative inline-flex" data-tip={id}>
      <button
        type="button"
        className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
        style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
        onClick={() => setActiveTip(activeTip === id ? null : id)}
      >
        ?
      </button>
    </span>
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
  activeQualityPreset,
  customProfileOpen,
  setCustomProfileOpen,
  customProfile,
  setCustomProfile,
  saveCustomProfile,
}: Pick<
  ClipsState,
  | 'config'
  | 'status'
  | 'activeTip'
  | 'setActiveTip'
  | 'gpuList'
  | 'estimatedRamMB'
  | 'handleConfigUpdate'
  | 't'
  | 'activeQualityPreset'
  | 'customProfileOpen'
  | 'setCustomProfileOpen'
  | 'customProfile'
  | 'setCustomProfile'
  | 'saveCustomProfile'
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
      <div className="flex gap-1.5">
        {[
          {
            id: 'muito-alta',
            label: t('presetMuitoAlta'),
            sub: 'CQ 16 \u00b7 1080p',
            icon: '\u25cf\u25cf\u25cf',
            config: {
              cq: 16,
              maxrateKbps: 65000,
              bufsizeKbps: 130000,
              encoderPreset: 'p5',
              bframes: 3,
              lookahead: 32,
              bitrateKbps: 65000,
              width: 1920,
              height: 1080,
              fps: 60,
            },
          },
          {
            id: 'alta',
            label: t('presetAlta'),
            sub: 'CQ 18 \u00b7 1080p',
            icon: '\u25cf\u25cf\u25cb',
            config: {
              cq: 18,
              maxrateKbps: 55000,
              bufsizeKbps: 110000,
              encoderPreset: 'p5',
              bframes: 2,
              lookahead: 32,
              bitrateKbps: 55000,
              width: 1920,
              height: 1080,
              fps: 60,
            },
          },
          {
            id: 'boa',
            label: t('presetBoa'),
            sub: 'CQ 20 \u00b7 720p',
            icon: '\u25cf\u25cb\u25cb',
            config: {
              cq: 20,
              maxrateKbps: 40000,
              bufsizeKbps: 80000,
              encoderPreset: 'p5',
              bframes: 2,
              lookahead: 32,
              bitrateKbps: 40000,
              width: 1280,
              height: 720,
              fps: 60,
            },
          },
        ].map((p) => {
          const active =
            activeQualityPreset !== 'custom' && config.cq === p.config.cq && config.maxrateKbps === p.config.maxrateKbps
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handleConfigUpdate(p.config)}
              className={`group relative flex-1 rounded-xl border px-2.5 py-2 text-left transition-all ${
                active ? 'border-transparent' : 'hover:border-white/10'
              }`}
              style={{
                background: active ? 'var(--accent)' : 'rgba(113,113,122,0.06)',
                borderColor: active ? 'transparent' : 'rgba(113,113,122,0.1)',
                boxShadow: 'none',
              }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold" style={{ color: active ? '#fff' : 'var(--text-primary)' }}>
                  {p.label}
                </span>
                <span
                  className="text-[9px] tracking-wider"
                  style={{
                    color: active ? '#fff' : 'var(--text-dim)',
                    opacity: active ? 0.7 : 0.5,
                  }}
                >
                  {p.icon}
                </span>
              </div>
              <div
                className="mt-0.5 text-[9px]"
                style={{
                  color: active ? '#fff' : 'var(--text-dim)',
                  opacity: active ? 0.7 : 0.6,
                }}
              >
                {p.sub}
              </div>
            </button>
          )
        })}

        {/* Custom profile button */}
        <button
          type="button"
          onClick={() => setCustomProfileOpen(!customProfileOpen)}
          className={`group relative flex-1 rounded-xl border px-2.5 py-2 text-left transition-all ${
            activeQualityPreset === 'custom' ? 'border-transparent' : 'hover:border-white/10'
          }`}
          style={{
            background: activeQualityPreset === 'custom' ? 'var(--accent)' : 'rgba(113,113,122,0.06)',
            borderColor: activeQualityPreset === 'custom' ? 'transparent' : 'rgba(113,113,122,0.1)',
            boxShadow: 'none',
          }}
        >
          <div className="flex items-center justify-between">
            <span
              className="text-[11px] font-semibold"
              style={{ color: activeQualityPreset === 'custom' ? '#fff' : 'var(--text-primary)' }}
            >
              {t('customPresetLabel')}
            </span>
            <Pen
              className="h-2.5 w-2.5"
              style={{ color: activeQualityPreset === 'custom' ? '#fff' : 'var(--text-dim)', opacity: 0.7 }}
            />
          </div>
          <div
            className="mt-0.5 text-[9px]"
            style={{
              color: activeQualityPreset === 'custom' ? '#fff' : 'var(--text-dim)',
              opacity: activeQualityPreset === 'custom' ? 0.7 : 0.6,
            }}
          >
            {t('customPresetDesc')}
          </div>
        </button>
      </div>

      {/* Expandable custom profile panel */}
      {customProfileOpen && (
        <div
          className="rounded-lg px-3 py-3"
          style={{ background: 'rgba(113,113,122,0.06)', border: '1px solid rgba(113,113,122,0.12)' }}
        >
          <p className="mb-2.5 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            {t('customQualityProfile')} \u2014 {t('customQualityDesc')}
          </p>
          <div className="grid grid-cols-3 gap-x-4 gap-y-2.5">
            {/* CQ */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                CQ
              </label>
              <input
                type="number"
                min={1}
                max={51}
                value={customProfile?.cq ?? 20}
                onChange={(e) =>
                  setCustomProfile({
                    ...(customProfile ?? {}),
                    cq: Math.max(1, Math.min(51, Number(e.target.value) || 20)),
                  })
                }
                className="w-full rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)]"
                style={{
                  background: 'rgba(113,113,122,0.08)',
                  borderColor: 'rgba(113,113,122,0.15)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            {/* Maxrate */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                Maxrate (Kbps)
              </label>
              <input
                type="number"
                min={1000}
                max={500000}
                value={customProfile?.maxrateKbps ?? 40000}
                onChange={(e) =>
                  setCustomProfile({
                    ...(customProfile ?? {}),
                    maxrateKbps: Math.max(1000, Math.min(500000, Number(e.target.value) || 40000)),
                  })
                }
                className="w-full rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)]"
                style={{
                  background: 'rgba(113,113,122,0.08)',
                  borderColor: 'rgba(113,113,122,0.15)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            {/* Bufsize */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                Bufsize (Kbps)
              </label>
              <input
                type="number"
                min={2000}
                max={1000000}
                value={customProfile?.bufsizeKbps ?? 80000}
                onChange={(e) =>
                  setCustomProfile({
                    ...(customProfile ?? {}),
                    bufsizeKbps: Math.max(2000, Math.min(1000000, Number(e.target.value) || 80000)),
                  })
                }
                className="w-full rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)]"
                style={{
                  background: 'rgba(113,113,122,0.08)',
                  borderColor: 'rgba(113,113,122,0.15)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            {/* Encoder Preset */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                {t('encoderPreset')}
              </label>
              <select
                value={customProfile?.encoderPreset ?? 'p5'}
                onChange={(e) => setCustomProfile({ ...(customProfile ?? {}), encoderPreset: e.target.value })}
                className="w-full rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)]"
                style={{
                  background: 'rgba(113,113,122,0.08)',
                  borderColor: 'rgba(113,113,122,0.15)',
                  color: 'var(--text-primary)',
                }}
              >
                {['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            {/* Bframes */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                Bframes
              </label>
              <input
                type="number"
                min={0}
                max={16}
                value={customProfile?.bframes ?? 2}
                onChange={(e) =>
                  setCustomProfile({
                    ...(customProfile ?? {}),
                    bframes: Math.max(0, Math.min(16, Number(e.target.value) || 0)),
                  })
                }
                className="w-full rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)]"
                style={{
                  background: 'rgba(113,113,122,0.08)',
                  borderColor: 'rgba(113,113,122,0.15)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            {/* Lookahead */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                Lookahead
              </label>
              <input
                type="number"
                min={0}
                max={256}
                value={customProfile?.lookahead ?? 32}
                onChange={(e) =>
                  setCustomProfile({
                    ...(customProfile ?? {}),
                    lookahead: Math.max(0, Math.min(256, Number(e.target.value) || 0)),
                  })
                }
                className="w-full rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)]"
                style={{
                  background: 'rgba(113,113,122,0.08)',
                  borderColor: 'rgba(113,113,122,0.15)',
                  color: 'var(--text-primary)',
                }}
              />
            </div>
            {/* Resolution */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                {t('resolution')}
              </label>
              <div className="flex gap-1">
                {[
                  { w: 854, h: 480, l: '480p' },
                  { w: 1280, h: 720, l: '720p' },
                  { w: 1920, h: 1080, l: '1080p' },
                ].map((r) => (
                  <button
                    key={r.l}
                    type="button"
                    onClick={() => setCustomProfile({ ...(customProfile ?? {}), width: r.w, height: r.h })}
                    className="flex-1 rounded-md py-0.5 text-[10px] font-medium transition-all"
                    style={{
                      background: r.w === (customProfile?.width ?? 1920) ? 'var(--accent)' : 'rgba(113,113,122,0.1)',
                      color: r.w === (customProfile?.width ?? 1920) ? '#fff' : 'var(--text-primary)',
                    }}
                  >
                    {r.l}
                  </button>
                ))}
              </div>
            </div>
            {/* FPS */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                {t('fps')}
              </label>
              <div className="flex gap-1">
                {[30, 60, 120].map((f) => (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setCustomProfile({ ...(customProfile ?? {}), fps: f })}
                    className="flex-1 rounded-md py-0.5 text-[10px] font-medium transition-all"
                    style={{
                      background: f === (customProfile?.fps ?? 60) ? 'var(--accent)' : 'rgba(113,113,122,0.1)',
                      color: f === (customProfile?.fps ?? 60) ? '#fff' : 'var(--text-primary)',
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
            {/* Replay Time */}
            <div>
              {/* biome-ignore lint/a11y/noLabelWithoutControl: decorative label */}
              <label
                className="mb-0.5 block text-[9px] font-medium uppercase tracking-wide"
                style={{ color: 'var(--text-dim)' }}
              >
                {t('replayTime')}
              </label>
              <select
                value={customProfile?.replayTimeSeconds ?? 120}
                onChange={(e) =>
                  setCustomProfile({ ...(customProfile ?? {}), replayTimeSeconds: Number(e.target.value) })
                }
                className="w-full rounded-md border px-2 py-1 text-[11px] font-medium outline-none transition-colors focus:border-[var(--accent)]"
                style={{
                  background: 'rgba(113,113,122,0.08)',
                  borderColor: 'rgba(113,113,122,0.15)',
                  color: 'var(--text-primary)',
                }}
              >
                {[30, 60, 120, 300, 600].map((s) => (
                  <option key={s} value={s}>
                    {formatReplay(s)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={saveCustomProfile}
            className="mt-3 w-full rounded-lg py-1.5 text-[11px] font-semibold transition-all hover:opacity-90"
            style={{ background: 'var(--accent)', color: '#fff' }}
          >
            {t('saveCustomProfile')}
          </button>
        </div>
      )}

      {/* Codec selector */}
      <div>
        <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
          {t('codec')}
          <TipBadge id="codec" activeTip={activeTip} setActiveTip={setActiveTip} />
        </p>
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'auto', labelKey: 'codecAuto' },
            { id: 'h264', labelKey: 'codecH264' },
            { id: 'hevc', labelKey: 'codecHevc' },
            { id: 'av1', labelKey: 'codecAv1' },
            { id: 'libx264', labelKey: 'codecSwH264' },
            { id: 'libx265', labelKey: 'codecSwHevc' },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleConfigUpdate({ codec: c.id })}
              className="rounded-lg py-1 px-2 text-[10px] font-medium transition-all"
              style={{
                background: (config.codec ?? 'auto') === c.id ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                color: (config.codec ?? 'auto') === c.id ? '#fff' : 'var(--text-primary)',
              }}
            >
              {t(c.labelKey)}
            </button>
          ))}
        </div>
      </div>

      {/* GPU selector */}
      {gpuList.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            {t('gpuLabel')}
            <TipBadge id="gpu" activeTip={activeTip} setActiveTip={setActiveTip} />
          </p>
          <div className="relative">
            <button
              type="button"
              onClick={() => setGpuOpen((o) => !o)}
              className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-[11px] transition-all"
              style={{
                background: 'rgba(113,113,122,0.08)',
                color: 'var(--text-primary)',
                border: '1px solid rgba(113,113,122,0.15)',
              }}
            >
              <span className="truncate">
                {config.adapterIndex === undefined || config.adapterIndex === -1
                  ? t('codecAuto')
                  : (gpuList.find((g) => g.index === config.adapterIndex)?.name ?? t('codecAuto'))}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0" style={{ color: 'var(--text-dim)' }} />
            </button>
            {gpuOpen && (
              <>
                <div aria-hidden="true" className="fixed inset-0 z-20" onMouseDown={() => setGpuOpen(false)} />
                <div
                  className="absolute z-30 mt-1 max-h-48 w-full overflow-y-auto rounded-lg py-1"
                  style={{
                    background: 'var(--card-bg)',
                    border: '1px solid var(--border-medium)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
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
                      className="block w-full truncate px-2.5 py-1.5 text-left text-[11px] transition-colors hover:bg-white/[0.05]"
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
      <div className="grid grid-cols-2 gap-3">
        <div>
          <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            {t('resolution')}
            <TipBadge id="resolution" activeTip={activeTip} setActiveTip={setActiveTip} />
          </p>
          <div className="flex gap-1">
            {[
              { w: 854, h: 480, l: '480p' },
              { w: 1280, h: 720, l: '720p' },
              { w: 1920, h: 1080, l: '1080p' },
            ].map((r) => (
              <button
                key={r.l}
                type="button"
                onClick={() => handleConfigUpdate({ width: r.w, height: r.h })}
                className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
                style={{
                  background: r.w === config.width ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                  color: r.w === config.width ? '#fff' : 'var(--text-primary)',
                }}
              >
                {r.l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            {t('fps')}
            <TipBadge id="fps" activeTip={activeTip} setActiveTip={setActiveTip} />
          </p>
          <div className="flex gap-1">
            {[30, 60, 75, 120].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => handleConfigUpdate({ fps: f })}
                className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
                style={{
                  background: f === config.fps ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                  color: f === config.fps ? '#fff' : 'var(--text-primary)',
                }}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Stretch to fit (remove black bars) */}
      <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {t('stretchToFit')}
            </span>
            <TipBadge id="stretch-to-fit" activeTip={activeTip} setActiveTip={setActiveTip} />
          </div>
          <TogglePill
            enabled={config.stretchToFit ?? false}
            accent="blue"
            onToggle={() => handleConfigUpdate({ stretchToFit: !(config.stretchToFit ?? false) })}
          />
        </div>
      </div>

      {/* Replay buffer mode (RAM + disk) */}
      <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {t('replayBufferMode')}
            </span>
            <TipBadge id="replay-buffer-mode" activeTip={activeTip} setActiveTip={setActiveTip} />
          </div>
          <TogglePill
            enabled={(config.replayBufferMode ?? 'ram') === 'hybrid'}
            accent="blue"
            onToggle={() =>
              handleConfigUpdate({
                replayBufferMode: (config.replayBufferMode ?? 'ram') === 'hybrid' ? 'ram' : 'hybrid',
              })
            }
          />
        </div>
      </div>

      {/* Replay Time */}
      <div>
        <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
          {t('replayTime')}
          <TipBadge id="replay" activeTip={activeTip} setActiveTip={setActiveTip} />
        </p>
        <div className="flex gap-1">
          {[
            { s: 30, label: t('replayPreset30s') },
            { s: 120, label: t('replayPreset2min') },
            { s: 300, label: t('replayPreset5min') },
          ].map(({ s, label }) => (
            <button
              key={s}
              type="button"
              onClick={() => handleConfigUpdate({ replayTimeSeconds: s })}
              className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
              style={{
                background: s === config.replayTimeSeconds ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                color: s === config.replayTimeSeconds ? '#fff' : 'var(--text-primary)',
              }}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => handleConfigUpdate({ replayTimeSeconds: isCustomReplay ? config.replayTimeSeconds : 150 })}
            className="flex-1 rounded-lg py-1 text-[11px] font-medium transition-all"
            style={{
              background: isCustomReplay ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
              color: isCustomReplay ? '#fff' : 'var(--text-primary)',
            }}
          >
            {t('replayCustom')}
          </button>
        </div>
        {isCustomReplay && (
          <div className="mt-2 rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
            <input
              type="range"
              min={30}
              max={600}
              step={5}
              value={Math.max(30, Math.min(600, config.replayTimeSeconds))}
              onChange={(e) => handleConfigUpdate({ replayTimeSeconds: Number(e.target.value) })}
              className="w-full"
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
            className="mt-1.5 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-1.5 text-[10px] leading-snug"
            style={{ color: '#f87171' }}
          >
            {t('replayRamWarning')}
          </div>
        )}
      </div>

      {/* Force Software Encoding */}
      <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {t('forceSoftware')}
            </span>
            <TipBadge id="force-software" activeTip={activeTip} setActiveTip={setActiveTip} />
          </div>
          <TogglePill
            enabled={config.forceSoftware ?? false}
            accent="blue"
            onToggle={() => handleConfigUpdate({ forceSoftware: !(config.forceSoftware ?? false) })}
          />
        </div>
      </div>

      {/* Adaptive Quality */}
      <div className="rounded-lg px-2.5 py-2" style={{ background: 'rgba(113,113,122,0.06)' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-xs" style={{ color: 'var(--text-primary)' }}>
              {t('adaptiveQuality')}
            </span>
            <TipBadge id="adaptive-quality" activeTip={activeTip} setActiveTip={setActiveTip} />
          </div>
          <TogglePill
            enabled={config.adaptiveQuality ?? true}
            accent="blue"
            onToggle={() => handleConfigUpdate({ adaptiveQuality: !(config.adaptiveQuality ?? true) })}
          />
        </div>
      </div>

      {/* Buffer Usage */}
      {estimatedRamMB > 0 && (
        <div>
          <div className="mb-1 flex justify-between text-[10px]">
            <span style={{ color: 'var(--text-dim)' }}>{t('ramLabel')}</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {_status.replayBufferBytes
                ? `${Math.round(_status.replayBufferBytes / 1024 / 1024)} ${t('megabytes')}`
                : `~${estimatedRamMB} ${t('megabytes')}`}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(113,113,122,0.12)' }}>
            <div
              className="h-full rounded-full transition-all"
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
