import type { ChildProcess } from 'node:child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  cancelAllClipJobs,
  cancelClipJob,
  clearClipJob,
  createProgressEmitter,
  isClipJobCancelled,
  PROGRESS_THROTTLE_MS,
  registerClipJob,
  runningClipJobCount,
  shouldEmitProgress,
} from './clip-encode-job'

function fakeProc() {
  return { kill: vi.fn() } as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> }
}

function block(outTimeSec: number, speed: number | null, done = false): string {
  const us = Math.round(outTimeSec * 1_000_000)
  return [
    `out_time_us=${us}`,
    ...(speed === null ? [] : [`speed=${speed.toFixed(1)}x`]),
    `progress=${done ? 'end' : 'continue'}`,
    '',
  ].join('\n')
}

describe('shouldEmitProgress', () => {
  const base = { nowMs: 10_000, lastSentAtMs: 0, lastPercent: -1, percent: 10, done: false }

  it('emits the first reading regardless of the throttle window', () => {
    expect(shouldEmitProgress({ ...base, lastSentAtMs: -Infinity })).toBe(true)
  })

  it('drops a reading that arrives inside the throttle window', () => {
    expect(shouldEmitProgress({ ...base, nowMs: PROGRESS_THROTTLE_MS - 1 })).toBe(false)
  })

  it('emits a reading once the throttle window has elapsed', () => {
    expect(shouldEmitProgress({ ...base, nowMs: PROGRESS_THROTTLE_MS })).toBe(true)
  })

  it('drops a reading whose percentage did not move, even after the window', () => {
    expect(shouldEmitProgress({ ...base, lastPercent: 10, nowMs: 99_999 })).toBe(false)
  })

  it('always emits the final reading, even inside the throttle window', () => {
    expect(shouldEmitProgress({ ...base, nowMs: 1, done: true })).toBe(true)
  })

  it('always emits when the job reaches 100 percent', () => {
    expect(shouldEmitProgress({ ...base, nowMs: 1, percent: 100 })).toBe(true)
  })
})

describe('createProgressEmitter', () => {
  it('forwards a parsed reading tagged with the job key and total', () => {
    const send = vi.fn()
    const emitter = createProgressEmitter('job-a', 10, send, () => 0)
    emitter.push(block(5, 12))
    expect(send).toHaveBeenCalledWith({
      jobKey: 'job-a',
      percent: 50,
      outTimeSeconds: 5,
      totalSeconds: 10,
      etaSeconds: 5 / 12,
      speed: 12,
      done: false,
    })
  })

  it('forwards nothing when a chunk has no complete block', () => {
    const send = vi.fn()
    createProgressEmitter('job-a', 10, send, () => 0).push('frame=1\n')
    expect(send).not.toHaveBeenCalled()
  })

  it('throttles bursts of readings down to one per window', () => {
    const send = vi.fn()
    let now = 0
    const emitter = createProgressEmitter('job-a', 100, send, () => now)
    emitter.push(block(10, 5))
    expect(send).toHaveBeenCalledTimes(1)
    for (const t of [1, 2, 3]) {
      now = t
      emitter.push(block(20 + t, 5))
    }
    expect(send).toHaveBeenCalledTimes(1)
    now = PROGRESS_THROTTLE_MS
    emitter.push(block(40, 5))
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('always delivers the last reading so the bar can settle at 100', () => {
    const send = vi.fn()
    let now = 0
    const emitter = createProgressEmitter('job-a', 10, send, () => now)
    emitter.push(block(5, 5))
    now = 1 // still inside the throttle window
    emitter.push(block(10, 5, true))
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.mock.calls[1]?.[0]).toMatchObject({ percent: 100, done: true })
  })

  it('emits a zero-percent reading when the total duration is unknown', () => {
    const send = vi.fn()
    createProgressEmitter('job-a', 0, send, () => 0).push(block(5, 5))
    // No total means no meaningful percentage, but the speed/eta still flow so
    // the UI can show it is working rather than silently doing nothing.
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ percent: 0, totalSeconds: 0 }))
  })
})

describe('clip job registry', () => {
  beforeEach(() => {
    cancelAllClipJobs()
  })

  it('reports a job as not cancelled before it is cancelled', () => {
    registerClipJob('a', fakeProc())
    expect(isClipJobCancelled('a')).toBe(false)
  })

  it('kills the process and flags the job when cancelled', () => {
    const proc = fakeProc()
    registerClipJob('a', proc)
    expect(cancelClipJob('a')).toBe(true)
    expect(proc.kill).toHaveBeenCalled()
    expect(isClipJobCancelled('a')).toBe(true)
  })

  it('returns false when cancelling an unknown job', () => {
    expect(cancelClipJob('missing')).toBe(false)
  })

  it('stops reporting a job as cancelled once it is cleared', () => {
    registerClipJob('a', fakeProc())
    cancelClipJob('a')
    clearClipJob('a')
    expect(isClipJobCancelled('a')).toBe(false)
  })

  it('keeps separate state per job key', () => {
    registerClipJob('a', fakeProc())
    registerClipJob('b', fakeProc())
    cancelClipJob('a')
    expect(isClipJobCancelled('a')).toBe(true)
    expect(isClipJobCancelled('b')).toBe(false)
  })

  it('kills every running job on shutdown', () => {
    const p1 = fakeProc()
    const p2 = fakeProc()
    registerClipJob('a', p1)
    registerClipJob('b', p2)
    expect(cancelAllClipJobs()).toBe(2)
    expect(p1.kill).toHaveBeenCalled()
    expect(p2.kill).toHaveBeenCalled()
  })

  it('reports no running jobs when the registry is empty', () => {
    expect(runningClipJobCount()).toBe(0)
  })

  it('counts a registered job even when it is already cancelled', () => {
    registerClipJob('a', fakeProc())
    cancelClipJob('a')
    expect(runningClipJobCount()).toBe(1)
  })

  it('counts every running job', () => {
    registerClipJob('a', fakeProc())
    registerClipJob('b', fakeProc())
    expect(runningClipJobCount()).toBe(2)
  })

  it('stops counting a job once it is cleared', () => {
    registerClipJob('a', fakeProc())
    clearClipJob('a')
    expect(runningClipJobCount()).toBe(0)
  })

  it('drops back to zero after a bulk cancel', () => {
    registerClipJob('a', fakeProc())
    registerClipJob('b', fakeProc())
    cancelAllClipJobs()
    expect(runningClipJobCount()).toBe(0)
  })
})
