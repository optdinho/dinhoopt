import { existsSync, statSync } from 'node:fs'
import { execNativeUtf8 } from '../exec-utf8'

export function execReg(
  args: string[],
  opts?: { timeout?: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return execNativeUtf8('reg', args, opts)
}

export const SAFE_TASK_PATH_RE = /^[\\\p{L}\p{N}\s\-._(){},]+$/u

export function splitTaskPath(fullPath: string): { path: string; name: string } | null {
  const normalized = fullPath.replace(/\//g, '\\')
  if (!SAFE_TASK_PATH_RE.test(normalized)) return null
  const lastSlash = normalized.lastIndexOf('\\')
  if (lastSlash >= 0) {
    return {
      path: normalized.substring(0, lastSlash + 1),
      name: normalized.substring(lastSlash + 1),
    }
  }
  return { path: '\\', name: normalized }
}

export function expandEnvVars(path: string): string {
  return path
    .replace(/%SystemRoot%/gi, process.env.WINDIR || 'C:\\Windows')
    .replace(/%ProgramFiles%/gi, process.env.PROGRAMFILES || 'C:\\Program Files')
    .replace(/%ProgramFiles\(x86\)%/gi, process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)')
    .replace(/%ProgramData%/gi, process.env.PROGRAMDATA || 'C:\\ProgramData')
    .replace(/%CommonProgramFiles%/gi, process.env.COMMONPROGRAMFILES || 'C:\\Program Files\\Common Files')
    .replace(/%USERPROFILE%/gi, process.env.USERPROFILE || '')
    .replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || '')
    .replace(/%APPDATA%/gi, process.env.APPDATA || '')
}

export function extractExePath(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const quotedMatch = trimmed.match(/^"([^"]+)"/)
  if (quotedMatch) return quotedMatch[1]?.trim() ?? ''
  if (!trimmed.includes(' ')) return trimmed
  const splitPoints: number[] = []
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === ' ') splitPoints.push(i)
  }
  splitPoints.push(trimmed.length)
  for (const pos of splitPoints) {
    const candidate = trimmed.substring(0, pos)
    if (candidate) {
      try {
        const s = statSync(candidate)
        if (s.isFile()) return candidate
      } catch {
        /* doesn't exist or inaccessible */
      }
    }
  }
  const exeExtRe = /\.(exe|dll|sys|cmd|bat|com|msc|cpl|scr)$/i
  for (let i = splitPoints.length - 1; i >= 0; i--) {
    const candidate = trimmed.substring(0, splitPoints[i])
    if (exeExtRe.test(candidate)) return candidate
  }
  return trimmed.substring(0, splitPoints[0])
}

export async function clsidExists(clsid: string, signal?: AbortSignal): Promise<boolean> {
  try {
    await execReg(['query', `HKCR\\CLSID\\${clsid}`], { timeout: 5000, ...(signal ? { signal } : {}) })
    return true
  } catch {
    /* not in native view */
  }
  try {
    await execReg(['query', `HKCR\\WOW6432Node\\CLSID\\${clsid}`], { timeout: 5000, ...(signal ? { signal } : {}) })
    return true
  } catch {
    /* not in WOW64 view either */
  }
  return false
}

export async function findMissingClsidDll(clsid: string, signal?: AbortSignal): Promise<string | 'no-inproc' | null> {
  const prefixes = [`HKCR\\CLSID\\${clsid}`, `HKCR\\WOW6432Node\\CLSID\\${clsid}`]
  let foundAnyServer = false
  let firstMissingDll: string | null = null
  for (const prefix of prefixes) {
    try {
      const { stdout } = await execReg(['query', `${prefix}\\InprocServer32`], {
        timeout: 5000,
        ...(signal ? { signal } : {}),
      })
      foundAnyServer = true
      const dllMatch = stdout.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
      if (dllMatch) {
        const dllPath = (dllMatch[1] ?? '').trim().replace(/"/g, '')
        if (dllPath?.includes('\\') && !dllPath.startsWith('%')) {
          if (existsSync(dllPath)) return null
          if (!firstMissingDll) firstMissingDll = dllPath
        }
      } else {
        return null
      }
    } catch {
      /* No InprocServer32 in this view */
    }
    try {
      await execReg(['query', `${prefix}\\LocalServer32`], { timeout: 5000, ...(signal ? { signal } : {}) })
      return null
    } catch {
      /* No LocalServer32 in this view either */
    }
  }
  if (firstMissingDll) return firstMissingDll
  if (!foundAnyServer) return 'no-inproc'
  return null
}

export function stripRegHeader(content: string): string {
  return content.replace(/^﻿?Windows Registry Editor Version 5\.00\r?\n\r?\n/, '')
}
