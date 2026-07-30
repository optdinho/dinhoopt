import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let _cachedPath: string | null = null

const _candidates = ['ffmpeg.exe', 'ffmpeg']

function findInDirs(dirs: string[]): string | null {
  for (const dir of dirs) {
    for (const name of _candidates) {
      const p = join(dir, name)
      if (existsSync(p)) return p
    }
  }
  return null
}

export function getFfmpegPath(): string {
  if (_cachedPath && existsSync(_cachedPath)) return _cachedPath

  // Try PATH first (most common: WinGet, scoop, choco, manual)
  const pathDirs = (process.env.PATH || '').split(';')
  const found = findInDirs(pathDirs.map((d) => d.trim()).filter(Boolean))
  if (found) {
    _cachedPath = found
    return found
  }

  // Fall back to common install directories
  const dirs: string[] = []
  const pf = process.env.ProgramFiles
  const pf86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env.LOCALAPPDATA
  if (pf) dirs.push(join(pf, 'ffmpeg', 'bin'), join(pf, 'FFmpeg', 'bin'))
  if (pf86) dirs.push(join(pf86, 'ffmpeg', 'bin'), join(pf86, 'FFmpeg', 'bin'))
  if (localAppData) {
    dirs.push(
      join(localAppData, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe'),
    )
  }
  dirs.push('C:\\ffmpeg\\bin', 'C:\\FFmpeg\\bin', 'C:\\tools\\ffmpeg\\bin')

  const fromDirs = findInDirs(dirs)
  if (fromDirs) {
    _cachedPath = fromDirs
    return fromDirs
  }

  try {
    const result = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf-8', timeout: 3000 }).trim()
    if (result) {
      _cachedPath = result.split('\n')[0].trim()
      return _cachedPath
    }
  } catch {
    /* ffmpeg not in PATH */
  }

  return 'ffmpeg'
}
