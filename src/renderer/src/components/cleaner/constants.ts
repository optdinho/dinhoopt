import type { ContextMenuEntry, ContextMenuScope, ContextMenuSource, ContextMenuStatus } from '@shared/types'

export const WIN11_NOTICE_KEY = 'kudu.contextMenu.win11Notice.dismissed'

export const UNKNOWN_BINARY = '(unknown)'

export const SOURCE_PILL_COLOR: Record<ContextMenuSource, { bg: string; text: string }> = {
  '7-Zip': { bg: 'rgba(59,130,246,0.10)', text: '#60a5fa' },
  WinRAR: { bg: 'rgba(168,85,247,0.10)', text: '#c084fc' },
  OneDrive: { bg: 'rgba(14,165,233,0.10)', text: '#38bdf8' },
  'Notepad++': { bg: 'rgba(34,197,94,0.10)', text: '#4ade80' },
  VSCode: { bg: 'rgba(99,102,241,0.10)', text: '#818cf8' },
  Defender: { bg: 'rgba(34,197,94,0.10)', text: '#22c55e' },
  Git: { bg: 'rgba(244,114,22,0.10)', text: '#fb923c' },
  Dropbox: { bg: 'rgba(59,130,246,0.10)', text: '#60a5fa' },
  'Google Drive': { bg: 'rgba(245,158,11,0.10)', text: '#fbbf24' },
  PowerToys: { bg: 'rgba(168,85,247,0.10)', text: '#c084fc' },
  Microsoft: { bg: 'rgba(20,184,166,0.10)', text: '#2dd4bf' },
  Windows: { bg: 'rgba(20,184,166,0.10)', text: '#2dd4bf' },
  Unknown: { bg: 'var(--bg-hover)', text: 'var(--text-muted)' },
}

export const HIDDEN_SOURCES: ReadonlySet<ContextMenuSource> = new Set(['Microsoft', 'Windows', 'Defender'])

const GROUP_PALETTE: ReadonlyArray<{ bg: string; text: string }> = [
  { bg: 'rgba(59,130,246,0.10)', text: '#60a5fa' },
  { bg: 'rgba(168,85,247,0.10)', text: '#c084fc' },
  { bg: 'rgba(14,165,233,0.10)', text: '#38bdf8' },
  { bg: 'rgba(34,197,94,0.10)', text: '#4ade80' },
  { bg: 'rgba(99,102,241,0.10)', text: '#818cf8' },
  { bg: 'rgba(244,114,22,0.10)', text: '#fb923c' },
  { bg: 'rgba(245,158,11,0.10)', text: '#fbbf24' },
  { bg: 'rgba(20,184,166,0.10)', text: '#2dd4bf' },
]

export function colorForBinary(name: string): { bg: string; text: string } {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0
  return GROUP_PALETTE[hash % GROUP_PALETTE.length]!
}

export const SCOPE_LABEL_KEY: Record<ContextMenuScope, string> = {
  AllFiles: 'scopeAllFiles',
  Directory: 'scopeDirectory',
  DirectoryBackground: 'scopeDirectoryBackground',
  Folder: 'scopeFolder',
  Drive: 'scopeDrive',
  AllFilesystemObjects: 'scopeAllFilesystemObjects',
  ProgID: 'scopeProgID',
}

export function filterEntries(
  entries: ContextMenuEntry[],
  filters: {
    search: string
    scope: ContextMenuScope | 'all'
    source: ContextMenuSource | 'all'
    status: ContextMenuStatus | 'all'
  },
): ContextMenuEntry[] {
  const search = filters.search.trim().toLowerCase()
  return entries.filter((e) => {
    if (filters.scope !== 'all' && e.scope !== filters.scope) return false
    if (filters.source !== 'all' && e.source !== filters.source) return false
    if (filters.status !== 'all' && e.status !== filters.status) return false
    if (search) {
      const haystack = [e.displayName, e.name, e.command ?? '', e.dllPath ?? '', e.clsid ?? ''].join(' ').toLowerCase()
      if (!haystack.includes(search)) return false
    }
    return true
  })
}

export function binaryNameOf(entry: ContextMenuEntry): string {
  if (entry.command) {
    const m = entry.command.match(/^\s*"([^"]+)"|^\s*(\S+)/)
    const path = (m?.[1] ?? m?.[2] ?? '').trim()
    const base = path.split(/[\\/]/).pop()?.trim()
    if (base) return base
  }
  if (entry.dllPath) {
    const base = entry.dllPath.split(/[\\/]/).pop()?.trim()
    if (base) return base
  }
  return entry.name || UNKNOWN_BINARY
}

export function groupByBinary(entries: ContextMenuEntry[]): { binary: string; entries: ContextMenuEntry[] }[] {
  const map = new Map<string, ContextMenuEntry[]>()
  for (const e of entries) {
    const key = binaryNameOf(e)
    const list = map.get(key) ?? []
    list.push(e)
    map.set(key, list)
  }
  return Array.from(map.entries())
    .map(([binary, list]) => ({ binary, entries: list }))
    .sort((a, b) => a.binary.localeCompare(b.binary))
}
