import { describe, expect, it, vi } from 'vitest'
import {
  createGpuFallback,
  GPU_CRASH_RELAUNCH_THRESHOLD,
  type GpuFallbackDecision,
  type GpuProcessGoneDetails,
  SOFTWARE_RENDER_FLAGS,
  STARTUP_GPU_CRASH_WINDOW_MS,
  shouldRelaunchInSoftwareMode,
  softwareRenderArgs,
} from './gpu-fallback'

const GPU_CRASH: GpuProcessGoneDetails = { type: 'GPU', reason: 'crashed', exitCode: 18 }

const BASE_DECISION: GpuFallbackDecision = {
  alreadyInSoftwareMode: false,
  uptimeMs: 1_000,
  gpuCrashCount: 1,
  isPackaged: true,
  relaunchBlocked: false,
}

function decide(details: Partial<GpuProcessGoneDetails> = {}, decision: Partial<GpuFallbackDecision> = {}): boolean {
  return shouldRelaunchInSoftwareMode({ ...GPU_CRASH, ...details }, { ...BASE_DECISION, ...decision })
}

describe('shouldRelaunchInSoftwareMode', () => {
  it('relaunches when the GPU process dies during startup (black-screen scenario)', () => {
    expect(decide()).toBe(true)
  })

  it('ignores processes that are not the GPU process', () => {
    expect(decide({ type: 'Utility' })).toBe(false)
    expect(decide({ type: 'Zygote' })).toBe(false)
  })

  it('ignores a clean exit — that is a normal shutdown, not a failure', () => {
    expect(decide({ reason: 'clean-exit' })).toBe(false)
  })

  it('never relaunches in dev: electron-vite owns the process and the dev server would die', () => {
    expect(decide({}, { isPackaged: false })).toBe(false)
  })

  it('does not loop when this process is already in software mode', () => {
    expect(decide({}, { alreadyInSoftwareMode: true })).toBe(false)
  })

  it('does not relaunch twice, nor while the app is quitting', () => {
    expect(decide({}, { relaunchBlocked: true })).toBe(false)
  })

  it('tolerates a single late crash: Chromium restarts the GPU process by itself', () => {
    expect(decide({}, { uptimeMs: STARTUP_GPU_CRASH_WINDOW_MS + 1 })).toBe(false)
  })

  it('relaunches once a second late crash proves the GPU process is not recovering', () => {
    expect(
      decide(
        {},
        {
          uptimeMs: STARTUP_GPU_CRASH_WINDOW_MS + 1,
          gpuCrashCount: GPU_CRASH_RELAUNCH_THRESHOLD,
        },
      ),
    ).toBe(true)
  })

  it('treats the startup window boundary as inclusive', () => {
    expect(decide({}, { uptimeMs: STARTUP_GPU_CRASH_WINDOW_MS })).toBe(true)
    expect(decide({}, { uptimeMs: STARTUP_GPU_CRASH_WINDOW_MS + 1 })).toBe(false)
  })
})

describe('softwareRenderArgs', () => {
  it('drops argv[0] (the executable) and appends the software flags', () => {
    expect(softwareRenderArgs(['C:\\App\\DiNho.exe', '--startup'])).toEqual(['--startup', ...SOFTWARE_RENDER_FLAGS])
  })

  it('keeps app arguments and does not mutate the input', () => {
    const argv = ['C:\\App\\DiNho.exe']
    expect(softwareRenderArgs(argv)).toEqual([...SOFTWARE_RENDER_FLAGS])
    expect(argv).toEqual(['C:\\App\\DiNho.exe'])
  })
})

function makeFallback(overrides: { argv?: string[]; isPackaged?: boolean } = {}) {
  const relaunch = vi.fn<(args: string[]) => void>()
  const quit = vi.fn<() => void>()
  const log = vi.fn<(message: string) => void>()
  const now = vi.fn<() => number>(() => 0)

  const fallback = createGpuFallback({
    argv: overrides.argv ?? ['C:\\App\\DiNho.exe'],
    isPackaged: overrides.isPackaged ?? true,
    now,
    relaunch,
    quit,
    log,
  })

  return { fallback, relaunch, quit, log, now }
}

describe('createGpuFallback', () => {
  it('relaunches in software mode and quits after an early GPU crash', () => {
    const { fallback, relaunch, quit, log } = makeFallback()

    fallback.handleChildProcessGone(GPU_CRASH)

    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(relaunch).toHaveBeenCalledWith([...SOFTWARE_RENDER_FLAGS])
    expect(quit).toHaveBeenCalledTimes(1)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('relaunching'))
  })

  it('never schedules a second relaunch', () => {
    const { fallback, relaunch, quit } = makeFallback()

    fallback.handleChildProcessGone(GPU_CRASH)
    fallback.handleChildProcessGone(GPU_CRASH)

    expect(relaunch).toHaveBeenCalledTimes(1)
    expect(quit).toHaveBeenCalledTimes(1)
  })

  it('keeps hardware acceleration on a single late crash', () => {
    const { fallback, relaunch, quit, log, now } = makeFallback()
    now.mockReturnValue(STARTUP_GPU_CRASH_WINDOW_MS + 1)

    fallback.handleChildProcessGone(GPU_CRASH)

    expect(relaunch).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('keeping hardware acceleration'))
  })

  it('counts late crashes and relaunches on the second one', () => {
    const { fallback, relaunch, now } = makeFallback()
    now.mockReturnValue(STARTUP_GPU_CRASH_WINDOW_MS + 1)

    fallback.handleChildProcessGone(GPU_CRASH)
    expect(relaunch).not.toHaveBeenCalled()

    fallback.handleChildProcessGone(GPU_CRASH)
    expect(relaunch).toHaveBeenCalledTimes(1)
  })

  it('ignores non-GPU child processes entirely', () => {
    const { fallback, relaunch, log } = makeFallback()

    fallback.handleChildProcessGone({ type: 'Utility', reason: 'crashed', exitCode: 1 })

    expect(relaunch).not.toHaveBeenCalled()
    expect(log).not.toHaveBeenCalled()
  })

  it('does nothing while the app is shutting down', () => {
    const { fallback, relaunch, quit } = makeFallback()

    fallback.markQuitting()
    fallback.handleChildProcessGone(GPU_CRASH)

    expect(relaunch).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('does not relaunch when the process is already running with --disable-gpu', () => {
    const { fallback, relaunch } = makeFallback({ argv: ['C:\\App\\DiNho.exe', '--disable-gpu'] })

    fallback.handleChildProcessGone(GPU_CRASH)

    expect(relaunch).not.toHaveBeenCalled()
  })

  it('does not relaunch in dev builds', () => {
    const { fallback, relaunch } = makeFallback({ isPackaged: false })

    fallback.handleChildProcessGone(GPU_CRASH)

    expect(relaunch).not.toHaveBeenCalled()
  })
})
