import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  execTracked: vi.fn(),
  psArgs: vi.fn((script: string) => ['-NoProfile', '-NonInteractive', '-Command', script]),
}))

vi.mock('./exec-utf8', () => ({
  execTracked: (...args: unknown[]) => mocks.execTracked(...args),
  psArgs: (...args: unknown[]) => mocks.psArgs(...(args as [string])),
}))

import {
  buildClassLookup,
  findGamesByWindowClass,
  getVisibleWindows,
  parseWindowProbe,
  type VisibleWindow,
} from './game-window-probe'

beforeEach(() => {
  vi.clearAllMocks()
})

function win(className: string, pid: number, processName = 'fivem.exe'): VisibleWindow {
  return { className, pid, processName }
}

describe('parseWindowProbe', () => {
  it('parses the tab-separated class/pid/image lines', () => {
    const out = ['grcWindow\t18260\tFiveM_b3258_GTAProcess.exe', 'Notepad\t15048\tNotepad.exe'].join('\n')
    expect(parseWindowProbe(out)).toEqual([
      win('grcWindow', 18260, 'FiveM_b3258_GTAProcess.exe'),
      win('Notepad', 15048, 'Notepad.exe'),
    ])
  })

  it('tolerates CRLF line endings and a trailing newline', () => {
    const out = 'grcWindow\t18260\tfivem.exe\r\nNotepad\t15048\tnotepad.exe\r\n'
    expect(parseWindowProbe(out)).toEqual([win('grcWindow', 18260), win('Notepad', 15048, 'notepad.exe')])
  })

  it('skips lines without a numeric pid', () => {
    const out = ['grcWindow\t18260\tfivem.exe', 'garbage', 'NoPid\tabc\tx.exe', ''].join('\n')
    expect(parseWindowProbe(out)).toEqual([win('grcWindow', 18260)])
  })

  it('drops lines whose pid is not positive', () => {
    expect(parseWindowProbe('grcWindow\t0\tfivem.exe\nGTA\t-1\tx.exe')).toEqual([])
  })

  it('drops a pid too large to be a real process id', () => {
    expect(parseWindowProbe('A\t99999999999999999999\tx.exe')).toEqual([])
  })

  it('drops lines with no class or no resolved process name', () => {
    expect(parseWindowProbe('\t18260\tfivem.exe')).toEqual([])
    expect(parseWindowProbe('grcWindow\t18260\t')).toEqual([])
  })

  it('returns an empty list for empty or non-string input', () => {
    expect(parseWindowProbe('')).toEqual([])
    expect(parseWindowProbe('   \n  \n')).toEqual([])
    expect(parseWindowProbe(undefined as unknown as string)).toEqual([])
  })
})

describe('buildClassLookup', () => {
  it('stores the class lowercased so lookups are case-insensitive', () => {
    const lookup = buildClassLookup([{ windowClass: 'grcWindow', displayName: 'FiveM (GTA V)' }])
    expect([...lookup.keys()]).toEqual(['grcwindow'])
    expect(lookup.get('grcwindow')).toBe('FiveM (GTA V)')
  })

  it('treats differently-cased classes as the same key', () => {
    const lookup = buildClassLookup([
      { windowClass: 'grcWindow', displayName: 'FiveM (GTA V)' },
      { windowClass: 'GRCWINDOW', displayName: 'Grand Theft Auto V' },
    ])
    expect(lookup.size).toBe(1)
    expect(lookup.get('grcwindow')).toBe('FiveM (GTA V)')
  })

  it('keeps the first entry when several games share a class', () => {
    const lookup = buildClassLookup([
      { windowClass: 'grcWindow', displayName: 'FiveM (GTA V)' },
      { windowClass: 'grcWindow', displayName: 'Grand Theft Auto V' },
    ])
    expect(lookup.get('grcwindow')).toBe('FiveM (GTA V)')
  })

  it('skips entries with a blank class or display name', () => {
    const lookup = buildClassLookup([
      { windowClass: '', displayName: 'Nothing' },
      { windowClass: '   ', displayName: 'Nothing' },
      { windowClass: 'Ok', displayName: '' },
    ])
    expect(lookup.size).toBe(0)
  })
})

describe('findGamesByWindowClass', () => {
  const lookup = buildClassLookup([
    { windowClass: 'grcWindow', displayName: 'FiveM (GTA V)' },
    { windowClass: 'sgaWindow', displayName: 'Red Dead Redemption 2' },
  ])

  it('resolves the real build-stamped process name plus a friendly name', () => {
    const found = findGamesByWindowClass([win('grcWindow', 18260, 'FiveM_b3258_GTAProcess.exe')], lookup)
    expect(found).toEqual([{ processName: 'FiveM_b3258_GTAProcess.exe', displayName: 'FiveM (GTA V)' }])
  })

  it('matches the class case-insensitively', () => {
    expect(findGamesByWindowClass([win('GRCWINDOW', 1)], lookup)[0]?.displayName).toBe('FiveM (GTA V)')
  })

  it('ignores classes that are not in the lookup', () => {
    const windows = [win('Notepad', 15048, 'notepad.exe'), win('Chrome_WidgetWin_1', 3260, 'chrome.exe')]
    expect(findGamesByWindowClass(windows, lookup)).toEqual([])
  })

  it('returns every match so the caller can pick the one still running', () => {
    const windows = [win('sgaWindow', 1, 'RDR2.exe'), win('grcWindow', 2, 'FiveM.exe')]
    expect(findGamesByWindowClass(windows, lookup).map((m) => m.processName)).toEqual(['RDR2.exe', 'FiveM.exe'])
  })

  it('returns an empty list for an empty window list or empty lookup', () => {
    expect(findGamesByWindowClass([], lookup)).toEqual([])
    expect(findGamesByWindowClass([win('grcWindow', 1)], new Map())).toEqual([])
  })
})

describe('getVisibleWindows', () => {
  it('runs the enumeration through a tracked PowerShell child and parses it', async () => {
    mocks.execTracked.mockResolvedValue({ stdout: 'grcWindow\t18260\tFiveM.exe\n', stderr: '' })
    const controller = new AbortController()

    const windows = await getVisibleWindows(controller.signal)

    expect(windows).toEqual([win('grcWindow', 18260, 'FiveM.exe')])
    expect(mocks.execTracked).toHaveBeenCalledTimes(1)
    const [file, args, opts] = mocks.execTracked.mock.calls[0] as [string, string[], Record<string, unknown>]
    expect(file).toBe('powershell.exe')
    expect(args).toContain('-NonInteractive')
    expect(opts.signal).toBe(controller.signal)
  })

  it('omits the signal when none is given', async () => {
    mocks.execTracked.mockResolvedValue({ stdout: '', stderr: '' })

    await getVisibleWindows()

    const opts = mocks.execTracked.mock.calls[0]?.[2] as Record<string, unknown> | undefined
    expect(opts).not.toHaveProperty('signal')
  })

  it('returns an empty list when the child fails', async () => {
    mocks.execTracked.mockRejectedValue(new Error('powershell blocked'))

    expect(await getVisibleWindows()).toEqual([])
  })

  it('returns an empty list when the child outputs nothing', async () => {
    mocks.execTracked.mockResolvedValue({ stdout: '', stderr: '' })

    expect(await getVisibleWindows()).toEqual([])
  })
})
