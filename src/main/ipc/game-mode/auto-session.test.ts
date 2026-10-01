import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  logger: { info: vi.fn(), warning: vi.fn(), error: vi.fn(), success: vi.fn(), debug: vi.fn() },
}))

vi.mock('../../services/logger.service', () => ({ getLogger: () => state.logger }))
vi.mock('../clips-engine-connection', () => ({
  ensureClipCaptureStarted: vi.fn(async () => ({ success: true })),
  stopClipCapture: vi.fn(async () => ({ success: true })),
  stopEngineProcess: vi.fn(),
}))

import { ensureClipCaptureStarted, stopClipCapture, stopEngineProcess } from '../clips-engine-connection'
import {
  armGameExitGrace,
  cancelGameExitGrace,
  GAME_EXIT_GRACE_MS,
  isExitGracePending,
  isSessionRecording,
  resetAutoSession,
  startAutoRecording,
  stopAutoRecording,
} from './auto-session'

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  resetAutoSession()
})

afterEach(() => {
  vi.useRealTimers()
})

// ─── startAutoRecording ─────────────────────────────────────
describe('startAutoRecording', () => {
  it('starts capture and marks the session as recording', async () => {
    await startAutoRecording()
    expect(ensureClipCaptureStarted).toHaveBeenCalledTimes(1)
    expect(isSessionRecording()).toBe(true)
  })

  it('logs success and keeps the session recording', async () => {
    await startAutoRecording()
    expect(state.logger.success).toHaveBeenCalledWith('game-mode', expect.stringContaining('recording'))
    expect(isSessionRecording()).toBe(true)
  })

  it('logs the error and does not mark the session as recording when the start fails', async () => {
    vi.mocked(ensureClipCaptureStarted).mockResolvedValueOnce({ success: false, error: 'Engine not running' })
    await startAutoRecording()
    expect(state.logger.error).toHaveBeenCalledWith('game-mode', expect.stringContaining('Engine not running'))
    expect(isSessionRecording()).toBe(false)
  })

  it('does not throw when the engine layer rejects', async () => {
    vi.mocked(ensureClipCaptureStarted).mockRejectedValueOnce(new Error('pipe exploded'))
    await expect(startAutoRecording()).resolves.toBeUndefined()
    expect(isSessionRecording()).toBe(false)
  })
})

// ─── stopAutoRecording ──────────────────────────────────────
describe('stopAutoRecording', () => {
  it('stops capture and the engine for a session it started', async () => {
    await startAutoRecording()
    await stopAutoRecording()
    expect(stopClipCapture).toHaveBeenCalledTimes(1)
    expect(stopEngineProcess).toHaveBeenCalledTimes(1)
    expect(isSessionRecording()).toBe(false)
  })

  it('leaves a recording it did not start alone', async () => {
    await stopAutoRecording()
    expect(stopClipCapture).not.toHaveBeenCalled()
    expect(stopEngineProcess).not.toHaveBeenCalled()
  })

  it('is a no-op when nothing was ever started', async () => {
    await stopAutoRecording()
    expect(stopClipCapture).not.toHaveBeenCalled()
    expect(stopEngineProcess).not.toHaveBeenCalled()
  })

  it('stops only once for repeated calls', async () => {
    await startAutoRecording()
    await stopAutoRecording()
    await stopAutoRecording()
    expect(stopClipCapture).toHaveBeenCalledTimes(1)
  })

  it('still stops the engine when stopCapture fails, and logs it', async () => {
    await startAutoRecording()
    vi.mocked(stopClipCapture).mockResolvedValueOnce({ success: false, error: 'busy' })
    await stopAutoRecording()
    expect(state.logger.warning).toHaveBeenCalledWith('game-mode', expect.stringContaining('busy'))
    expect(stopEngineProcess).toHaveBeenCalledTimes(1)
    expect(isSessionRecording()).toBe(false)
  })

  it('does not throw when the engine layer rejects', async () => {
    await startAutoRecording()
    vi.mocked(stopClipCapture).mockRejectedValueOnce(new Error('nope'))
    await expect(stopAutoRecording()).resolves.toBeUndefined()
    expect(isSessionRecording()).toBe(false)
  })
})

