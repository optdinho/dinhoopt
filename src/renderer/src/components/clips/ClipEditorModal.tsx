import type { ClipInfo, ClipMergeResult, ClipTrimResult } from '@shared/types'
import { Combine, Maximize, Minimize, Pause, Play, Scissors, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

interface ClipEditorModalProps {
  clip?: ClipInfo
  initialMergePaths?: string[]
  onClose: () => void
  onSave: () => void
}

function TrimTimeline({
  currentTime,
  startSec,
  endSec,
  duration,
  onSeek,
  onStartChange,
  onEndChange,
}: {
  currentTime: number
  startSec: number
  endSec: number
  duration: number
  onSeek: (s: number) => void
  onStartChange: (s: number) => void
  onEndChange: (s: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'seek' | 'start' | 'end' | null>(null)

  const posFromClient = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return 0
      return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
    },
    [duration],
  )

  const onMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!dragging) return
      const s = posFromClient(e.clientX)
      if (dragging === 'seek') onSeek(s)
      else if (dragging === 'start' && s < endSec) onStartChange(s)
      else if (dragging === 'end' && s > startSec) onEndChange(s)
    },
    [dragging, posFromClient, startSec, endSec, onSeek, onStartChange, onEndChange],
  )

  const onMouseUp = useCallback(() => setDragging(null), [])

  useEffect(() => {
    if (dragging) {
      window.addEventListener('mousemove', onMouseMove)
      window.addEventListener('mouseup', onMouseUp)
      return () => {
        window.removeEventListener('mousemove', onMouseMove)
        window.removeEventListener('mouseup', onMouseUp)
      }
    }
  }, [dragging, onMouseMove, onMouseUp])

  const pct = (s: number) => (duration > 0 ? (s / duration) * 100 : 0)

  return (
    <div
      ref={trackRef}
      className="relative h-8 cursor-pointer select-none"
      style={{ touchAction: 'none' }}
      onMouseDown={(e) => {
        const s = posFromClient(e.clientX)
        const distStart = Math.abs(s - startSec)
        const distEnd = Math.abs(s - endSec)
        const distCur = Math.abs(s - currentTime)
        if (distStart < 1 && distStart <= distEnd && distStart <= distCur) setDragging('start')
        else if (distEnd < 1 && distEnd <= distCur) setDragging('end')
        else {
          setDragging('seek')
          onSeek(s)
        }
      }}
    >
      {/* Track background */}
      <div
        className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
        style={{ background: 'rgba(255,255,255,0.12)' }}
      />

      {/* Selected region highlight */}
      <div
        className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
        style={{
          left: `${pct(startSec)}%`,
          width: `${pct(endSec) - pct(startSec)}%`,
          background: 'var(--accent)',
          opacity: 0.5,
        }}
      />

      {/* Start handle */}
      <div
        className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2"
        style={{
          left: `${pct(startSec)}%`,
          borderColor: 'var(--accent)',
          background: dragging === 'start' ? 'var(--accent)' : '#111318',
        }}
      />

      {/* End handle */}
      <div
        className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2"
        style={{
          left: `${pct(endSec)}%`,
          borderColor: 'var(--accent)',
          background: dragging === 'end' ? 'var(--accent)' : '#111318',
        }}
      />

      {/* Current position indicator */}
      <div
        className="absolute top-0 z-20 h-full w-0.5 -translate-x-1/2"
        style={{
          left: `${pct(currentTime)}%`,
          background: '#fff',
          opacity: 0.7,
        }}
      />
    </div>
  )
}

