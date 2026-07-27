import { createHash } from 'node:crypto'
import type {
  ContextMenuEntry,
  ContextMenuHive,
  ContextMenuScanResult,
  ContextMenuSource,
  ContextMenuStatus,
} from '@shared/types'
import { getLogger } from '../../services/logger.service'
import { execReg } from '../../services/registry-utils'
import type { ClsidInfo, ParsedKey } from './context-menu-constants'
import {
  CLSID_SAFELIST,
  type DisabledStateFile,
  readDisabledState,
  SCAN_ROOTS,
  type ScanRoot,
  SOURCE_PATTERNS,
  VERB_SAFELIST,
  writeDisabledState,
} from './context-menu-constants'

export { SCAN_ROOTS, type ScanRoot }

// ── Cancellable scan state ──────────────────────────────────────────

const _scanAbort: AbortController | null = null

// Session-scoped scan results so apply looks entries up by trusted in-memory
// state rather than renderer-supplied paths.
export const scanSession = new Map<string, ContextMenuEntry>()

// ── Pure helpers (exported for tests) ───────────────────────────────

const HIVE_ALIASES: Record<string, ContextMenuHive | null> = {
  HKEY_CLASSES_ROOT: 'HKCR',
  HKCR: 'HKCR',
  HKEY_CURRENT_USER: 'HKCU',
  HKCU: 'HKCU',
}

/** Convert long-form `HKEY_CLASSES_ROOT\…` to short `HKCR\…`. */
export function normalizeKeyPath(raw: string): string {
  const idx = raw.indexOf('\\')
  if (idx < 0) return raw
  const head = raw.substring(0, idx)
  const rest = raw.substring(idx)
  const short = HIVE_ALIASES[head]
  return short ? short + rest : raw
}

/** Return everything before the final backslash. */
export function parentKeyOf(keyPath: string): string {
  const idx = keyPath.lastIndexOf('\\')
  return idx < 0 ? keyPath : keyPath.substring(0, idx)
}

/** The on-disk subkey name when an entry is in the given status. */
export function disabledNameFor(kind: string, originalName: string): string {
  return kind === 'handler' ? `-${originalName}` : originalName
}

/** A handler subkey whose name begins with `-` is disabled per Windows shellex rules. */
export function isDisabledHandlerName(name: string): boolean {
  return name.startsWith('-')
}

/** Match against VERB_SAFELIST — case-insensitive, whitespace-trimmed. */
export function isProtectedVerb(name: string): boolean {
  const normalized = name.trim().toLowerCase()
  return VERB_SAFELIST.includes(normalized)
}

/** Normalise braces/case before comparing against CLSID_SAFELIST. */
export function canonicalClsid(raw: string): string {
  let v = raw.trim()
  if (!v) return ''
  if (!v.startsWith('{')) v = `{${v}`
  if (!v.endsWith('}')) v = `${v}}`
  return v.toLowerCase()
}

export function isProtectedClsid(clsid: string): boolean {
  if (!clsid) return false
  const target = canonicalClsid(clsid)
  return CLSID_SAFELIST.some((c) => canonicalClsid(c) === target)
}

export const CLSID_RE = /^-?\{[0-9A-Fa-f-]+\}$/

/** Extract a CLSID from a string, returning canonical {GUID} form or null. */
export function extractClsid(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.match(/\{[0-9A-Fa-f-]{30,}\}/)
  return m ? m[0] : null
}

/** Source inference — first matching pattern wins. */
export function inferSource(dllPath: string | null, keyName: string): ContextMenuSource {
  const haystack = `${dllPath ?? ''}|${keyName}`
  for (const { pattern, source } of SOURCE_PATTERNS) {
    if (pattern.test(haystack)) return source
  }
  return 'Unknown'
}

/**
 * Parse `reg query <root> /s` output into a list of keys with their values.
 */
