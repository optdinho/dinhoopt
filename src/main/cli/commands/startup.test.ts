import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  toggle: vi.fn(),
  del: vi.fn(),
  boot: vi.fn(),
  out: vi.fn(),
  log: vi.fn(),
  notFound: vi.fn(),
  usage: vi.fn(),
}))

vi.mock('../../ipc/startup-manager.ipc', () => ({
  listStartupItems: mocks.list,
  toggleStartupItem: mocks.toggle,
  deleteStartupItem: mocks.del,
  getBootTrace: mocks.boot,
}))

vi.mock('../utils', () => ({
  cliLog: mocks.log,
  cliNotFound: mocks.notFound,
  cliOut: mocks.out,
  cliUsage: mocks.usage,
}))

import type { CliContext } from '../types'
import { handleStartup } from './startup'

const ctx: CliContext = { json: true, verbosity: 'normal' }

describe('handleStartup delete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes the file path (not the folder) for startup-folder items', async () => {
    const folderItem = {
      id: 'abc',
      name: 'App.lnk',
      displayName: 'App',
      command: 'C:\\Users\\Test\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup\\App.lnk',
      location: 'C:\\Users\\Test\\AppData\\Roaming\\Microsoft\\Windows\\Start Menu\\Programs\\Startup',
      source: 'startup-folder' as const,
      enabled: true,
      impact: 'low' as const,
      publisher: 'App Inc',
    }
    mocks.list.mockResolvedValue([folderItem])
    mocks.del.mockResolvedValue(true)

    const code = await handleStartup(['delete', 'App.lnk'], ctx)

    expect(mocks.del).toHaveBeenCalledWith('App.lnk', folderItem.command, 'startup-folder')
    expect(code).toBeUndefined()
  })

  it('passes the registry location for registry items', async () => {
    const regItem = {
      id: 'def',
      name: 'Discord',
      displayName: 'Discord',
      command: '"C:\\Discord\\Discord.exe"',
      location: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
      source: 'registry-hkcu' as const,
      enabled: true,
      impact: 'medium' as const,
      publisher: 'Discord Inc',
    }
    mocks.list.mockResolvedValue([regItem])
    mocks.del.mockResolvedValue(true)

    await handleStartup(['delete', 'Discord'], ctx)

    expect(mocks.del).toHaveBeenCalledWith('Discord', regItem.location, 'registry-hkcu')
  })

  it('returns NOTHING_FOUND when the item does not exist', async () => {
    mocks.list.mockResolvedValue([])

    const code = await handleStartup(['delete', 'Ghost'], ctx)

    expect(mocks.del).not.toHaveBeenCalled()
    expect(code).toBe(5)
    expect(mocks.notFound).toHaveBeenCalled()
  })
})
