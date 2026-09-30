import type { ChildProcess } from 'node:child_process'
import type { ClipEncodeProgressEvent } from '@shared/types/clips'
import { type ClipEncodeProgress, createProgressParser } from './ffmpeg-progress'

/**
 * Bookkeeping for the ffmpeg re-encodes started by the clip editor (trim and
 * merge): progress emission and cancellation.
 *
 * Progress is read from ffmpeg's `-progress pipe:2` stream, which shares fd 2
 * with the log. Because a re-encode of a long clip can run for the whole
 * 120s timeout, readings are throttled before crossing the IPC boundary: the
 * renderer only needs a few updates per second to animate a bar, and flooding
 * the channel would cost more than it is worth.
 */

/** Minimum gap between two forwarded progress readings. */
export const PROGRESS_THROTTLE_MS = 200

interface RunningJob {
  proc: ChildProcess
  cancelled: boolean
}

const runningJobs = new Map<string, RunningJob>()

/** Registers a started ffmpeg process so it can later be cancelled. */
export function registerClipJob(jobKey: string, proc: ChildProcess): void {
  runningJobs.set(jobKey, { proc, cancelled: false })
}

/** Forgets a job. Called once its process has exited, cancelled or not. */
export function clearClipJob(jobKey: string): void {
  runningJobs.delete(jobKey)
}

/**
 * True when the job was cancelled by the user. The caller must consult this
 * inside the ffmpeg completion callback, because a killed process also reports
 * an error and the two cases need different user-facing messages.
 */
export function isClipJobCancelled(jobKey: string): boolean {
  return runningJobs.get(jobKey)?.cancelled === true
}

/**
 * Cancels a running job: flags it and kills ffmpeg. Returns false when no such
 * job is running, so the caller can report "nothing to cancel".
 */
export function cancelClipJob(jobKey: string): boolean {
  const job = runningJobs.get(jobKey)
  if (!job) return false
  job.cancelled = true
  try {
    job.proc.kill()
  } catch {
    // The process may have exited between the lookup and the kill; the
    // completion callback still runs and reports the outcome.
  }
  return true
}

/** How many ffmpeg re-encodes are alive right now. */
export function runningClipJobCount(): number {
  return runningJobs.size
}

/** Kills every running job, e.g. on app quit. Returns how many were killed. */
export function cancelAllClipJobs(): number {
  const keys = Array.from(runningJobs.keys())
  let killed = 0
  for (const key of keys) if (cancelClipJob(key)) killed++
  runningJobs.clear()
  return killed
}

export interface ProgressEmitInput {
  nowMs: number
  lastSentAtMs: number
  lastPercent: number
  percent: number
  done: boolean
}

/**
 * Decides whether a reading is worth forwarding.
 *
 * The completion reading is never throttled, otherwise the bar could stall at
 * 97% for the last few hundred milliseconds and then jump - which reads as a
 * freeze. Mid-encode readings are dropped when they arrive too soon after the
 * previous one or when the percentage has not actually moved.
 */
export function shouldEmitProgress(input: ProgressEmitInput): boolean {
  if (input.done || input.percent >= 100) return true
  if (input.nowMs - input.lastSentAtMs < PROGRESS_THROTTLE_MS) return false
  return input.percent > input.lastPercent
}

export interface ProgressEmitter {
  /** Feeds raw ffmpeg stderr text; forwards a reading when one is due. */
  push(chunk: string): void
}

/**
 * Builds an emitter for one job. `now` is injectable so the throttle can be
 * tested without fake timers.
 */
export function createProgressEmitter(
  jobKey: string,
  totalSeconds: number,
  send: (event: ClipEncodeProgressEvent) => void,
  now: () => number = () => Date.now(),
): ProgressEmitter {
  const parser = createProgressParser(totalSeconds)
  let lastSentAtMs = Number.NEGATIVE_INFINITY
  let lastPercent = -1

  return {
    push(chunk: string): void {
      const snapshot = parser.push(chunk)
      if (!snapshot) return
      if (
        !shouldEmitProgress({ nowMs: now(), lastSentAtMs, lastPercent, percent: snapshot.percent, done: snapshot.done })
      )
        return

      lastSentAtMs = now()
      lastPercent = snapshot.percent
      send(toEvent(jobKey, totalSeconds, snapshot))
    },
  }
}

function toEvent(jobKey: string, totalSeconds: number, snapshot: ClipEncodeProgress): ClipEncodeProgressEvent {
  return {
    jobKey,
    percent: snapshot.percent,
    outTimeSeconds: snapshot.outTimeSeconds,
    totalSeconds,
    etaSeconds: snapshot.etaSeconds,
    speed: snapshot.speed,
    done: snapshot.done,
  }
}

/**
 * The ffmpeg argument that turns on the machine-readable progress stream.
 *
 * `pipe:2` is deliberate: the blocks go to fd 2, which `execFile` already
 * exposes as a readable stream, so progress costs no change of transport and
 * `-loglevel error` can stay as it is (the blocks bypass the log system
 * entirely). `-progress pipe:3` would be equally clean but `execFile` does not
 * expose fd 3.
 */
export const FFMPEG_PROGRESS_ARGS: readonly string[] = ['-progress', 'pipe:2']
