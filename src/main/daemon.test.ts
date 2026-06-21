import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockInitAutoUpdater = vi.fn()
const mockGetVersion = vi.fn(() => '1.0.0')
const mockExit = vi.fn()

vi.mock('electron', () => ({
  app: {
    getVersion: () => mockGetVersion(),
    exit: (...args: unknown[]) => mockExit(...args),
  },
}))

vi.mock('./services/auto-updater', () => ({
  initAutoUpdater: (...args: unknown[]) => mockInitAutoUpdater(...args),
}))

import { runDaemon } from './daemon'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('runDaemon', () => {
  it('starts auto-updater', async () => {
    const promise = runDaemon()

    expect(mockInitAutoUpdater).toHaveBeenCalledWith({ daemon: true })
    await promise
  })

  it('registers SIGTERM and SIGINT handlers that call app.exit', () => {
    const onSpy = vi.spyOn(process, 'on')
    runDaemon()

    const sigtermHandler = onSpy.mock.calls.find(([e]) => e === 'SIGTERM')?.[1] as () => void
    const sigintHandler = onSpy.mock.calls.find(([e]) => e === 'SIGINT')?.[1] as () => void

    expect(sigtermHandler).toBeDefined()
    expect(sigintHandler).toBeDefined()

    sigtermHandler()
    expect(mockExit).toHaveBeenCalledWith(0)

    sigintHandler()
    // Called again
    expect(mockExit).toHaveBeenCalledTimes(2)
  })
})
