import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let _cachedPath: string | null = null

export function getFfmpegPath(): string {
  if (_cachedPath && existsSync(_cachedPath)) return _cachedPath

  const candidates = ['ffmpeg.exe', 'ffmpeg']
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

  for (const dir of dirs) {
    for (const name of candidates) {
      const p = join(dir, name)
      if (existsSync(p)) {
        _cachedPath = p
        return p
      }
    }
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
