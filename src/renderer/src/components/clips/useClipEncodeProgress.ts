import type { ClipEncodeProgressEvent } from '@shared/types'
import { useCallback, useEffect, useRef, useState } from 'react'

export type ClipEncodeJob = { kind: 'trim'; clipPath: string } | { kind: 'merge'; clipPaths: string[] }

export interface ClipEncodeProgressState {
  running: boolean
  percent: number
  etaSeconds: number | null
  speed: number | null
  /** True until an event tells us how much work is left (cold duration cache). */
  indeterminate: boolean
  start: (job: ClipEncodeJob) => void
  stop: () => void
  cancel: () => Promise<{ success: boolean; error?: string } | undefined>
}

const IDLE: Omit<ClipEncodeProgressState, 'start' | 'stop' | 'cancel'> = {
  running: false,
  percent: 0,
  etaSeconds: null,
  speed: null,
  indeterminate: true,
}

/**
 * Subscribes to the ffmpeg progress broadcasts for a single running clip encode.
 *
 * Main resolves the clip path to an absolute one before deriving the job key, so
 * the renderer cannot predict it. It therefore adopts the key of the first event
 * that arrives for the kind it started and ignores everything else, which also
 * discards late updates from a job that already finished.
 */
export function useClipEncodeProgress(): ClipEncodeProgressState {
  const [state, setState] = useState(IDLE)
  const jobRef = useRef<ClipEncodeJob | null>(null)
  const jobKeyRef = useRef<string | null>(null)

  useEffect(() => {
    const onEvent =
      (kind: ClipEncodeJob['kind']) =>
      (event: ClipEncodeProgressEvent): void => {
        const job = jobRef.current
        if (!job || job.kind !== kind) return

        if (jobKeyRef.current === null) jobKeyRef.current = event.jobKey
        if (event.jobKey !== jobKeyRef.current) return

        setState({
          running: true,
          percent: event.percent,
          etaSeconds: event.etaSeconds,
          speed: event.speed,
          indeterminate: event.totalSeconds <= 0,
        })
      }

    const unsubscribeTrim = window.dinho?.clipsOnTrimProgress?.(onEvent('trim'))
    const unsubscribeMerge = window.dinho?.clipsOnMergeProgress?.(onEvent('merge'))
    return () => {
      unsubscribeTrim?.()
      unsubscribeMerge?.()
    }
  }, [])

  const start = useCallback((job: ClipEncodeJob) => {
    jobRef.current = job
    jobKeyRef.current = null
    setState({ ...IDLE, running: true })
  }, [])

  const stop = useCallback(() => {
    jobRef.current = null
    jobKeyRef.current = null
    setState(IDLE)
  }, [])

  const cancel = useCallback(async () => {
    const job = jobRef.current
    if (!job) return undefined
    return job.kind === 'trim'
      ? window.dinho?.clipsTrimCancel(job.clipPath)
      : window.dinho?.clipsMergeCancel(job.clipPaths)
  }, [])

  return { ...state, start, stop, cancel }
}