export function parseRegQueryBlocks(stdout: string): ParsedKey[] {
  const out: ParsedKey[] = []
  const lines = stdout.replace(/\r/g, '').split('\n')
  let current: ParsedKey | null = null

  for (const line of lines) {
    if (!line.trim()) {
      if (current) {
        out.push(current)
        current = null
      }
      continue
    }
    if (!line.startsWith(' ') && !line.startsWith('\t')) {
      if (current) out.push(current)
      const headStr = line.trim()
      if (/^HKEY_/i.test(headStr)) {
        current = { keyPath: normalizeKeyPath(headStr), values: {} }
      } else {
        current = null
      }
      continue
    }
    if (!current) continue
    const m = line.match(/^\s{4}(.+?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/)
    if (m) {
      const [, name, type, data] = m
      current.values[name!] = { type: type!, data: data! }
    }
  }
  if (current) out.push(current)
  return out
}

// ── CLSID resolution (per-scan cache) ───────────────────────────────

async function resolveClsid(clsid: string, cache: Map<string, ClsidInfo>, signal: AbortSignal): Promise<ClsidInfo> {
  const canonical = canonicalClsid(clsid)
  const hit = cache.get(canonical)
  if (hit) return hit

  const info: ClsidInfo = { friendlyName: null, dllPath: null }
  try {
    const { stdout } = await execReg(['query', `HKCR\\CLSID\\${canonical}`, '/ve'], { timeout: 4000, signal })
    const m = stdout.match(/\([^)]+\)\s+REG_SZ\s+(.*)$/m)
    if (m) info.friendlyName = m[1]!.trim() || null
  } catch {
    /* missing key */
  }
  try {
    const { stdout } = await execReg(['query', `HKCR\\CLSID\\${canonical}\\InprocServer32`, '/ve'], {
      timeout: 4000,
      signal,
    })
    const m = stdout.match(/\([^)]+\)\s+REG_(?:SZ|EXPAND_SZ)\s+(.*)$/m)
    if (m) info.dllPath = m[1]!.trim().replace(/^"+|"+$/g, '') || null
  } catch {
    /* missing key */
  }

  cache.set(canonical, info)
  return info
}

// ── Scan internals ──────────────────────────────────────────────────

function makeId(keyPath: string, name: string): string {
  return createHash('sha1').update(`${keyPath}|${name}`).digest('hex').substring(0, 16)
}

async function queryRoot(rootPath: string, signal: AbortSignal): Promise<ParsedKey[]> {
  try {
    const { stdout } = await execReg(['query', rootPath, '/s'], { timeout: 15000, signal })
    return parseRegQueryBlocks(stdout)
  } catch {
    return []
  }
}

/** Strip "@C:\…\foo.dll,-123" resource references that show up in MUIVerb. */
function stripMuiResource(s: string): string {
  if (!s) return ''
  if (s.startsWith('@')) return ''
  return s
}

async function scanShellVerbs(
  root: ScanRoot,
  signal: AbortSignal,
  disabled: DisabledStateFile,
): Promise<ContextMenuEntry[]> {
  const blocks = await queryRoot(root.shellPath, signal)
  if (blocks.length === 0) return []

  const rootKey = normalizeKeyPath(root.shellPath)
  const verbBlocks = new Map<string, ParsedKey>()
  const commandBlocks = new Map<string, ParsedKey>()

  for (const block of blocks) {
    const rel = block.keyPath.startsWith(`${rootKey}\\`) ? block.keyPath.substring(rootKey.length + 1) : null
    if (!rel) continue
    const parts = rel.split('\\')
    if (parts.length === 1) {
      verbBlocks.set(block.keyPath, block)
    } else if (parts.length === 2 && parts[1]!.toLowerCase() === 'command') {
      const verbKey = parentKeyOf(block.keyPath)
      commandBlocks.set(verbKey, block)
    }
  }

  const out: ContextMenuEntry[] = []
  for (const [keyPath, block] of verbBlocks) {
    const name = keyPath.substring(keyPath.lastIndexOf('\\') + 1)
    if (!name) continue
    const status: ContextMenuStatus = 'LegacyDisable' in block.values ? 'disabled' : 'enabled'
    const command = commandBlocks.get(keyPath)?.values['(Default)']?.data?.trim() || null
    const muiVerb = block.values.MUIVerb?.data?.trim() || ''
    const defaultLabel = block.values['(Default)']?.data?.trim() || ''
    const displayName = stripMuiResource(muiVerb) || defaultLabel || name
    const id = makeId(keyPath, name)
    const protectedFlag = isProtectedVerb(name)
    const requiresAdmin = root.hive === 'HKCR'

    out.push({
      id,
      kind: 'verb',
      keyPath,
      name,
      displayName,
      scope: root.scope,
      hive: root.hive,
      clsid: null,
      dllPath: null,
      command,
      source: inferSource(command, name),
      status,
      protected: protectedFlag,
      requiresAdmin,
      selected: false,
    })

    if (status === 'enabled' && disabled.entries[id]) {
      delete disabled.entries[id]
    }
  }
  return out
}

