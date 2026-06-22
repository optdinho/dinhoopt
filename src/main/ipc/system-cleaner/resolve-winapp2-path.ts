import { homedir } from 'node:os'
import path from 'node:path'

export function resolveWinapp2Path(template: string): string {
  const home = homedir()
  const vars: Record<string, string> = {
    LOCALAPPDATA: process.env.LOCALAPPDATA || path.win32.join(home, 'AppData', 'Local'),
    APPDATA: process.env.APPDATA || path.win32.join(home, 'AppData', 'Roaming'),
    WINDIR: process.env.WINDIR || 'C:\\Windows',
    PROGRAMDATA: process.env.ProgramData || 'C:\\ProgramData',
    PROGRAMFILES: process.env.ProgramFiles || 'C:\\Program Files',
    PROGRAMFILES_X86: process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)',
    HOME: home,
    SYSTEMDRIVE: process.env.SystemDrive || 'C:',
  }
  const withBrace = template.replace(/\$\{(\w+)\}/g, (_, name) => vars[name] || '')
  const withPercent = withBrace.replace(
    /%(\w+)%/g,
    (_, name) => vars[name.toUpperCase()] || process.env[name.toUpperCase()] || '',
  )
  return path.win32.normalize(withPercent)
}
