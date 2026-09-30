import { describe, expect, it } from 'vitest'
import { type ClipEncodeProgress, createProgressParser, formatEta } from './ffmpeg-progress'

/** Builds a realistic `-progress pipe:2` block for the given output time (seconds). */
function block(outTimeSec: number, speed: number | null, done = false): string {
  const us = Math.round(outTimeSec * 1_000_000)
  return [
    'frame=1234',
    'fps= 60.0',
    `bitrate= 1234.5kbits/s`,
    'total_size=987654',
    `out_time_us=${us}`,
    // ffmpeg's out_time_ms is a known quirk: it carries MICROSECONDS too.
    // The parser must never treat this field as milliseconds.
    `out_time_ms=${us}`,
    `out_time=${fmtClock(outTimeSec)}`,
    'drop_frames=0',
    ...(speed === null ? [] : [`speed=${speed.toFixed(1)}x`]),
    `progress=${done ? 'end' : 'continue'}`,
    '',
  ].join('\n')
}

function fmtClock(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`
}

describe('createProgressParser', () => {
  it('converts out_time_us into a percentage of the total duration', () => {
    const parser = createProgressParser(10)
    const snapshot = parser.push(block(5, 12))
    expect(snapshot?.percent).toBe(50)
    expect(snapshot?.outTimeSeconds).toBe(5)
  })

  it('uses out_time_us, never out_time_ms, to avoid ffmpeg microsecond quirk', () => {
    const parser = createProgressParser(10)
    // out_time_ms=5000000 here really means 5 seconds. A parser reading it as
    // milliseconds would report 5000000ms -> clamped to 100%.
    const snapshot = parser.push(block(5, 12))
    expect(snapshot?.percent).toBe(50)
  })

  it('clamps the percentage into [0, 100]', () => {
    expect(createProgressParser(10).push(block(20, 5))?.percent).toBe(100)
    expect(createProgressParser(10).push(block(-3, 5))?.percent).toBe(0)
  })

  it('derives the ETA from the ffmpeg speed factor', () => {
    // 10s total, 4s done, 2.0x speed -> 6s remaining / 2.0 = 3s left
    const snapshot = createProgressParser(10).push(block(4, 2))
    expect(snapshot?.etaSeconds).toBe(3)
  })

  it('reports no ETA while the speed factor is still unknown', () => {
    const snapshot = createProgressParser(10).push(block(4, null))
    expect(snapshot?.etaSeconds).toBeNull()
  })

  it('reports no ETA for a zero or unusable speed', () => {
    expect(createProgressParser(10).push(block(4, 0))?.etaSeconds).toBeNull()
    expect(createProgressParser(10).push(block(4, -1))?.etaSeconds).toBeNull()
  })

  it('reports an ETA of 0 once the output is complete', () => {
    const snapshot = createProgressParser(10).push(block(10, 8, true))
    expect(snapshot?.etaSeconds).toBe(0)
  })

  it('marks the block as done on progress=end', () => {
    expect(createProgressParser(10).push(block(10, 8, true))?.done).toBe(true)
    expect(createProgressParser(10).push(block(4, 8))?.done).toBe(false)
  })

  it('reassembles a block that was split across two chunks', () => {
    const parser = createProgressParser(10)
    const full = block(5, 12)
    const cut = Math.floor(full.length / 2)
    expect(parser.push(full.slice(0, cut))).toBeNull()
    const snapshot = parser.push(full.slice(cut))
    expect(snapshot?.percent).toBe(50)
  })

  it('uses the freshest block when several arrive in a single chunk', () => {
    const parser = createProgressParser(10)
    // Only the newest state is reported: intermediate blocks would be dropped
    // by the caller's throttling anyway, and forwarding them floods the IPC.
    const snapshot = parser.push(block(2, 4) + block(6, 4) + block(9, 4))
    expect(snapshot?.percent).toBe(90)
    expect(snapshot?.outTimeSeconds).toBe(9)
  })

  it('ignores ffmpeg log lines that are not part of a progress block', () => {
    const parser = createProgressParser(10)
    const noisy = ['[libx264 @ 0000] using SAR=1/1', 'Error opening output file broken.mp4.', block(5, 12)].join('\n')
    expect(parser.push(noisy)?.percent).toBe(50)
  })

  it('handles CRLF line endings', () => {
    const parser = createProgressParser(10)
    expect(parser.push(block(5, 12).replace(/\n/g, '\r\n'))?.percent).toBe(50)
  })

  it('tolerates an N/A output time reported before the first frame', () => {
    const parser = createProgressParser(10)
    const partial = [
      'frame=0',
      'out_time_us=N/A',
      'out_time=00:00:00.000000',
      'speed=0.0x',
      'progress=continue',
      '',
    ].join('\n')
    const snapshot = parser.push(partial)
    expect(snapshot?.outTimeSeconds).toBe(0)
    expect(snapshot?.percent).toBe(0)
  })

  it('returns null when a chunk contains no complete block yet', () => {
    const parser = createProgressParser(10)
    expect(parser.push('frame=1\nfps=60\n')).toBeNull()
  })

  it('exposes the raw speed factor', () => {
    expect(createProgressParser(10).push(block(5, 12.5))?.speed).toBe(12.5)
  })

  it('never reports a decreasing percentage', () => {
    const parser = createProgressParser(10)
    const a = parser.push(block(6, 10))
    const b = parser.push(block(4, 10))
    expect(b?.percent).toBeGreaterThanOrEqual(a?.percent ?? 0)
  })
})

describe('formatEta', () => {
  it('formats sub-minute ETAs in seconds', () => {
    expect(formatEta(45)).toBe('45s')
  })

  it('formats minutes and seconds', () => {
    expect(formatEta(83)).toBe('1m 23s')
  })

  it('formats hours', () => {
    expect(formatEta(3 * 3600 + 5 * 60)).toBe('3h 05m')
  })

  it('returns null for an unknown or finished ETA', () => {
    expect(formatEta(null)).toBeNull()
    expect(formatEta(0)).toBeNull()
  })

  it('never renders negative time', () => {
    expect(formatEta(-5)).toBeNull()
  })
})

describe('ClipEncodeProgress shape', () => {
  it('carries everything the renderer needs to draw the bar', () => {
    const snapshot = createProgressParser(10).push(block(5, 12)) as ClipEncodeProgress
    expect(Object.keys(snapshot).sort()).toEqual(['done', 'etaSeconds', 'outTimeSeconds', 'percent', 'speed'])
  })
})
