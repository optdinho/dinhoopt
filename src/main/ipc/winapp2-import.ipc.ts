import type { Winapp2FileKey, Winapp2ParseResult, Winapp2Section } from '@shared/types'

const VAR_MAP: Record<string, string> = {
  '%AppData%': '${APPDATA}',
  '%LocalAppData%': '${LOCALAPPDATA}',
  '%ProgramFiles%': '${PROGRAMFILES}',
  '%ProgramFiles(x86)%': '${PROGRAMFILES_X86}',
  '%WinDir%': '${WINDIR}',
  '%SystemDrive%': '${SYSTEMDRIVE}',
  '%UserProfile%': '${HOME}',
  '%Documents%': '${HOME}\\Documents',
  '%Temp%': '${LOCALAPPDATA}\\Temp',
}

const VAR_PATTERN = /%(AppData|LocalAppData|ProgramFiles(?:\(x86\))?|WinDir|SystemDrive|UserProfile|Documents|Temp)%/g

export function convertWinapp2Vars(input: string): string {
  return input.replace(VAR_PATTERN, (match) => VAR_MAP[match] || match)
}

function trimQuotes(value: string): string {
  return value.replace(/^"(.*)"$/, '$1').trim()
}

function parseBool(value: string): boolean {
  return value.trim().toLowerCase() === 'true'
}

function parseSectionName(line: string): { sectionName: string; suffix: '' | '*' | '%' | '!' | '?' } | null {
  const match = line.match(/^\[(.+?)([*%!?])?\]$/)
  if (!match) return null
  return { sectionName: match[1]!.trim(), suffix: (match[2] as '' | '*' | '%' | '!' | '?') || '' }
}

function parseFileKey(value: string): Winapp2FileKey {
  const parts = value.split('|')
  const path = convertWinapp2Vars(parts[0]?.trim() ?? '')
  const fileMask = parts[1]?.trim() ?? '*.*'
  const flags = parts.slice(2).map((p) => p.trim().toUpperCase())
  return { path, fileMask, recurse: flags.includes('RECURSE'), removeSelf: flags.includes('REMOVESELF') }
}

export function parseWinapp2(content: string): Winapp2ParseResult {
  const sections: Winapp2Section[] = []
  const lines = content.replace(/\r\n/g, '\n').split('\n')

  let current: Winapp2Section | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith(';')) continue

    const header = parseSectionName(line)
    if (header) {
      const sec: Winapp2Section = {
        sectionName: header.sectionName,
        originalName: header.suffix ? `${header.sectionName}${header.suffix}` : header.sectionName,
        suffix: header.suffix,
        default: false,
        detect: [],
        detectFile: [],
        detectHklm: [],
        detectHkcu: [],
        detectHkcuSoftware: [],
        fileKeys: [],
        regKeys: [],
        warning: header.suffix === '*',
      }
      current = sec
      sections.push(current!)
      continue
    }

    if (!current) continue

    const eqIdx = line.indexOf('=')
    if (eqIdx === -1) continue

    const key = line.slice(0, eqIdx).trim()
    const value = trimQuotes(line.slice(eqIdx + 1).trim())

    if (key === 'LangSecRef') {
      current.langSecRef = Number(value)
    } else if (key === 'Default') {
      current.default = parseBool(value)
    } else if (key === 'Warn') {
      current.warning = parseBool(value)
    } else if (key === 'Detect') {
      current.detect.push(value)
    } else if (key === 'DetectFile') {
      current.detectFile.push(value)
    } else if (key === 'DetectHKLM') {
      current.detectHklm.push(value)
    } else if (key === 'DetectHKCU') {
      current.detectHkcu.push(value)
    } else if (key === 'DetectHKCUSoftware') {
      current.detectHkcuSoftware.push(value)
    } else if (key.startsWith('FileKey')) {
      current.fileKeys.push(parseFileKey(value))
    } else if (key.startsWith('RegKey')) {
      current.regKeys.push(value)
    }
  }

  return { sections, totalSections: sections.length }
}
