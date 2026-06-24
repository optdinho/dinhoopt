import { execFile, execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, parse } from 'node:path'
import { promisify } from 'node:util'
import { getLogger } from './logger.service'

const execFileAsync = promisify(execFile)

const THUMB_DIR = '.thumbnails'
const THUMB_WIDTH = 320
const DEFAULT_SEEK_SEC = 5
const FFMPEG_TIMEOUT = 30_000

let _ffmpegPath: string | null | undefined
let _ffprobePath: string | null | undefined

function scanFfmpeg(): void {
  if (_ffmpegPath !== undefined) return

  const candidates = ['ffmpeg.exe', 'ffmpeg']
  const ffprobeCandidates = ['ffprobe.exe', 'ffprobe']
  const dirs: string[] = []

  const pf = process.env['ProgramFiles']
  const pf86 = process.env['ProgramFiles(x86)']
  const localAppData = process.env['LOCALAPPDATA']
  if (pf) dirs.push(join(pf, 'ffmpeg', 'bin'), join(pf, 'FFmpeg', 'bin'))
  if (pf86) dirs.push(join(pf86, 'ffmpeg', 'bin'), join(pf86, 'FFmpeg', 'bin'))
  if (localAppData) {
    dirs.push(join(localAppData, 'Microsoft', 'WinGet', 'Packages', 'Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe'))
  }
  dirs.push('C:\\ffmpeg\\bin', 'C:\\FFmpeg\\bin', 'C:\\tools\\ffmpeg\\bin')

  for (const dir of dirs) {
    for (const name of candidates) {
      const p = join(dir, name)
      if (existsSync(p)) {
        _ffmpegPath = p
        for (const fp of ffprobeCandidates) {
          const pp = join(dir, fp)
          if (existsSync(pp)) {
            _ffprobePath = pp
            break
          }
        }
        return
      }
    }
  }

  // Try PATH resolution via where.exe
  try {
    const stdout = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf-8', timeout: 5000 })
    const firstLine = stdout.split('\n')[0].trim()
    if (firstLine) {
      _ffmpegPath = firstLine
      const dir = parse(firstLine).dir
      for (const fp of ffprobeCandidates) {
        const pp = join(dir, fp)
        if (existsSync(pp)) {
          _ffprobePath = pp
          return
        }
      }
      // Try ffprobe via PATH too
      try {
        const fpStdout = execFileSync('where.exe', ['ffprobe'], { encoding: 'utf-8', timeout: 5000 })
        const fpLine = fpStdout.split('\n')[0].trim()
        if (fpLine) _ffprobePath = fpLine
      } catch { /* ffprobe not in PATH */ }
      return
    }
  } catch { /* ffmpeg not in PATH */ }

  _ffmpegPath = null
  _ffprobePath = null
}

export function hasFfmpeg(): boolean {
  scanFfmpeg()
  return _ffmpegPath !== null
}

function getCacheDir(outputDir: string): string {
  return join(outputDir, THUMB_DIR)
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

function thumbPathFor(outputDir: string, clipName: string): string {
  return join(getCacheDir(outputDir), `${parse(clipName).name}.jpg`)
}

export function getCachedThumbnailPath(outputDir: string, clipName: string): string | null {
  const p = thumbPathFor(outputDir, clipName)
  return existsSync(p) ? p : null
}

export async function generateThumbnail(outputDir: string, clipName: string): Promise<string | null> {
  scanFfmpeg()
  if (!_ffmpegPath) return null

  const videoPath = join(outputDir, clipName)
  if (!existsSync(videoPath)) return null

  const cached = getCachedThumbnailPath(outputDir, clipName)
  if (cached) return cached

  ensureDir(getCacheDir(outputDir))
  const thumbPath = thumbPathFor(outputDir, clipName)

  try {
    let seekSec = DEFAULT_SEEK_SEC

    if (_ffprobePath) {
      try {
        const { stdout } = await execFileAsync(
          _ffprobePath,
          ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', videoPath],
          { timeout: 10_000, encoding: 'utf-8' },
        )
        const dur = Number.parseFloat(stdout.trim())
        if (!Number.isNaN(dur) && dur > 0) seekSec = Math.min(dur * 0.25, 60)
      } catch {
        /* ffprobe failed, use default seek */
      }
    }

    await execFileAsync(
      _ffmpegPath,
      ['-ss', String(seekSec), '-i', videoPath, '-vframes', '1', '-q:v', '3', '-vf', `scale=${THUMB_WIDTH}:-1`, '-y', thumbPath],
      { timeout: FFMPEG_TIMEOUT },
    )

    if (existsSync(thumbPath) && statSync(thumbPath).size > 0) return thumbPath
    return null
  } catch (err) {
    getLogger().warning('thumbnail', `Failed to generate thumbnail for ${clipName}: ${err}`)
    return null
  }
}

export function readThumbnailDataUrl(thumbPath: string): string | null {
  try {
    const data = readFileSync(thumbPath)
    return `data:image/jpeg;base64,${data.toString('base64')}`
  } catch {
    return null
  }
}

export async function getThumbnailDataUrl(outputDir: string, clipName: string): Promise<string | null> {
  const cached = getCachedThumbnailPath(outputDir, clipName)
  if (cached) {
    const url = readThumbnailDataUrl(cached)
    if (url) return url
  }
  const thumbPath = await generateThumbnail(outputDir, clipName)
  if (!thumbPath) return null
  return readThumbnailDataUrl(thumbPath)
}