async function scanShellHandlers(
  root: ScanRoot,
  signal: AbortSignal,
  clsidCache: Map<string, ClsidInfo>,
  disabled: DisabledStateFile,
): Promise<ContextMenuEntry[]> {
  const blocks = await queryRoot(root.shellexPath, signal)
  if (blocks.length === 0) return []

  const rootKey = normalizeKeyPath(root.shellexPath)
  const out: ContextMenuEntry[] = []

  for (const block of blocks) {
    if (!block.keyPath.startsWith(`${rootKey}\\`)) continue
    const rel = block.keyPath.substring(rootKey.length + 1)
    if (rel.includes('\\')) continue
    const onDiskName = rel
    const isDisabled = isDisabledHandlerName(onDiskName)
    const logicalName = isDisabled ? onDiskName.substring(1) : onDiskName

    const subkeyClsid = CLSID_RE.test(onDiskName) ? extractClsid(onDiskName) : null
    const defaultClsid = extractClsid(block.values['(Default)']?.data ?? null)
    const clsid = subkeyClsid ?? defaultClsid

    const canonicalKey = `${parentKeyOf(block.keyPath)}\\${logicalName}`
    const id = makeId(block.keyPath, onDiskName)

    let info: ClsidInfo = { friendlyName: null, dllPath: null }
    if (clsid) {
      try {
        info = await resolveClsid(clsid, clsidCache, signal)
      } catch {
        /* skip */
      }
    }
    const friendly = stripMuiResource(info.friendlyName?.trim() || '')
    const displayName = friendly || logicalName

    const protectedFlag = clsid ? isProtectedClsid(clsid) : false
    const requiresAdmin = root.hive === 'HKCR'
    const status: ContextMenuStatus = isDisabled ? 'disabled' : 'enabled'

    out.push({
      id,
      kind: 'handler',
      keyPath: canonicalKey,
      name: logicalName,
      displayName,
      scope: root.scope,
      hive: root.hive,
      clsid: clsid,
      dllPath: info.dllPath,
      command: null,
      source: inferSource(info.dllPath, logicalName),
      status,
      protected: protectedFlag,
      requiresAdmin,
      selected: false,
    })

    if (status === 'enabled' && disabled.entries[id]) {
      delete disabled.entries[id]
    }
  }
  return out
}

// ── Public scan API ─────────────────────────────────────────────────

export async function scanContextMenu(
  signal: AbortSignal,
  onProgress?: (current: number, total: number, label: string) => void,
): Promise<ContextMenuScanResult> {
  if (process.platform !== 'win32') {
    return { entries: [], scanDuration: 0, scanned: 0 }
  }
  const start = Date.now()
  getLogger().info('context-menu-cleaner', 'Starting context menu scan')
  const clsidCache = new Map<string, ClsidInfo>()
  const disabled = readDisabledState()
  const all: ContextMenuEntry[] = []
  let scanned = 0
  const total = SCAN_ROOTS.length

  for (let i = 0; i < SCAN_ROOTS.length; i++) {
    if (signal.aborted) break
    const root = SCAN_ROOTS[i]!
    onProgress?.(i, total, `${root.hive} ${root.scope}`)
    try {
      const verbs = await scanShellVerbs(root, signal, disabled)
      const handlers = await scanShellHandlers(root, signal, clsidCache, disabled)
      all.push(...verbs, ...handlers)
      scanned += verbs.length + handlers.length
    } catch {
      // skip root on error (permission denied, abort, etc.)
    }
  }

  try {
    writeDisabledState(disabled)
  } catch {
    /* skip */
  }

  getLogger().success('context-menu-cleaner', `Scan complete: ${all.length} entries in ${Date.now() - start}ms`)
  return { entries: all, scanDuration: Date.now() - start, scanned }
}
