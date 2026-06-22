import path from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const execFileSyncMock = vi.fn()
const systemRoot = process.env.SystemRoot || 'C:\\Windows'
const expectedWhoami = path.join(systemRoot, 'System32', 'whoami.exe')

vi.mock('child_process', () => ({
  execFileSync: execFileSyncMock,
}))

describe('win32 elevation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns true when whoami /groups contains admin SID', async () => {
    execFileSyncMock.mockReturnValue('Mandatory Label\\High Mandatory Level                    S-1-16-12288')

    const { createWin32Elevation } = await import('./elevation')
    const elevation = createWin32Elevation()
    const result = elevation.isAdmin()

    expect(result).toBe(true)
    expect(execFileSyncMock).toHaveBeenCalledWith(expectedWhoami, ['/groups'], {
      encoding: 'utf-8',
      stdio: 'pipe',
      timeout: 5000,
    })
  })

  it('returns false when whoami /groups lacks admin SID', async () => {
    execFileSyncMock.mockReturnValue('Mandatory Label\\Medium Mandatory Level                   S-1-16-8192')

    const { createWin32Elevation } = await import('./elevation')
    const elevation = createWin32Elevation()
    const result = elevation.isAdmin()

    expect(result).toBe(false)
  })

  it('returns false when whoami throws (process not admin)', async () => {
    execFileSyncMock.mockImplementation(() => {
      throw new Error('Access denied')
    })

    const { createWin32Elevation } = await import('./elevation')
    const elevation = createWin32Elevation()
    const result = elevation.isAdmin()

    expect(result).toBe(false)
  })

  it('caches the result within TTL window', async () => {
    execFileSyncMock.mockReturnValue('Mandatory Label\\High Mandatory Level                    S-1-16-12288')

    const { createWin32Elevation } = await import('./elevation')
    const elevation = createWin32Elevation()

    elevation.isAdmin()
    elevation.isAdmin()
    elevation.isAdmin()

    expect(execFileSyncMock).toHaveBeenCalledTimes(1)
  })
})
