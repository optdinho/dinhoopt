import type { ClipsState } from './useClipsState'
import { TogglePill } from './clips-utils'

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
      <span
        className="inline-flex h-3.5 w-3.5 cursor-pointer items-center justify-center rounded-full text-[9px] font-bold"
        style={{ background: 'rgba(113,113,122,0.15)', color: 'var(--text-dim)' }}
        onClick={() => setActiveTip(activeTip === id ? null : id)}
      >
        ?
      </span>
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
}: Pick<
  ClipsState,
  'config' | 'status' | 'activeTip' | 'setActiveTip' | 'gpuList' | 'estimatedRamMB' | 'handleConfigUpdate' | 't'
>) {
  if (!config) return null
  return (
    <div className="space-y-3">
      {/* Quick Preset */}
      <div className="flex gap-1.5">
        {[
          {
            id: 'muito-alta',
            label: 'Muito Alta',
            sub: 'CQ 18 \u00b7 1440p',
            icon: '\u25cf\u25cf\u25cf',
            config: {
              cq: 18,
              maxrateKbps: 50000,
              bufsizeKbps: 100000,
              encoderPreset: 'p5',
              bframes: 3,
              lookahead: 32,
              bitrateKbps: 40000,
              width: 2560,
              height: 1440,
            },
          },
          {
            id: 'alta',
            label: 'Alta',
            sub: 'CQ 22 \u00b7 1080p',
            icon: '\u25cf\u25cf\u25cb',
            config: {
              cq: 22,
              maxrateKbps: 30000,
              bufsizeKbps: 60000,
              encoderPreset: 'p4',
              bframes: 2,
              lookahead: 16,
              bitrateKbps: 25000,
              width: 1920,
              height: 1080,
            },
          },
          {
            id: 'boa',
            label: 'Boa',
            sub: 'CQ 28 \u00b7 720p',
            icon: '\u25cf\u25cb\u25cb',
            config: {
              cq: 28,
              maxrateKbps: 20000,
              bufsizeKbps: 40000,
              encoderPreset: 'p3',
              bframes: 2,
              lookahead: 8,
              bitrateKbps: 15000,
              width: 1280,
              height: 720,
            },
          },
        ].map((p) => {
          const active = config.cq === p.config.cq && config.maxrateKbps === p.config.maxrateKbps
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
                <span
                  className="text-[11px] font-semibold"
                  style={{ color: active ? '#fff' : 'var(--text-primary)' }}
                >
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
      </div>

      {/* Codec selector */}
      <div>
        <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
          Codec
          <TipBadge id="codec" activeTip={activeTip} setActiveTip={setActiveTip} />
        </p>
        <div className="flex flex-wrap gap-1">
          {[
            { id: 'auto', label: 'Auto' },
            { id: 'h264', label: 'H.264' },
            { id: 'hevc', label: 'HEVC' },
            { id: 'av1', label: 'AV1' },
            { id: 'libx264', label: 'SW H.264' },
            { id: 'libx265', label: 'SW HEVC' },
          ].map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => handleConfigUpdate({ codec: c.id })}
              className="rounded-lg py-1 px-2 text-[10px] font-medium transition-all"
              style={{
                background:
                  (config.codec ?? 'auto') === c.id ? 'var(--accent)' : 'rgba(113,113,122,0.08)',
                color: (config.codec ?? 'auto') === c.id ? '#fff' : 'var(--text-primary)',
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {/* GPU selector */}
      {gpuList.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
            GPU
            <TipBadge id="gpu" activeTip={activeTip} setActiveTip={setActiveTip} />
          </p>
          <select
            value={config.adapterIndex ?? -1}
            onChange={(e) => handleConfigUpdate({ adapterIndex: Number(e.target.value) })}
            className="w-full rounded-lg px-2 py-1.5 text-[11px] transition-all"
            style={{
              background: 'rgba(113,113,122,0.08)',
              color: 'var(--text-primary)',
              border: '1px solid rgba(113,113,122,0.15)',
            }}
          >
            <option value={-1}>Auto</option>
            {gpuList.map((gpu) => (
              <option key={gpu.index} value={gpu.index}>
                {gpu.name}
              </option>
            ))}
          </select>
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
              { w: 640, h: 360, l: '360p' },
              { w: 1280, h: 720, l: '720p' },
              { w: 1920, h: 1080, l: '1080p' },
              { w: 2560, h: 1440, l: '1440p' },
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
            FPS
            <TipBadge id="fps" activeTip={activeTip} setActiveTip={setActiveTip} />
          </p>
          <div className="flex gap-1">
            {[30, 60, 75, 120, 144].map((f) => (
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

      {/* Replay Time */}
      <div>
        <p className="mb-1 text-[10px] font-medium tracking-wide uppercase" style={{ color: 'var(--text-dim)' }}>
          {t('replayTime')}
          <TipBadge id="replay" activeTip={activeTip} setActiveTip={setActiveTip} />
        </p>
        <div className="flex gap-1">
          {[60, 180, 300, 600].map((s) => (
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
              {Math.floor(s / 60)}min
            </button>
          ))}
        </div>
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
            <span style={{ color: 'var(--text-dim)' }}>RAM {t('clips')}</span>
            <span className="font-medium" style={{ color: 'var(--text-primary)' }}>
              {_status.replayBufferBytes
                ? `${Math.round(_status.replayBufferBytes / 1024 / 1024)} MB`
                : `~${estimatedRamMB} MB`}
            </span>
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full"
            style={{ background: 'rgba(113,113,122,0.12)' }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${
                  _status.replayBufferBytes
                    ? Math.min((_status.replayBufferBytes / 1024 / 1024 / estimatedRamMB) * 100, 100)
                    : 0
                }%`,
                background:
                  estimatedRamMB > 3000 ? '#ef4444' : estimatedRamMB > 1500 ? '#f59e0b' : '#3b82f6',
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
