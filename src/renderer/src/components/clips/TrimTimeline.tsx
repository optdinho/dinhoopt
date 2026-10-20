import { useCallback, useEffect, useRef, useState } from 'react'

export const fmt = (s: number) => {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${sec.toString().padStart(2, '0')}`
}

export function TrimTimeline({
  currentTime,
  startSec,
  endSec,
  duration,
  ariaLabel,
  startLabel,
  endLabel,
  onSeek,
  onStartChange,
  onEndChange,
}: {
  currentTime: number
  startSec: number
  endSec: number
  duration: number
  ariaLabel: string
  startLabel: string
  endLabel: string
  onSeek: (s: number) => void
  onStartChange: (s: number) => void
  onEndChange: (s: number) => void
}) {
  const trackRef = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<'seek' | 'start' | 'end' | null>(null)

  // Half the handle width (w-4 = 16px). Insetting the track by this much keeps
  // the edge handles fully inside the timeline box instead of overflowing it.
  const TRACK_INSET_PX = 8

  const adjustStart = (delta: number) => {
    onStartChange(Math.max(0, Math.min(endSec - 0.1, startSec + delta)))
  }

  const adjustEnd = (delta: number) => {
    onEndChange(Math.max(startSec + 0.1, Math.min(duration, endSec + delta)))
  }

  const posFromClient = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect()
      if (!rect) return 0
      return Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration))
    },
    [duration],
  )

  // Handle grab threshold in pixels — the previous seconds-based threshold
  // (< 1s) was sub-pixel at clip lengths >= 120s, making the visible handles
  // ungrabbable (clicks registered as seek instead of drag).
  const HANDLE_GRAB_PX = 12

  const handleMouseDown = (e: React.MouseEvent) => {
    const rect = trackRef.current?.getBoundingClientRect()
    if (!rect || rect.width === 0) return
    const s = posFromClient(e.clientX)
    const x = e.clientX - rect.left
    const toPx = (sec: number) => (sec / duration) * rect.width
    const distStart = Math.abs(x - toPx(startSec))
    const distEnd = Math.abs(x - toPx(endSec))
    const distCur = Math.abs(x - toPx(currentTime))
    if (distStart <= HANDLE_GRAB_PX && distStart <= distEnd && distStart <= distCur) setDragging('start')
    else if (distEnd <= HANDLE_GRAB_PX && distEnd <= distCur) setDragging('end')
    else {
      setDragging('seek')
      onSeek(s)
    }
  }

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

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      let next = currentTime
      if (e.key === 'ArrowRight') next = currentTime + 1
      else if (e.key === 'ArrowLeft') next = currentTime - 1
      else if (e.key === 'Home') next = 0
      else if (e.key === 'End') next = duration
      else return
      e.preventDefault()
      onSeek(Math.max(0, Math.min(duration, next)))
    },
    [currentTime, duration, onSeek],
  )

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
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={duration}
      aria-valuenow={Math.round(currentTime)}
      aria-valuetext={fmt(currentTime)}
      className="relative h-8 cursor-pointer select-none"
      style={{ touchAction: 'none' }}
      tabIndex={0}
      onMouseDown={handleMouseDown}
      onKeyDown={onKeyDown}
    >
      {/* Inset track: absolute handlers at 0%/100% stay within this box */}
      <div
        ref={trackRef}
        data-testid="trim-track"
        className="absolute inset-y-0"
        style={{ left: TRACK_INSET_PX, right: TRACK_INSET_PX }}
      >
        {/* Track background */}
        <div
          className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ background: 'rgba(255,255,255,0.12)' }}
        />

        {/* Selected region highlight */}
        <div
          data-testid="trim-region"
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
          role="slider"
          aria-label={startLabel}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.round(startSec)}
          aria-valuetext={fmt(startSec)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              e.stopPropagation()
              adjustStart(1)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              e.stopPropagation()
              adjustStart(-1)
            }
          }}
          className="absolute top-1/2 z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize rounded-full border-2"
          style={{
            left: `${pct(startSec)}%`,
            borderColor: 'var(--accent)',
            background: dragging === 'start' ? 'var(--accent)' : '#111318',
          }}
        />

        {/* End handle */}
        <div
          data-testid="trim-end-handle"
          role="slider"
          aria-label={endLabel}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={Math.round(endSec)}
          aria-valuetext={fmt(endSec)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') {
              e.preventDefault()
              e.stopPropagation()
              adjustEnd(1)
            } else if (e.key === 'ArrowLeft') {
              e.preventDefault()
              e.stopPropagation()
              adjustEnd(-1)
            }
          }}
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
    </div>
  )
}