export function ClipEditorModal({ clip, initialMergePaths, onClose, onSave }: ClipEditorModalProps) {
  const { t } = useTranslation('clips')
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(clip?.duration || 60)
  const [trimming, setTrimming] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [realDuration, setRealDuration] = useState(clip?.duration || 0)
  const effectiveDuration = realDuration || clip?.duration || 60
  const [fullscreen, setFullscreen] = useState(false)
  const [showOverlay, setShowOverlay] = useState(true)
  const overlayTimer = useRef<ReturnType<typeof setTimeout>>()
  const containerRef = useRef<HTMLDivElement>(null)
  const mergeClipsState = useState<string[]>(initialMergePaths ?? (clip ? [clip.path] : []))
  const [mergeClips] = mergeClipsState
  const setMergeClips = mergeClipsState[1]
  const videoRef = useRef<HTMLVideoElement>(null)

  const videoUrl = clip ? window.dinho.clipsGetVideoUrl(clip.path) : ''

  const showTrim = clip && !initialMergePaths

  const fmt = (s: number) => {
    const m = Math.floor(s / 60)
    const sec = Math.floor(s % 60)
    return `${m}:${sec.toString().padStart(2, '0')}`
  }

  const seekTo = (seconds: number) => {
    const vid = videoRef.current
    if (vid) vid.currentTime = seconds
  }

  const togglePlay = () => {
    const vid = videoRef.current
    if (!vid) return
    if (vid.paused) {
      vid
        .play()
        .then(() => setPlaying(true))
        .catch(() => {})
    } else {
      vid.pause()
      setPlaying(false)
    }
  }

  const showOverlayTemporarily = () => {
    setShowOverlay(true)
    if (overlayTimer.current) clearTimeout(overlayTimer.current)
    if (fullscreen) {
      overlayTimer.current = setTimeout(() => setShowOverlay(false), 2500)
    }
  }

  useEffect(() => {
    const cb = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', cb)
    return () => document.removeEventListener('fullscreenchange', cb)
  }, [])

  useEffect(() => {
    if (!fullscreen) {
      setShowOverlay(true)
      if (overlayTimer.current) clearTimeout(overlayTimer.current)
    }
  }, [fullscreen])

  // Keyboard shortcuts: I = mark in, O = mark out
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!showTrim) return
      if (e.key === 'i' || e.key === 'I') {
        e.preventDefault()
        setStartSec(currentTime)
        if (currentTime >= endSec) setEndSec(Math.min(currentTime + 1, effectiveDuration))
      } else if (e.key === 'o' || e.key === 'O') {
        e.preventDefault()
        setEndSec(currentTime)
        if (currentTime <= startSec) setStartSec(Math.max(currentTime - 1, 0))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showTrim, currentTime, endSec, startSec, effectiveDuration])

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current
        ?.requestFullscreen()
        .then(() => setFullscreen(true))
        .catch(() => {})
    } else {
      document
        .exitFullscreen()
        .then(() => setFullscreen(false))
        .catch(() => {})
    }
  }

  const handleTrim = async () => {
    if (endSec <= startSec || startSec < 0 || endSec > effectiveDuration) {
      toast.error(t('invalidTrimRange'))
      return
    }
    setTrimming(true)
    try {
      const result: ClipTrimResult = await window.dinho.clipsTrimClip(clip!.path, startSec, endSec)
      if (result.success) {
        toast.success(t('trimSuccess'))
        onSave()
      } else {
        toast.error(result.error || t('trimFailed'))
      }
    } catch {
      toast.error(t('trimFailed'))
    } finally {
      setTrimming(false)
    }
  }

  const handleMerge = async () => {
    if (mergeClips.length < 2) {
      toast.error(t('needTwoClips'))
      return
    }
    try {
      const result: ClipMergeResult = await window.dinho.clipsMergeClips(mergeClips)
      if (result.success) {
        toast.success(t('mergeSuccess'))
        onSave()
      } else {
        toast.error(result.error || t('mergeFailed'))
      }
    } catch {
      toast.error(t('mergeFailed'))
    }
  }

  const trimDuration = endSec - startSec

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/85"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose()
      }}
      role="presentation"
    >
      <div
        className="w-full rounded-xl border shadow-2xl"
        style={{
          maxWidth: fullscreen ? '100%' : '36rem',
          height: fullscreen ? '100%' : 'auto',
          background: fullscreen ? '#000' : '#111318',
          borderColor: 'var(--border-medium)',
          display: 'flex',
          flexDirection: 'column',
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="presentation"
      >
        {/* Header — hidden in fullscreen */}
        {!fullscreen && (
          <div className="flex items-center justify-between px-6 pt-6 pb-3">
            <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
              {showTrim ? `${t('editClip')}: ${clip!.name}` : t('merge')}
            </h2>
            <button type="button" onClick={onClose} className="rounded-lg p-1 hover:bg-white/10">
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <div
          ref={containerRef}
          className={fullscreen ? 'flex flex-1 flex-col' : ''}
          onMouseMove={showOverlayTemporarily}
          style={fullscreen ? { background: '#000', minHeight: 0 } : undefined}
        >
          {showTrim && clip && (
            <>
              {/* Video wrapper */}
              <div className="relative flex-1 flex flex-col" style={{ minHeight: fullscreen ? 0 : undefined }}>
                <div
                  className={
                    fullscreen ? 'flex-1 flex items-center justify-center bg-black' : 'mb-4 overflow-hidden rounded-lg'
                  }
                >
                  <video
                    ref={videoRef}
                    src={videoUrl}
                    className={fullscreen ? 'max-h-full max-w-full' : 'w-full'}
                    style={fullscreen ? { objectFit: 'contain' } : { maxHeight: 240 }}
                    autoPlay
                    playsInline
                    onClick={togglePlay}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        togglePlay()
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    onLoadedMetadata={() => {
                      if (videoRef.current) setRealDuration(videoRef.current.duration)
                    }}
                    onEnded={() => {
                      setPlaying(false)
                      setCurrentTime(effectiveDuration)
                    }}
                    onPlay={() => setPlaying(true)}
                    onPause={() => setPlaying(false)}
                    onTimeUpdate={() => {
                      if (videoRef.current) setCurrentTime(videoRef.current.currentTime)
                    }}
                    onError={() => toast.error('Failed to load video preview')}
                    preload="auto"
                  />
                </div>

                {/* Overlay controls (fullscreen) — fixed at bottom */}
                {fullscreen && (
                  <div
                    className="fixed bottom-0 left-0 right-0 z-50 transition-opacity duration-300"
                    style={{
                      opacity: showOverlay ? 1 : 0,
                      pointerEvents: showOverlay ? 'auto' : 'none',
                    }}
                  >
                    <TrimTimeline
                      currentTime={currentTime}
                      startSec={startSec}
                      endSec={endSec}
                      duration={effectiveDuration}
                      onSeek={(s) => {
                        setCurrentTime(s)
                        seekTo(s)
                      }}
                      onStartChange={(s) => {
                        setStartSec(s)
                        seekTo(s)
                      }}
                      onEndChange={(s) => {
                        setEndSec(s)
                        seekTo(s)
                      }}
                    />
                    <div
                      className="flex items-center gap-3 px-4 py-4"
                      style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.9))' }}
                    >
                      <button type="button" onClick={togglePlay} className="rounded p-1.5 hover:bg-white/10">
                        {playing ? <Pause className="h-6 w-6 text-white" /> : <Play className="h-6 w-6 text-white" />}
                      </button>
                      <span className="text-sm font-mono text-white/90">
                        {fmt(currentTime)} / {fmt(effectiveDuration)}
                      </span>
                      <span className="ml-2 text-xs font-mono text-white/60">{fmt(trimDuration)}</span>
                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="ml-auto rounded p-1.5 hover:bg-white/10"
                      >
                        <Minimize className="h-5 w-5 text-white" />
                      </button>
                    </div>
                  </div>
                )}

                {/* Seek bar + controls (normal mode) */}
                {!fullscreen && (
                  <div className="mb-3">
                    <TrimTimeline
                      currentTime={currentTime}
                      startSec={startSec}
                      endSec={endSec}
                      duration={effectiveDuration}
                      onSeek={(s) => {
                        setCurrentTime(s)
                        seekTo(s)
                      }}
                      onStartChange={(s) => {
                        setStartSec(s)
                        seekTo(s)
                      }}
                      onEndChange={(s) => {
                        setEndSec(s)
                        seekTo(s)
                      }}
                    />
                    <div className="flex items-center gap-2 px-1 py-1.5">
                      <button type="button" onClick={togglePlay} className="rounded p-0.5 hover:bg-white/10">
                        {playing ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                      </button>
                      <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                        {fmt(currentTime)} / {fmt(effectiveDuration)}
                      </span>
                      <button
                        type="button"
                        onClick={toggleFullscreen}
                        className="ml-auto rounded p-0.5 hover:bg-white/10"
                      >
                        <Maximize className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Clip info + Trim section */}
              <div className={fullscreen ? 'px-6 pb-28' : 'px-0'}>
                {!fullscreen && (
                  <p className="mb-4 text-xs" style={{ color: 'var(--text-dim)' }}>
                    {clip.path} · {(clip.size / 1024 / 1024).toFixed(1)}MB · {effectiveDuration.toFixed(1)}s
                  </p>
                )}
                <div
                  className="rounded-lg p-3"
                  style={{ background: fullscreen ? 'rgba(255,255,255,0.06)' : 'rgba(113,113,122,0.08)' }}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <h3
                      className="flex items-center gap-1.5 text-sm font-medium"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      <Scissors className="h-3.5 w-3.5" />
                      {t('trim')}
                    </h3>
                    <span className="text-[11px] font-mono" style={{ color: 'var(--accent)' }}>
                      {fmt(trimDuration)}
                    </span>
                  </div>

                  {/* In/Out markers + hotkey hints */}
                  <div className="mb-3 flex items-center gap-3 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                    <span>
                      <kbd
                        className="rounded border px-1 py-0.5 font-mono text-[9px]"
                        style={{ borderColor: 'var(--border-medium)' }}
                      >
                        I
                      </kbd>{' '}
                      {fmt(startSec)}
                    </span>
                    <span>
                      <kbd
                        className="rounded border px-1 py-0.5 font-mono text-[9px]"
                        style={{ borderColor: 'var(--border-medium)' }}
                      >
                        O
                      </kbd>{' '}
                      {fmt(endSec)}
                    </span>
                    <span className="ml-auto text-[9px]" style={{ color: 'var(--text-muted)' }}>
                      arraste as alças ou use I/O
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={handleTrim}
                    disabled={trimming}
                    className="w-full rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
                    style={{ background: 'var(--accent)', color: '#fff' }}
                  >
                    {trimming ? t('trimming') : `${t('applyTrim')} (${fmt(trimDuration)})`}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Merge section — hidden in fullscreen */}
        {!fullscreen && (
          <div className="mb-5 rounded-lg p-3" style={{ background: 'rgba(113,113,122,0.08)' }}>
            <h3 className="mb-3 flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              <Combine className="h-3.5 w-3.5" />
              {t('merge')}
            </h3>
            <p className="mb-2 text-[10px]" style={{ color: 'var(--text-dim)' }}>
              {t('mergeHint')}
            </p>
            <div className="mb-2 max-h-32 space-y-1 overflow-y-auto">
              {mergeClips.map((p, i) => (
                <div
                  key={p}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px]"
                  style={{ background: 'rgba(0,0,0,0.2)' }}
                >
                  <span className="flex-1 truncate">{p}</span>
                  {mergeClips.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setMergeClips((prev) => prev.filter((_, idx) => idx !== i))}
                      className="rounded p-0.5 hover:bg-white/10"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={handleMerge}
              disabled={mergeClips.length < 2}
              className="w-full rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50"
              style={{ background: 'var(--accent)', color: '#fff' }}
            >
              {t('applyMerge')}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
