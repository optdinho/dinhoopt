import { randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RegistryEntry } from '@shared/types'
import { getBackupDir } from './backup-dir'
import { execFileAsync, execNativeUtf8, execTracked, psUtf8 } from './exec-utf8'
import { getSettings } from './settings-store'

/** Run reg.exe with UTF-8 code page so accented characters decode correctly */
async function execReg(
  args: string[],
  opts?: { timeout?: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return execNativeUtf8('reg', args, opts)
}

/** Validate that a task path contains only safe characters */
const SAFE_TASK_PATH_RE = /^[\\\p{L}\p{N}\s\-._(){},]+$/u

/** Split a full task path like "\\Folder\\Sub\\TaskName" into { path, name } for PowerShell */
function splitTaskPath(fullPath: string): { path: string; name: string } | null {
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

/** Expand common Windows environment variables in a registry path. */
function expandEnvVars(path: string): string {
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

/**
 * Extract the executable path from a command-line string, correctly
 * handling quoted paths with spaces and ignoring trailing arguments.
 */
function extractExePath(raw: string): string | null {
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

async function clsidExists(clsid: string, signal?: AbortSignal): Promise<boolean> {
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

async function findMissingClsidDll(clsid: string, signal?: AbortSignal): Promise<string | 'no-inproc' | null> {
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

export async function scanRegistry(signal?: AbortSignal): Promise<RegistryEntry[]> {
  const entries: RegistryEntry[] = []

  function checkAborted(): void {
    if (signal?.aborted) throw new Error('Operation cancelled')
  }

  // Scan for broken App Paths
  try {
    checkAborted()
    const { stdout } = await execReg(['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths', '/s'], {
      timeout: 15000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKLM\\[^\r\n]+)/m)
      const valMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
      if (valMatch) {
        const exePath = (valMatch[1] ?? '').trim().replace(/"/g, '')
        if (exePath && !existsSync(expandEnvVars(exePath))) {
          entries.push({
            id: randomUUID(),
            type: 'invalid',
            keyPath: keyMatch?.[1] || 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths',
            valueName: '(Default)',
            issue: `App path points to missing file: ${exePath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key' },
          })
        }
      }
    }
  } catch {
    /* Skip if reg query fails */
  }

  // Scan for broken SharedDLLs references
  checkAborted()
  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs', '/s'],
      { timeout: 15000, ...(signal ? { signal } : {}) },
    )
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_DWORD\s+/i)
      if (match) {
        const dllPath = match[1]!.trim()
        if (dllPath && dllPath.length > 3 && !existsSync(expandEnvVars(dllPath))) {
          entries.push({
            id: randomUUID(),
            type: 'broken',
            keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SharedDLLs',
            valueName: dllPath,
            issue: `Shared DLL reference missing: ${dllPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()
  const runKeys = [
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run',
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\RunOnce',
  ]
  for (const runKey of runKeys) {
    try {
      const { stdout } = await execReg(['query', runKey], { timeout: 10000, ...(signal ? { signal } : {}) })
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const match = line.match(/^\s+(\S+)\s+REG_SZ\s+(.+)/i)
        if (match) {
          const valueName = match[1]!.trim()
          const command = match[2]!.trim()
          const exePath = extractExePath(command)
          if (exePath) {
            if (exePath.includes('\\') && !existsSync(expandEnvVars(exePath))) {
              entries.push({
                id: randomUUID(),
                type: 'broken',
                keyPath: runKey,
                valueName,
                issue: `Startup entry points to missing file: ${exePath}`,
                risk: 'medium',
                selected: true,
                fix: { op: 'delete-value' },
              })
            }
          }
        }
      }
    } catch {
      /* Skip */
    }
  }

  checkAborted()
  try {
    const { stdout } = await execReg(
      ['query', 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts', '/s'],
      { timeout: 15000, ...(signal ? { signal } : {}) },
    )
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKCU\\[^\r\n]+\\OpenWithList)/m)
      const appMatch = block.match(/REG_SZ\s+(.+\.exe)/i)
      if (keyMatch && appMatch) {
        const appName = appMatch[1]!.trim()
        try {
          await execReg(['query', `HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${appName}`], {
            timeout: 5000,
            ...(signal ? { signal } : {}),
          })
        } catch {
          if (!appName.includes('\\') && !appName.includes('/')) {
            entries.push({
              id: randomUUID(),
              type: 'obsolete',
              keyPath: keyMatch[1]!,
              valueName: appName,
              issue: `File association references unregistered app: ${appName}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' },
            })
          }
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts', '/s'], {
      timeout: 15000,
      ...(signal ? { signal } : {}),
    })
    const winDir = process.env.WINDIR || 'C:\\Windows'
    const fontsDir = join(winDir, 'Fonts')
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?)\s+REG_SZ\s+(.+)/i)
      if (match) {
        const fontName = match[1]!.trim()
        let fontFile = match[2]!.trim()
        if (!fontFile.includes('\\') && !fontFile.includes('/')) {
          fontFile = join(fontsDir, fontFile)
        }
        if (fontFile && !existsSync(fontFile)) {
          entries.push({
            id: randomUUID(),
            type: 'invalid',
            keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
            valueName: fontName,
            issue: `Font file missing: ${fontFile}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKCU\\SOFTWARE\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache', '/s'],
      { timeout: 15000, ...(signal ? { signal } : {}) },
    )
    const muiKey = 'HKCU\\SOFTWARE\\Classes\\Local Settings\\Software\\Microsoft\\Windows\\Shell\\MuiCache'
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?\.exe(\.\w+))\s+REG_SZ\s+/i)
      if (match) {
        const fullValueName = match[1]!.trim()
        const exePath = fullValueName.replace(/\.\w+$/, '')
        if (exePath?.includes('\\') && !existsSync(expandEnvVars(exePath))) {
          entries.push({
            id: randomUUID(),
            type: 'obsolete',
            keyPath: muiKey,
            valueName: fullValueName,
            issue: `MUI cache references uninstalled program: ${exePath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const fwRulesKey =
      'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\FirewallRules'
    const { stdout } = await execReg(['query', fwRulesKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/REG_SZ\s+(.+)/i)
      if (match) {
        const ruleValue = match[1]!
        const appMatch = ruleValue.match(/App=([^|]+)/i)
        if (appMatch) {
          const appPath = appMatch[1]!.trim()
          if (appPath && !appPath.startsWith('%') && appPath.includes('\\') && !existsSync(appPath)) {
            const nameMatch = line.match(/^\s+(.+?)\s+REG_SZ/i)
            entries.push({
              id: randomUUID(),
              type: 'obsolete',
              keyPath: fwRulesKey,
              valueName: nameMatch?.[1]?.trim() || 'Unknown Rule',
              issue: `Firewall rule for missing program: ${appPath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-value' },
            })
          }
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()
  const shellExtKeys = [
    'HKCR\\*\\shellex\\ContextMenuHandlers',
    'HKCR\\Directory\\shellex\\ContextMenuHandlers',
    'HKCR\\Folder\\shellex\\ContextMenuHandlers',
  ]
  for (const shellKey of shellExtKeys) {
    try {
      const { stdout } = await execReg(['query', shellKey, '/s'], { timeout: 10000, ...(signal ? { signal } : {}) })
      const blocks = stdout.split(/\r?\n\r?\n/)
      for (const block of blocks) {
        const clsidMatch = block.match(/\(Default\)\s+REG_SZ\s+(\{[0-9A-Fa-f-]+\})/i)
        if (clsidMatch) {
          const clsid = clsidMatch[1]
          if (!clsid) continue
          const keyMatch = block.match(/^(HK[^\r\n]+)/m)
          if (!(await clsidExists(clsid, signal))) {
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: keyMatch?.[1]?.trim() || shellKey,
              valueName: clsid,
              issue: `Context menu handler references missing COM object: ${clsid}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' },
            })
          } else {
            const missingDll = await findMissingClsidDll(clsid, signal)
            if (missingDll) {
              entries.push({
                id: randomUUID(),
                type: 'broken',
                keyPath: keyMatch?.[1]?.trim() || shellKey,
                valueName: clsid,
                issue:
                  missingDll === 'no-inproc'
                    ? `Context menu handler has broken COM registration: ${clsid}`
                    : `Context menu handler DLL missing: ${missingDll}`,
                risk: 'medium',
                selected: true,
                fix: { op: 'delete-key' },
              })
            }
          }
        }
      }
    } catch {
      /* Skip */
    }
  }

  try {
    const installerKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Installer\\Folders'
    const { stdout } = await execReg(['query', installerKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?)\s+REG_SZ/i)
      if (match) {
        const folderPath = match[1]!.trim()
        if (folderPath && folderPath.length > 3 && !existsSync(expandEnvVars(folderPath))) {
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: installerKey,
            valueName: folderPath,
            issue: `Windows Installer references missing folder: ${folderPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()
  try {
    const { stdout } = await execReg(['query', 'HKCR\\CLSID', '/s', '/f', 'InprocServer32', '/k'], {
      timeout: 20000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    let comCount = 0
    for (const block of blocks) {
      if (comCount >= 50) break
      const keyMatch = block.match(/^(HKCR\\CLSID\\(\{[^}]+\})\\InprocServer32)/m)
      const dllMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
      if (keyMatch && dllMatch) {
        const dllPath = (dllMatch[1] ?? '').trim().replace(/"/g, '')
        if (dllPath?.includes('\\') && !dllPath.startsWith('%') && !existsSync(dllPath)) {
          const parentClsidKey = `HKCR\\CLSID\\${keyMatch[2]!}`
          entries.push({
            id: randomUUID(),
            type: 'broken',
            keyPath: keyMatch[1]!,
            valueName: '(Default)',
            issue: `COM object DLL missing: ${dllPath}`,
            risk: 'medium',
            selected: true,
            fix: { op: 'delete-key', key: parentClsidKey },
          })
          comCount++
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(['query', 'HKCR\\TypeLib', '/s', '/f', 'win32', '/k'], {
      timeout: 15000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    let tlbCount = 0
    for (const block of blocks) {
      if (tlbCount >= 30) break
      const keyMatch = block.match(/^(HKCR\\TypeLib\\(\{[^}]+\})[^\r\n]*)/m)
      const valMatch = block.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
      if (keyMatch && valMatch) {
        const tlbPath = (valMatch[1] ?? '').trim().replace(/"/g, '')
        if (tlbPath?.includes('\\') && !tlbPath.startsWith('%') && !existsSync(tlbPath)) {
          const parentTypeLibKey = `HKCR\\TypeLib\\${keyMatch[2]!}`
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: keyMatch[1]!,
            valueName: '(Default)',
            issue: `Type library file missing: ${tlbPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key', key: parentTypeLibKey },
          })
          tlbCount++
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const appCompatKeyLM = 'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
    const { stdout } = await execReg(['query', appCompatKeyLM, '/s'], { timeout: 10000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_SZ\s+/i)
      if (match) {
        const appPath = match[1]!.trim()
        if (appPath?.includes('\\') && !existsSync(expandEnvVars(appPath))) {
          entries.push({
            id: randomUUID(),
            type: 'obsolete',
            keyPath: appCompatKeyLM,
            valueName: appPath,
            issue: `Compatibility shim for uninstalled app: ${appPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const appCompatKeyCU = 'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers'
    const { stdout } = await execReg(['query', appCompatKeyCU, '/s'], { timeout: 10000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const match = line.match(/^\s+(.+?\.\w{2,4})\s+REG_SZ\s+/i)
      if (match) {
        const appPath = match[1]!.trim()
        if (appPath?.includes('\\') && !existsSync(expandEnvVars(appPath))) {
          entries.push({
            id: randomUUID(),
            type: 'obsolete',
            keyPath: appCompatKeyCU,
            valueName: appPath,
            issue: `Compatibility shim for uninstalled app: ${appPath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()

  try {
    const servicesKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Services'
    const { stdout } = await execReg(['query', servicesKey, '/s', '/f', 'ImagePath', '/v'], {
      timeout: 20000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    let svcCount = 0
    for (const block of blocks) {
      if (svcCount >= 40) break
      const fullKeyMatch = block.match(/^(HK[^\r\n]+)/m)
      if (!fullKeyMatch) continue
      const fullKey = fullKeyMatch[1]!.trim()
      const afterServices = fullKey.replace(/^.*\\Services\\/i, '')
      if (afterServices.includes('\\')) continue
      const svcName = afterServices
      const valMatch = block.match(/ImagePath\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
      if (valMatch) {
        const rawImagePath = (valMatch[1] ?? '').trim()
        let imagePath = extractExePath(rawImagePath)
        if (!imagePath) continue
        imagePath = expandEnvVars(imagePath)
        const lowerPath = imagePath.toLowerCase()
        if (
          lowerPath.startsWith('\\systemroot\\') ||
          lowerPath.startsWith('c:\\windows\\') ||
          lowerPath.includes('\\microsoft\\') ||
          lowerPath.includes('\\windows\\') ||
          imagePath.startsWith('\\??\\')
        )
          continue
        if (!imagePath.match(/^[A-Za-z]:\\/)) continue
        if (imagePath && !existsSync(imagePath)) {
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: fullKey,
            valueName: 'ImagePath',
            issue: `Service "${svcName}" points to missing executable: ${imagePath}`,
            risk: 'medium',
            selected: true,
            fix: { op: 'delete-key' },
          })
          svcCount++
        }
      }
    }
  } catch {
    /* Skip */
  }

  const uninstallKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  ]
  for (const uninstallKey of uninstallKeys) {
    try {
      const { stdout } = await execReg(['query', uninstallKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
      const blocks = stdout.split(/\r?\n\r?\n/)
      for (const block of blocks) {
        const keyMatch = block.match(/^(HK[^\r\n]+)/m)
        if (!keyMatch) continue
        const subKey = keyMatch[1]!
        if (subKey === uninstallKey) continue
        const installLocMatch = block.match(/InstallLocation\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
        const uninstallStrMatch = block.match(/UninstallString\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
        const displayNameMatch = block.match(/DisplayName\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
        if (!displayNameMatch) continue
        const displayName = (displayNameMatch[1] ?? '').trim()
        if (
          displayName.startsWith('Microsoft') ||
          displayName.startsWith('Windows') ||
          displayName.includes('Update for') ||
          displayName.includes('Security Update') ||
          displayName.includes('Hotfix') ||
          displayName.includes('KB')
        )
          continue
        let uninstallBroken = false
        if (uninstallStrMatch) {
          const rawUninstall = (uninstallStrMatch[1] ?? '').trim()
          const exePath = expandEnvVars(extractExePath(rawUninstall) || '')
          if (exePath?.toLowerCase().includes('msiexec')) {
            // MSI uninstallers are always functional
          } else if (exePath?.toLowerCase().includes('rundll32')) {
            const strippedUninstall = rawUninstall.replace(/"/g, '')
            const dllMatch = strippedUninstall.match(/rundll32(?:\.exe)?\s+([^,]+\.dll)/i)
            if (dllMatch) {
              const dllPath = expandEnvVars((dllMatch[1] ?? '').trim())
              if (dllPath.includes('\\') && !dllPath.startsWith('%') && !existsSync(dllPath)) {
                uninstallBroken = true
              }
            }
          } else if (exePath?.includes('\\') && !exePath.startsWith('%') && !existsSync(exePath)) {
            uninstallBroken = true
          }
        }
        let installDirExists = false
        if (installLocMatch) {
          const installLoc = expandEnvVars((installLocMatch[1] ?? '').trim().replace(/"/g, ''))
          if (installLoc && installLoc.length > 3 && installLoc.includes('\\') && !installLoc.startsWith('%')) {
            installDirExists = existsSync(installLoc)
          }
        }
        if (!installDirExists) {
          const iconMatch = block.match(/DisplayIcon\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
          if (iconMatch) {
            const iconPath = expandEnvVars((iconMatch[1] ?? '').trim().replace(/"/g, '').split(',')[0]?.trim() ?? '')
            if (iconPath?.includes('\\') && !iconPath.startsWith('%') && existsSync(iconPath)) {
              installDirExists = true
            }
          }
        }
        let orphaned = false
        if (uninstallBroken && !installDirExists) {
          orphaned = true
        } else if (!uninstallStrMatch && !installDirExists && installLocMatch) {
          orphaned = true
        }
        if (orphaned) {
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: subKey,
            valueName: 'DisplayName',
            issue: `Uninstall entry for removed program: ${displayName}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key' },
          })
        }
      }
    } catch {
      /* Skip */
    }
  }

  try {
    const mimeKey = 'HKCR\\MIME\\Database\\Content Type'
    const { stdout } = await execReg(['query', mimeKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKCR\\MIME\\Database\\Content Type\\[^\r\n]+)/m)
      const clsidMatch = block.match(/CLSID\s+REG_SZ\s+(\{[0-9A-Fa-f-]+\})/i)
      if (keyMatch && clsidMatch) {
        const clsid = clsidMatch[1]
        if (!clsid) continue
        if (!(await clsidExists(clsid, signal))) {
          const mimeType = keyMatch[1]!.replace('HKCR\\MIME\\Database\\Content Type\\', '')
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: keyMatch[1]!,
            valueName: 'CLSID',
            issue: `MIME type "${mimeType}" references missing handler: ${clsid}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-value' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const autoPlayKey = 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\AutoplayHandlers\\Handlers'
    const { stdout } = await execReg(['query', autoPlayKey, '/s'], { timeout: 15000, ...(signal ? { signal } : {}) })
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKLM\\[^\r\n]+)/m)
      if (!keyMatch || keyMatch[1]! === autoPlayKey) continue
      const progIdMatch = block.match(/ProgID\s+REG_SZ\s+(.+)/i)
      if (progIdMatch) {
        const progId = (progIdMatch[1] ?? '').trim()
        if (progId) {
          try {
            await execReg(['query', `HKCR\\${progId}`], { timeout: 5000, ...(signal ? { signal } : {}) })
          } catch {
            const handlerName = keyMatch[1]!.split('\\').pop() || 'Unknown'
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: keyMatch[1]!,
              valueName: 'ProgID',
              issue: `AutoPlay handler "${handlerName}" references missing ProgID: ${progId}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' },
            })
          }
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()

  const clientLabels = [
    { subKey: 'StartMenuInternet', label: 'web browser' },
    { subKey: 'Mail', label: 'email client' },
    { subKey: 'Media', label: 'media player' },
    { subKey: 'News', label: 'news reader' },
    { subKey: 'Calendar', label: 'calendar app' },
  ]
  const clientRoots = ['HKLM\\SOFTWARE\\Clients', 'HKLM\\SOFTWARE\\WOW6432Node\\Clients', 'HKCU\\SOFTWARE\\Clients']
  const clientCategories: { key: string; label: string }[] = []
  for (const root of clientRoots) {
    for (const { subKey, label } of clientLabels) {
      clientCategories.push({ key: `${root}\\${subKey}`, label })
    }
  }
  for (const client of clientCategories) {
    try {
      const { stdout } = await execReg(['query', client.key], { timeout: 10000, ...(signal ? { signal } : {}) })
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const subKeyMatch = line.match(/^(HK\w+\\SOFTWARE\\(?:WOW6432Node\\)?Clients\\[^\\]+\\(.+))$/m)
        if (!subKeyMatch) continue
        const subKey = subKeyMatch[1]!.trim()
        const clientName = subKeyMatch[2]!.trim()
        if (
          clientName.toLowerCase().includes('microsoft') ||
          clientName.toLowerCase().includes('windows') ||
          clientName.toLowerCase() === 'outlook'
        )
          continue
        try {
          const { stdout: cmdOut } = await execReg(['query', `${subKey}\\shell\\open\\command`], {
            timeout: 5000,
            ...(signal ? { signal } : {}),
          })
          const rawValMatch = cmdOut.match(/\(Default\)\s+REG_SZ\s+(.+)/i)
          const exePath = rawValMatch ? extractExePath(rawValMatch[1]!.trim()) : null
          if (exePath?.includes('\\') && !exePath.startsWith('%') && !existsSync(exePath)) {
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: subKey,
              valueName: 'shell\\open\\command',
              issue: `Registered ${client.label} "${clientName}" points to missing executable: ${exePath}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' },
            })
          }
        } catch {
          /* No shell command */
        }
      }
    } catch {
      /* Skip */
    }
  }

  const bhoKeys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects',
    'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Browser Helper Objects',
  ]
  for (const bhoKey of bhoKeys) {
    try {
      const { stdout } = await execReg(['query', bhoKey], { timeout: 10000, ...(signal ? { signal } : {}) })
      const lines = stdout.split(/\r?\n/)
      for (const line of lines) {
        const subKeyMatch = line.match(/^(HKLM\\[^\\]+.*\\(\{[0-9A-Fa-f-]+\}))$/m)
        if (!subKeyMatch) continue
        const bhoSubKey = subKeyMatch[1]!.trim()
        const clsid = subKeyMatch[2]!
        if (!(await clsidExists(clsid, signal))) {
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: bhoSubKey,
            valueName: clsid,
            issue: `Browser Helper Object references missing COM object: ${clsid}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key' },
          })
        } else {
          const missingDll = await findMissingClsidDll(clsid, signal)
          if (missingDll) {
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: bhoSubKey,
              valueName: clsid,
              issue:
                missingDll === 'no-inproc'
                  ? `Browser Helper Object has broken COM registration: ${clsid}`
                  : `Browser Helper Object DLL missing: ${missingDll}`,
              risk: 'low',
              selected: true,
              fix: { op: 'delete-key' },
            })
          }
        }
      }
    } catch {
      /* Skip */
    }
  }

  try {
    const eventLogKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application'
    const { stdout } = await execReg(['query', eventLogKey], { timeout: 10000, ...(signal ? { signal } : {}) })
    const lines = stdout.split(/\r?\n/)
    for (const line of lines) {
      const subKeyMatch = line.match(/^(HKLM\\SYSTEM\\CurrentControlSet\\Services\\EventLog\\Application\\(.+))$/m)
      if (!subKeyMatch) continue
      const sourceKey = subKeyMatch[1]!.trim()
      const sourceName = subKeyMatch[2]!.trim()
      if (
        sourceName.toLowerCase().startsWith('microsoft') ||
        sourceName.toLowerCase().startsWith('windows') ||
        sourceName.toLowerCase().startsWith('.net') ||
        sourceName.toLowerCase() === 'application' ||
        sourceName.toLowerCase() === 'application error' ||
        sourceName.toLowerCase() === 'application hang' ||
        sourceName.toLowerCase() === 'eventlog' ||
        sourceName.toLowerCase() === 'vssetup'
      )
        continue
      try {
        const { stdout: srcOut } = await execReg(['query', sourceKey, '/v', 'EventMessageFile'], {
          timeout: 5000,
          ...(signal ? { signal } : {}),
        })
        const pathMatch = srcOut.match(/EventMessageFile\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
        if (pathMatch) {
          const rawValue = (pathMatch[1] ?? '').trim().replace(/"/g, '')
          const winDir = process.env.WINDIR || 'C:\\Windows'
          const allPaths = rawValue
            .split(/[;,]/)
            .map((p) => p.trim())
            .filter((p) => p.length > 0)
            .map((p) => p.replace(/%SystemRoot%/i, winDir))
          if (allPaths.some((p) => p.startsWith('%'))) continue
          const checkable = allPaths.filter((p) => p.includes('\\'))
          if (checkable.length > 0 && checkable.every((p) => !existsSync(p))) {
            let hasPrimaryModule = false
            try {
              const { stdout: pmOut } = await execReg(['query', sourceKey, '/v', 'PrimaryModule'], {
                timeout: 3000,
                ...(signal ? { signal } : {}),
              })
              if (pmOut.includes('PrimaryModule')) hasPrimaryModule = true
            } catch {
              /* no PrimaryModule */
            }
            if (!hasPrimaryModule) {
              entries.push({
                id: randomUUID(),
                type: 'orphaned',
                keyPath: sourceKey,
                valueName: 'EventMessageFile',
                issue: `Event log source "${sourceName}" — all message files missing`,
                risk: 'low',
                selected: true,
                fix: { op: 'delete-key' },
              })
            }
          }
        }
      } catch {
        /* No EventMessageFile value */
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()
  try {
    const { stdout } = await execReg(['query', 'HKCR\\Interface', '/s', '/f', 'ProxyStubClsid32'], {
      timeout: 20000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    let ifaceCount = 0
    for (const block of blocks) {
      if (ifaceCount >= 30) break
      const keyMatch = block.match(/^(HKCR\\Interface\\(\{[^}]+\})\\ProxyStubClsid32)/m)
      const valMatch = block.match(/\(Default\)\s+REG_SZ\s+(\{[0-9A-Fa-f-]+\})/i)
      if (keyMatch && valMatch) {
        const proxyClsid = valMatch[1]
        if (!proxyClsid) continue
        if (
          proxyClsid === '{00000320-0000-0000-C000-000000000046}' ||
          proxyClsid === '{0000033A-0000-0000-C000-000000000046}'
        )
          continue
        if (!(await clsidExists(proxyClsid, signal))) {
          const parentIfaceKey = `HKCR\\Interface\\${keyMatch[2]!}`
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: keyMatch[1]!,
            valueName: proxyClsid,
            issue: `COM interface references missing proxy stub: ${proxyClsid}`,
            risk: 'medium',
            selected: true,
            fix: { op: 'delete-key', key: parentIfaceKey },
          })
          ifaceCount++
        } else {
          const missingDll = await findMissingClsidDll(proxyClsid, signal)
          if (missingDll) {
            const parentIfaceKey = `HKCR\\Interface\\${keyMatch[2]!}`
            entries.push({
              id: randomUUID(),
              type: 'orphaned',
              keyPath: keyMatch[1]!,
              valueName: proxyClsid,
              issue:
                missingDll === 'no-inproc'
                  ? `COM interface proxy stub has broken registration: ${proxyClsid}`
                  : `COM interface proxy stub DLL missing: ${missingDll}`,
              risk: 'medium',
              selected: true,
              fix: { op: 'delete-key', key: parentIfaceKey },
            })
            ifaceCount++
          }
        }
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const fileExtsKey = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Explorer\\FileExts'
    const { stdout } = await execReg(['query', fileExtsKey, '/s', '/f', 'UserChoice'], {
      timeout: 15000,
      ...(signal ? { signal } : {}),
    })
    const blocks = stdout.split(/\r?\n\r?\n/)
    for (const block of blocks) {
      const keyMatch = block.match(/^(HKCU\\[^\r\n]*\\UserChoice)/m)
      const progIdMatch = block.match(/ProgId\s+REG_SZ\s+(.+)/i)
      if (keyMatch && progIdMatch) {
        const progId = (progIdMatch[1] ?? '').trim()
        if (
          !progId ||
          progId.startsWith('AppX') ||
          progId.startsWith('Microsoft.') ||
          progId.startsWith('Windows.') ||
          progId === 'Applications' ||
          progId.startsWith('IE.') ||
          progId.startsWith('MSEdge') ||
          progId.startsWith('Acrobat') ||
          progId.startsWith('WMP')
        )
          continue
        try {
          await execReg(['query', `HKCR\\${progId}`], { timeout: 3000, ...(signal ? { signal } : {}) })
        } catch {
          const extMatch = keyMatch[1]!.match(/FileExts\\([^\\]+)\\UserChoice/)
          const ext = extMatch ? extMatch[1] : 'unknown'
          entries.push({
            id: randomUUID(),
            type: 'orphaned',
            keyPath: keyMatch[1]!,
            valueName: 'ProgId',
            issue: `Default app for "${ext}" references removed program: ${progId}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-key' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  checkAborted()

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System', '/v', 'EnableLUA'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/EnableLUA\s+REG_DWORD\s+0x(\d+)/i)
    if (match && match[1]! === '0') {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\System',
        valueName: 'EnableLUA',
        issue: 'User Account Control (UAC) is disabled — malware can run with admin privileges silently',
        risk: 'high',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
      })
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      [
        'query',
        'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection',
        '/v',
        'DisableRealtimeMonitoring',
      ],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/DisableRealtimeMonitoring\s+REG_DWORD\s+0x(\d+)/i)
    if (match && match[1]! === '1') {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender\\Real-Time Protection',
        valueName: 'DisableRealtimeMonitoring',
        issue: 'Windows Defender real-time protection is disabled via policy',
        risk: 'high',
        selected: true,
        fix: { op: 'delete-value' },
      })
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender', '/v', 'DisableAntiSpyware'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/DisableAntiSpyware\s+REG_DWORD\s+0x(\d+)/i)
    if (match && match[1]! === '1') {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows Defender',
        valueName: 'DisableAntiSpyware',
        issue: 'Windows Defender antivirus is completely disabled via policy',
        risk: 'high',
        selected: true,
        fix: { op: 'delete-value' },
      })
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer', '/v', 'NoDriveTypeAutoRun'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/NoDriveTypeAutoRun\s+REG_DWORD\s+0x([0-9a-fA-F]+)/i)
    if (!match || Number.parseInt(match[1]!, 16) < 0xff) {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
        valueName: 'NoDriveTypeAutoRun',
        issue: 'AutoRun is not fully disabled — removable drives can auto-execute malware',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '255' },
      })
    }
  } catch {
    entries.push({
      id: randomUUID(),
      type: 'vulnerability',
      keyPath: 'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer',
      valueName: 'NoDriveTypeAutoRun',
      issue: 'AutoRun is not disabled — removable drives can auto-execute malware',
      risk: 'medium',
      selected: true,
      fix: { op: 'set-value', regType: 'REG_DWORD', data: '255' },
    })
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters', '/v', 'SMB1'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/SMB1\s+REG_DWORD\s+0x(\d+)/i)
    if (match && match[1]! !== '0') {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\LanmanServer\\Parameters',
        valueName: 'SMB1',
        issue: 'SMBv1 protocol is enabled — vulnerable to WannaCry and EternalBlue exploits',
        risk: 'high',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' },
      })
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout: rdpEnabled } = await execReg(
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server', '/v', 'fDenyTSConnections'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const rdpMatch = rdpEnabled.match(/fDenyTSConnections\s+REG_DWORD\s+0x(\d+)/i)
    if (rdpMatch && rdpMatch[1] === '0') {
      try {
        const rdpNlaKey = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Terminal Server\\WinStations\\RDP-Tcp'
        const { stdout: nlaOut } = await execReg(['query', rdpNlaKey, '/v', 'UserAuthentication'], {
          timeout: 5000,
          ...(signal ? { signal } : {}),
        })
        const nlaMatch = nlaOut.match(/UserAuthentication\s+REG_DWORD\s+0x(\d+)/i)
        if (!nlaMatch || nlaMatch[1] === '0') {
          entries.push({
            id: randomUUID(),
            type: 'vulnerability',
            keyPath: rdpNlaKey,
            valueName: 'UserAuthentication',
            issue: 'Remote Desktop is enabled without Network Level Authentication (NLA)',
            risk: 'high',
            selected: true,
            fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
          })
        }
      } catch {
        /* Skip */
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell', '/v', 'ExecutionPolicy'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/ExecutionPolicy\s+REG_SZ\s+(.+)/i)
    if (match) {
      const policy = match[1]!.trim().toLowerCase()
      if (policy === 'unrestricted' || policy === 'bypass') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: 'HKLM\\SOFTWARE\\Microsoft\\PowerShell\\1\\ShellIds\\Microsoft.PowerShell',
          valueName: 'ExecutionPolicy',
          issue: `PowerShell execution policy is "${match[1]!.trim()}" — scripts from any source can run`,
          risk: 'medium',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_SZ', data: 'RemoteSigned' },
        })
      }
    }
  } catch {
    /* Skip */
  }

  const fwProfiles = [
    { key: 'DomainProfile', label: 'Domain' },
    { key: 'StandardProfile', label: 'Private' },
    { key: 'PublicProfile', label: 'Public' },
  ]
  for (const profile of fwProfiles) {
    try {
      const fwKey = `HKLM\\SYSTEM\\CurrentControlSet\\Services\\SharedAccess\\Parameters\\FirewallPolicy\\${profile.key}`
      const { stdout } = await execReg(['query', fwKey, '/v', 'EnableFirewall'], {
        timeout: 5000,
        ...(signal ? { signal } : {}),
      })
      const match = stdout.match(/EnableFirewall\s+REG_DWORD\s+0x(\d+)/i)
      if (match && match[1]! === '0') {
        entries.push({
          id: randomUUID(),
          type: 'vulnerability',
          keyPath: fwKey,
          valueName: 'EnableFirewall',
          issue: `Windows Firewall is disabled for ${profile.label} network profile`,
          risk: 'high',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
        })
      }
    } catch {
      /* Skip */
    }
  }

  try {
    const { stdout } = await execReg(
      ['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RemoteRegistry', '/v', 'Start'],
      { timeout: 5000, ...(signal ? { signal } : {}) },
    )
    const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
    if (match && (match[1]! === '2' || match[1]! === '3')) {
      entries.push({
        id: randomUUID(),
        type: 'vulnerability',
        keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\RemoteRegistry',
        valueName: 'Start',
        issue: `Remote Registry service is ${match[1]! === '2' ? 'set to auto-start' : 'enabled'} — allows remote registry access`,
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' },
      })
    }
  } catch {
    /* Skip */
  }

  checkAborted()

  try {
    const { stdout } = await execReg(['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain', '/v', 'Start'], {
      timeout: 5000,
      ...(signal ? { signal } : {}),
    })
    const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
    if (match && (match[1]! === '2' || match[1]! === '3')) {
      let isSSD = false
      try {
        const diskScript =
          '$disk = Get-PhysicalDisk | Where-Object { $_.DeviceID -eq (Get-Partition -DriveLetter C | Get-Disk).Number }; $disk.MediaType'
        const { stdout: driveInfo } = await execFileAsync(
          'powershell',
          ['-NoProfile', '-Command', psUtf8(diskScript)],
          { timeout: 10000, windowsHide: true },
        )
        isSSD = driveInfo.trim().toUpperCase() === 'SSD'
      } catch {
        /* Assume HDD if detection fails */
      }
      if (isSSD) {
        entries.push({
          id: randomUUID(),
          type: 'performance',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain',
          valueName: 'Start',
          issue: 'SysMain (Superfetch) is enabled — unnecessary on your SSD, safe to disable',
          risk: 'low',
          selected: true,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' },
        })
      } else {
        entries.push({
          id: randomUUID(),
          type: 'performance',
          keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\SysMain',
          valueName: 'Start',
          issue: 'SysMain (Superfetch) is enabled — improves performance on HDDs, only disable if you have an SSD',
          risk: 'low',
          selected: false,
          fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' },
        })
      }
    }
  } catch {
    /* Skip */
  }

  try {
    const llmnrKey = 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient'
    const { stdout } = await execReg(['query', llmnrKey, '/v', 'EnableMulticast'], {
      timeout: 5000,
      ...(signal ? { signal } : {}),
    })
    const match = stdout.match(/EnableMulticast\s+REG_DWORD\s+0x(\d+)/i)
    if (!match || match[1]! !== '0') {
      entries.push({
        id: randomUUID(),
        type: 'network',
        keyPath: llmnrKey,
        valueName: 'EnableMulticast',
        issue: 'LLMNR is enabled — vulnerable to name resolution poisoning attacks on local networks',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' },
      })
    }
  } catch {
    entries.push({
      id: randomUUID(),
      type: 'network',
      keyPath: 'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows NT\\DNSClient',
      valueName: 'EnableMulticast',
      issue: 'LLMNR is enabled by default — vulnerable to name resolution poisoning attacks',
      risk: 'medium',
      selected: true,
      fix: { op: 'set-value', regType: 'REG_DWORD', data: '0' },
    })
  }

  try {
    const wpadKey = 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Wpad'
    const { stdout } = await execReg(['query', wpadKey, '/v', 'WpadOverride'], {
      timeout: 5000,
      ...(signal ? { signal } : {}),
    })
    const match = stdout.match(/WpadOverride\s+REG_DWORD\s+0x(\d+)/i)
    if (!match || match[1]! !== '1') {
      entries.push({
        id: randomUUID(),
        type: 'network',
        keyPath: wpadKey,
        valueName: 'WpadOverride',
        issue: 'WPAD auto-proxy discovery is enabled — can be exploited for man-in-the-middle attacks',
        risk: 'medium',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
      })
    }
  } catch {
    entries.push({
      id: randomUUID(),
      type: 'network',
      keyPath: 'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Internet Settings\\Wpad',
      valueName: 'WpadOverride',
      issue: 'WPAD auto-proxy discovery is enabled — can be exploited for man-in-the-middle attacks',
      risk: 'medium',
      selected: true,
      fix: { op: 'set-value', regType: 'REG_DWORD', data: '1' },
    })
  }

  checkAborted()

  try {
    const { stdout } = await execReg(['query', 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Fax', '/v', 'Start'], {
      timeout: 5000,
      ...(signal ? { signal } : {}),
    })
    const match = stdout.match(/Start\s+REG_DWORD\s+0x(\d+)/i)
    if (match && (match[1]! === '2' || match[1]! === '3')) {
      entries.push({
        id: randomUUID(),
        type: 'service',
        keyPath: 'HKLM\\SYSTEM\\CurrentControlSet\\Services\\Fax',
        valueName: 'Start',
        issue: `Fax service is ${match[1]! === '2' ? 'set to auto-start' : 'enabled'} — unnecessary on most machines`,
        risk: 'low',
        selected: true,
        fix: { op: 'set-value', regType: 'REG_DWORD', data: '4' },
      })
    }
  } catch {
    /* Skip */
  }

  checkAborted()

  try {
    const { stdout } = await execNativeUtf8(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psUtf8(`Get-ScheduledTask | Where-Object { $_.State -ne 'Disabled' } | ForEach-Object {
        $action = if ($_.Actions) { $_.Actions | Select-Object -First 1 } else { $null }
        $execute = if ($action -and $action.Execute) { $action.Execute } else { '' }
        [PSCustomObject]@{ TaskName = $_.TaskName; TaskPath = $_.TaskPath; Execute = $execute }
      } | ConvertTo-Json -Compress`),
      ],
      { timeout: 20000, ...(signal ? { signal } : {}) },
    )
    const tasks: Array<{ TaskName: string; TaskPath: string; Execute: string }> = JSON.parse(stdout)
    const taskList = Array.isArray(tasks) ? tasks : [tasks]
    const seen = new Set<string>()
    for (const t of taskList) {
      const taskName = t.TaskPath + t.TaskName
      const taskToRun = (t.Execute || '').trim()
      if (!taskToRun || taskToRun === 'N/A' || taskToRun.startsWith('COM handler') || seen.has(taskName)) continue
      seen.add(taskName)
      const exePath = extractExePath(taskToRun)
      if (exePath) {
        if (
          exePath.includes('\\') &&
          !exePath.toLowerCase().startsWith('c:\\windows\\') &&
          !exePath.startsWith('%') &&
          !existsSync(expandEnvVars(exePath))
        ) {
          entries.push({
            id: randomUUID(),
            type: 'task',
            keyPath: taskName,
            valueName: 'Task To Run',
            issue: `Scheduled task points to missing executable: ${exePath}`,
            risk: 'low',
            selected: true,
            fix: { op: 'delete-task' },
          })
        }
      }
    }
  } catch {
    /* Skip */
  }

  const thirdPartyTasks = [
    { pattern: 'Adobe Acrobat Update', exe: 'AdobeARM.exe' },
    { pattern: 'Adobe Flash Player', exe: 'FlashPlayerUpdateService.exe' },
    { pattern: 'JavaUpdateSched', exe: 'jusched.exe' },
    { pattern: 'GoogleUpdate', exe: 'GoogleUpdate.exe' },
    { pattern: 'CCleaner', exe: 'CCleaner' },
  ]
  try {
    const { stdout } = await execNativeUtf8(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        psUtf8(`Get-ScheduledTask | ForEach-Object {
        $action = if ($_.Actions) { $_.Actions | Select-Object -First 1 } else { $null }
        $execute = if ($action -and $action.Execute) { $action.Execute } else { '' }
        [PSCustomObject]@{ TaskName = $_.TaskName; TaskPath = $_.TaskPath; Execute = $execute }
      } | ConvertTo-Json -Compress`),
      ],
      { timeout: 15000, ...(signal ? { signal } : {}) },
    )
    const tasks: Array<{ TaskName: string; TaskPath: string; Execute: string }> = JSON.parse(stdout)
    const taskList = Array.isArray(tasks) ? tasks : [tasks]
    for (const task of thirdPartyTasks) {
      const matchingTasks = taskList.filter((t) => (t.TaskPath + t.TaskName).includes(task.pattern))
      for (const t of matchingTasks) {
        const taskToRun = (t.Execute || '').trim()
        const taskExe = taskToRun ? extractExePath(taskToRun) : null
        if (taskExe && existsSync(expandEnvVars(taskExe))) continue
        entries.push({
          id: randomUUID(),
          type: 'task',
          keyPath: t.TaskPath + t.TaskName,
          valueName: 'Scheduled Task',
          issue: `Third-party update task "${task.pattern}" — may be for uninstalled software`,
          risk: 'low',
          selected: true,
          fix: { op: 'delete-task' },
        })
      }
    }
  } catch {
    /* Skip */
  }

  return entries
}

function pruneOldBackups(backupDir: string, keep: number): void {
  try {
    const tsCapture = /(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)/
    const regRe = new RegExp(`^registry-backup-.*?${tsCapture.source}\\.reg$`)
    const taskDirRe = new RegExp(`^registry-backup-tasks-${tsCapture.source}$`)
    const groups = new Map<string, string[]>()
    for (const f of readdirSync(backupDir)) {
      const m = f.match(regRe) || f.match(taskDirRe)
      if (!m) continue
      const ts = m[1]!
      const list = groups.get(ts) ?? []
      list.push(f)
      groups.set(ts, list)
    }
    const stale = [...groups.keys()].sort().reverse().slice(keep)
    for (const ts of stale) {
      for (const f of groups.get(ts)!) {
        const full = join(backupDir, f)
        try {
          if (taskDirRe.test(f)) rmSync(full, { recursive: true, force: true })
          else unlinkSync(full)
        } catch {
          /* skip */
        }
      }
    }
  } catch {
    /* skip */
  }
}

async function createFullBackup(backupDir: string, timestamp: string, signal?: AbortSignal): Promise<void> {
  const backupPath = join(backupDir, `registry-backup-${timestamp}.reg`)
  await execReg(['export', 'HKLM\\SOFTWARE', backupPath, '/y'], { timeout: 30000, ...(signal ? { signal } : {}) })
  const hkcuBackupPath = join(backupDir, `registry-backup-HKCU-${timestamp}.reg`)
  await execReg(['export', 'HKCU\\SOFTWARE', hkcuBackupPath, '/y'], {
    timeout: 30000,
    ...(signal ? { signal } : {}),
  }).catch(() => {})
  const systemBackupPath = join(backupDir, `registry-backup-SYSTEM-${timestamp}.reg`)
  await execReg(['export', 'HKLM\\SYSTEM\\CurrentControlSet\\Services', systemBackupPath, '/y'], {
    timeout: 60000,
    ...(signal ? { signal } : {}),
  }).catch(() => {})
  const hkcrClsidPath = join(backupDir, `registry-backup-HKCR-CLSID-${timestamp}.reg`)
  await execReg(['export', 'HKCR\\CLSID', hkcrClsidPath, '/y'], {
    timeout: 60000,
    ...(signal ? { signal } : {}),
  }).catch(() => {})
  const hkcrIfacePath = join(backupDir, `registry-backup-HKCR-Interface-${timestamp}.reg`)
  await execReg(['export', 'HKCR\\Interface', hkcrIfacePath, '/y'], {
    timeout: 60000,
    ...(signal ? { signal } : {}),
  }).catch(() => {})
  const hkcrMimePath = join(backupDir, `registry-backup-HKCR-MIME-${timestamp}.reg`)
  await execReg(['export', 'HKCR\\MIME', hkcrMimePath, '/y'], { timeout: 30000, ...(signal ? { signal } : {}) }).catch(
    () => {},
  )
  const shellRoots = [
    { key: '*', file: 'AllFileTypes' },
    { key: 'Directory', file: 'Directory' },
    { key: 'Folder', file: 'Folder' },
  ]
  for (const { key, file } of shellRoots) {
    const shellPath = join(backupDir, `registry-backup-HKCR-${file}-shellex-${timestamp}.reg`)
    await execReg(['export', `HKCR\\${key}\\shellex`, shellPath, '/y'], {
      timeout: 30000,
      ...(signal ? { signal } : {}),
    }).catch(() => {})
  }
}

export function collectBackupTargets(entries: RegistryEntry[]): { keys: string[]; tasks: string[] } {
  const keys = new Set<string>()
  const tasks = new Set<string>()
  for (const entry of entries) {
    if (!entry.fix) continue
    const key = entry.fix.key || entry.keyPath
    switch (entry.fix.op) {
      case 'delete-value':
      case 'set-value':
      case 'delete-key':
        if (key) keys.add(key)
        break
      case 'disable-task':
      case 'delete-task':
        if (entry.keyPath) tasks.add(entry.keyPath)
        break
    }
  }
  return { keys: [...keys], tasks: [...tasks] }
}

function stripRegHeader(content: string): string {
  return content.replace(/^﻿?Windows Registry Editor Version 5\.00\r?\n\r?\n/, '')
}

async function createTargetedBackup(
  entries: RegistryEntry[],
  backupDir: string,
  timestamp: string,
  signal?: AbortSignal,
): Promise<void> {
  const { keys, tasks } = collectBackupTargets(entries)
  if (keys.length === 0 && tasks.length === 0) return
  const tempDir = mkdtempSync(join(tmpdir(), 'dinho-reg-backup-'))
  try {
    const bodies: string[] = []
    let idx = 0
    for (const key of keys) {
      if (signal?.aborted) break
      const tempPath = join(tempDir, `part-${idx++}.reg`)
      try {
        await execReg(['export', key, tempPath, '/y'], { timeout: 30000, ...(signal ? { signal } : {}) })
        bodies.push(stripRegHeader(readFileSync(tempPath, 'utf16le')))
      } catch {
        /* Key may have been removed */
      }
    }
    if (bodies.length > 0) {
      const consolidatedPath = join(backupDir, `registry-backup-targeted-${timestamp}.reg`)
      const finalText = `Windows Registry Editor Version 5.00\r\n\r\n${bodies.join('')}`
      const bom = Buffer.from([0xff, 0xfe])
      const body = Buffer.from(finalText, 'utf16le')
      writeFileSync(consolidatedPath, Buffer.concat([bom, body]))
    }
    if (tasks.length > 0) {
      const taskDir = join(backupDir, `registry-backup-tasks-${timestamp}`)
      mkdirSync(taskDir, { recursive: true })
      for (const taskPath of tasks) {
        if (signal?.aborted) break
        const parts = splitTaskPath(taskPath)
        if (!parts) continue
        const fullName = (parts.path + parts.name).replace(/\\+/g, '\\')
        const safeName = parts.name.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100) || 'task'
        try {
          const { stdout } = await execNativeUtf8('schtasks', ['/query', '/xml', '/tn', fullName], {
            timeout: 10000,
            ...(signal ? { signal } : {}),
          })
          writeFileSync(join(taskDir, `${safeName}.xml`), stdout, 'utf-8')
        } catch {
          /* Task may already be gone */
        }
      }
    }
  } finally {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
  }
}

export async function fixRegistryEntries(
  entries: RegistryEntry[],
  onProgress?: (current: number, total: number, label: string) => void,
  signal?: AbortSignal,
): Promise<{ fixed: number; failed: number; failures: { issue: string; reason: string }[] }> {
  const total = entries.length
  onProgress?.(0, total, 'Creating registry backup...')
  let fixed = 0
  let failed = 0
  const failures: { issue: string; reason: string }[] = []

  try {
    const backupDir = getBackupDir()
    mkdirSync(backupDir, { recursive: true })
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const mode = getSettings().backupMode ?? 'targeted'
    if (mode === 'full') {
      await createFullBackup(backupDir, timestamp, signal)
    } else {
      await createTargetedBackup(entries, backupDir, timestamp, signal)
    }
    pruneOldBackups(backupDir, 3)
  } catch {
    /* Backup failed, but continue */
  }

  for (let i = 0; i < entries.length; i++) {
    if (signal?.aborted) break
    const entry = entries[i]
    if (!entry || !entry.fix) {
      failed++
      failures.push({ issue: 'Unknown entry', reason: 'Entry data not found — try scanning again before fixing' })
      continue
    }

    const fix = entry.fix
    const key = fix.key || entry.keyPath
    const value = fix.value || entry.valueName

    onProgress?.(i + 1, total, `Fixing: ${entry.issue.substring(0, 80)}...`)

    try {
      switch (fix.op) {
        case 'delete-value':
          await execReg(['delete', key, '/v', value, '/f'], { timeout: 10000, ...(signal ? { signal } : {}) })
          break
        case 'delete-key':
          await execReg(['delete', key, '/f'], { timeout: 10000, ...(signal ? { signal } : {}) })
          break
        case 'set-value':
          if (fix.regType && fix.data !== undefined) {
            await execReg(['add', key, '/v', value, '/t', fix.regType, '/d', fix.data, '/f'], {
              timeout: 10000,
              ...(signal ? { signal } : {}),
            })
          }
          break
        case 'disable-task': {
          const disableParts = splitTaskPath(entry.keyPath)
          if (!disableParts) throw new Error('Invalid task path')
          const safeDisablePath = disableParts.path.replace(/'/g, "''")
          const safeDisableName = disableParts.name.replace(/'/g, "''")
          const disableScript = `Disable-ScheduledTask -TaskPath '${safeDisablePath}' -TaskName '${safeDisableName}' -ErrorAction Stop`
          await execTracked('powershell', ['-NoProfile', '-NonInteractive', '-Command', psUtf8(disableScript)], {
            timeout: 10000,
            ...(signal ? { signal } : {}),
          })
          break
        }
        case 'delete-task': {
          const deleteParts = splitTaskPath(entry.keyPath)
          if (!deleteParts) throw new Error('Invalid task path')
          const safeDeletePath = deleteParts.path.replace(/'/g, "''")
          const safeDeleteName = deleteParts.name.replace(/'/g, "''")
          const deleteScript = `Unregister-ScheduledTask -TaskPath '${safeDeletePath}' -TaskName '${safeDeleteName}' -Confirm:$false -ErrorAction Stop`
          await execTracked('powershell', ['-NoProfile', '-NonInteractive', '-Command', psUtf8(deleteScript)], {
            timeout: 10000,
            ...(signal ? { signal } : {}),
          })
          break
        }
      }
      fixed++
    } catch (err: unknown) {
      const e = err as { stderr?: string; message?: string }
      const stderr: string = (e?.stderr || e?.message) ?? 'Unknown error'
      const reason = stderr.includes('Access is denied')
        ? 'Access denied — run as administrator'
        : stderr.includes('cannot find') || stderr.includes('does not exist')
          ? 'Key or value no longer exists'
          : stderr.includes('network')
            ? 'Network error'
            : stderr.split(/\r?\n/)[0].substring(0, 120) || 'Unknown error'
      failed++
      failures.push({ issue: entry.issue, reason })
    }
  }

  onProgress?.(total, total, 'Done')
  return { fixed, failed, failures }
}