// ─── armGameExitGrace ───────────────────────────────────────
describe('armGameExitGrace', () => {
  it('defaults to a five minute grace period', () => {
    expect(GAME_EXIT_GRACE_MS).toBe(5 * 60 * 1000)
  })

  it('does not run the callback before the grace period elapses', () => {
    const onElapsed = vi.fn(async () => {})
    armGameExitGrace({ onElapsed, isGameAbsent: () => true })
    vi.advanceTimersByTime(GAME_EXIT_GRACE_MS - 1000)
    expect(onElapsed).not.toHaveBeenCalled()
    expect(isExitGracePending()).toBe(true)
  })

  it('runs the callback once the grace period elapses', async () => {
    const onElapsed = vi.fn(async () => {})
    armGameExitGrace({ onElapsed, isGameAbsent: () => true })
    vi.advanceTimersByTime(GAME_EXIT_GRACE_MS)
    await vi.waitFor(() => expect(onElapsed).toHaveBeenCalledTimes(1))
    expect(isExitGracePending()).toBe(false)
  })

  it('skips the callback when the game came back before the deadline', async () => {
    const onElapsed = vi.fn(async () => {})
    armGameExitGrace({ onElapsed, isGameAbsent: () => false })
    vi.advanceTimersByTime(GAME_EXIT_GRACE_MS)
    await vi.waitFor(() => expect(state.logger.info).toHaveBeenCalled())
    expect(onElapsed).not.toHaveBeenCalled()
  })

  it('re-arming replaces the previous timer instead of stacking', async () => {
    const onElapsed = vi.fn(async () => {})
    armGameExitGrace({ onElapsed, isGameAbsent: () => true })
    vi.advanceTimersByTime(GAME_EXIT_GRACE_MS - 1000)
    armGameExitGrace({ onElapsed, isGameAbsent: () => true })
    vi.advanceTimersByTime(GAME_EXIT_GRACE_MS - 1000)
    expect(onElapsed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1000)
    await vi.waitFor(() => expect(onElapsed).toHaveBeenCalledTimes(1))
  })

  it('accepts a custom grace duration', async () => {
    const onElapsed = vi.fn(async () => {})
    armGameExitGrace({ onElapsed, isGameAbsent: () => true, graceMs: 1000 })
    vi.advanceTimersByTime(999)
    expect(onElapsed).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    await vi.waitFor(() => expect(onElapsed).toHaveBeenCalledTimes(1))
  })

  it('logs the scheduled delay in seconds', () => {
    armGameExitGrace({ onElapsed: vi.fn(async () => {}), isGameAbsent: () => true })
    expect(state.logger.info).toHaveBeenCalledWith('game-mode', expect.stringContaining('300s'))
  })
})

// ─── cancelGameExitGrace ────────────────────────────────────
describe('cancelGameExitGrace', () => {
  it('clears a pending timer', async () => {
    const onElapsed = vi.fn(async () => {})
    armGameExitGrace({ onElapsed, isGameAbsent: () => true })
    cancelGameExitGrace()
    expect(isExitGracePending()).toBe(false)
    vi.advanceTimersByTime(GAME_EXIT_GRACE_MS * 2)
    expect(onElapsed).not.toHaveBeenCalled()
  })

  it('is safe when no timer is pending', () => {
    expect(() => cancelGameExitGrace()).not.toThrow()
    expect(isExitGracePending()).toBe(false)
  })
})

// ─── resetAutoSession ───────────────────────────────────────
describe('resetAutoSession', () => {
  it('clears both the grace timer and the recording flag', async () => {
    await startAutoRecording()
    armGameExitGrace({ onElapsed: vi.fn(async () => {}), isGameAbsent: () => true })
    resetAutoSession()
    expect(isExitGracePending()).toBe(false)
    expect(isSessionRecording()).toBe(false)
  })
})
