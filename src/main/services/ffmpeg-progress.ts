/**
 * Parser for ffmpeg's machine-readable progress stream.
 *
 * ffmpeg emits this when called with `-progress pipe:2`. The blocks land on the
 * same fd as the log, but they are plain `key=value` lines terminated by a
 * `progress=continue` (or `progress=end`) line, so they are trivial to separate
 * from human-readable log output.
 *
 * Two details that are easy to get wrong and are guarded by tests:
 *
 *  1. `out_time_ms` is a long-standing ffmpeg misnomer - it carries
 *     MICROSECONDS, identical to `out_time_us`. Reading it as milliseconds
 *     inflates the progress by 1000x. Only `out_time_us` is trusted here.
 *  2. Blocks are split across arbitrary stream chunk boundaries, so the parser
 *     keeps a buffer and only consumes up to the last `progress=` line.
 *
 * The parser is intentionally pure: no I/O, no clock, no globals. It maps a
 * chunk of text to zero or more immutable snapshots.
 */

/** A single progress reading, ready to be forwarded to the renderer. */
export interface ClipEncodeProgress {
  /** Output position reached so far, in seconds (relative to the output start). */
  outTimeSeconds: number
  /** Completion percentage, clamped to [0, 100]. */
  percent: number
  /** Estimated seconds remaining, or null while it cannot be computed. */
  etaSeconds: number | null
  /** ffmpeg's speed factor (e.g. 12.4 for "12.4x"), or null when unknown. */
  speed: number | null
  /** True once ffmpeg reported `progress=end`. */
  done: boolean
}

/** Fields of one ffmpeg progress block, as raw strings. */
type ProgressFields = Record<string, string>

export interface ProgressParser {
  /**
   * Feeds a chunk of the progress stream and returns one snapshot per complete
   * block found, or null when the chunk held no complete block.
   *
   * When a chunk contains several blocks, only the last one is returned: it
   * already reflects the most recent state, and intermediate values would be
   * dropped by the caller's throttling anyway.
   */
  push(chunk: string): ClipEncodeProgress | null
}

const US_PER_SECOND = 1_000_000

/** Parses a finite number, returning null for "N/A", "" and anything non-numeric. */
function num(raw: string | undefined): number | null {
  if (raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === 'N/A') return null
  const parsed = Number.parseFloat(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Reads the `speed=12.4x` factor. */
function parseSpeed(fields: ProgressFields): number | null {
  const raw = fields.speed
  if (raw === undefined) return null
  const value = num(raw.replace(/x$/i, ''))
  return value === null || value <= 0 ? null : value
}

/** Reads the output position in seconds, trusting only out_time_us. */
function parseOutTimeSeconds(fields: ProgressFields): number {
  const us = num(fields.out_time_us)
  if (us === null) return 0
  return us / US_PER_SECOND
}

/** Completion percentage of a known total duration, clamped to [0, 100]. */
function toPercent(outTimeSeconds: number, totalSeconds: number): number {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return 0
  return Math.min(100, Math.max(0, (outTimeSeconds / totalSeconds) * 100))
}

/**
 * Seconds remaining, from ffmpeg's speed factor: the remaining output has to be
 * produced at `speed` times real time, so remaining/speed is the wall-clock
 * wait. Null when the speed is unknown or when there is nothing left to do but
 * the block has not been finalised yet.
 */
function estimateEta(outTimeSeconds: number, totalSeconds: number, speed: number | null): number | null {
  if (speed === null || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return null
  const remaining = totalSeconds - outTimeSeconds
  if (remaining <= 0) return 0
  return remaining / speed
}

/**
 * Creates a parser for a job whose output is expected to last `totalSeconds`.
 *
 * Two kinds of state survive between chunks, because stream chunks split
 * anywhere: the raw text tail after the last newline, and the fields of a block
 * that has started but not yet been terminated by its `progress=` line.
 *
 * Snapshots are monotonic: the highest percentage seen so far is never
 * lowered, because an out-of-order block must not make the bar jump backwards.
 */
export function createProgressParser(totalSeconds: number): ProgressParser {
  let buffer = ''
  let pending: ProgressFields = {}
  let pendingHasContent = false
  let highestPercent = 0

  return {
    push(chunk: string): ClipEncodeProgress | null {
      if (chunk === '') return null

      const combined = buffer + chunk
      const lastNewline = combined.lastIndexOf('\n')
      if (lastNewline === -1) {
        // Not even one complete line yet.
        buffer = combined
        return null
      }

      // Only the text up to the last newline is safe to parse; the tail is a
      // partial line. Slicing at the newline index (rather than summing line
      // lengths) keeps this correct for CRLF endings too.
      const complete = combined.slice(0, lastNewline + 1)
      buffer = combined.slice(lastNewline + 1)

      let latest: ProgressFields | null = null
      for (const line of complete.split(/\r?\n/)) {
        const separator = line.indexOf('=')
        if (separator <= 0) continue // blank line, or a "[libx264 @ 0] ..." log line

        const key = line.slice(0, separator)
        pending[key] = line.slice(separator + 1)
        pendingHasContent = true

        if (key === 'progress') {
          if (pendingHasContent) latest = pending
          pending = {}
          pendingHasContent = false
        }
      }

      if (latest === null) return null

      const fields = latest
      const outTimeSeconds = parseOutTimeSeconds(fields)
      const speed = parseSpeed(fields)
      const done = fields.progress === 'end'

      const percent = Math.max(highestPercent, toPercent(outTimeSeconds, totalSeconds))
      highestPercent = percent

      return {
        outTimeSeconds,
        percent,
        etaSeconds: estimateEta(outTimeSeconds, totalSeconds, speed),
        speed,
        done,
      }
    },
  }
}

export { formatEta } from '@shared/format-eta'
