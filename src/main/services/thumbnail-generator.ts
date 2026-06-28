import { execFile } from 'node:child_process'
import type { ExecFileException } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { join, parse } from 'node:path'
import { getLogger } from './logger.service'

function execFileAsync(
  cmd: string,
  args: readonly string[],
  options: { timeout: number; encoding: string },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err: ExecFileException | null, stdout: string, stderr: string) => {
      if (err) reject(err)
      else resolve({ stdout, stderr })
    })
  })
}

const THUMB_DIR = '.thumbnails'
const THUMB_WIDTH = 320
const DEFAULT_SEEK_SEC = 5
const FFMPEG_TIMEOUT = 30_000

let _ffmpegPath: string | null | undefined
let _scanning: Promise<void> | null = null

async function scanFfmpeg(): Promise<void> {
  if (_ffmpegPath !== undefined) return
  if (_scanning) return _scanning

  _scanning = (async () => {
    const candidates = ['ffmpeg.exe', 'ffmpeg']
    const dirs: string[] = []

    const pf = process.env['ProgramFiles']
    const pf86 = process.env['ProgramFiles(x86)']
    const localAppData = process.env['LOCALAPPDATA']
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
          _ffmpegPath = p
          return
        }
      }
    }

    // Try PATH resolution via where.exe (async, non-blocking)
    try {
      const { stdout } = await execFileAsync('where.exe', ['ffmpeg'], { encoding: 'utf-8', timeout: 5000 })
      const firstLine = stdout.split('\n')[0].trim()
      if (firstLine) {
        _ffmpegPath = firstLine
        return
      }
    } catch {
      /* ffmpeg not in PATH */
    }

    _ffmpegPath = null
  })()

  await _scanning
}

export async function hasFfmpeg(): Promise<boolean> {
  await scanFfmpeg()
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
  await scanFfmpeg()
  if (!_ffmpegPath) return null

  const videoPath = join(outputDir, clipName)
  if (!existsSync(videoPath)) return null

  const cached = getCachedThumbnailPath(outputDir, clipName)
  if (cached) return cached

  ensureDir(getCacheDir(outputDir))
  const thumbPath = thumbPathFor(outputDir, clipName)

  try {
    let seekSec = DEFAULT_SEEK_SEC

    try {
      const { stderr } = await execFileAsync(_ffmpegPath, ['-i', videoPath, '-f', 'null', '-'], {
        timeout: 10_000,
        encoding: 'utf-8',
      })
      const match = stderr.match(/Duration: (\d{2}):(\d{2}):(\d{2})\.(\d+)/)
      if (match) {
        const h = Number.parseInt(match[1]!, 10)
        const m = Number.parseInt(match[2]!, 10)
        const s = Number.parseInt(match[3]!, 10)
        const cs = Number.parseInt(match[4]!.padEnd(3, '0'), 10)
        const dur = h * 3600 + m * 60 + s + cs / 1000
        if (dur > 0) seekSec = Math.min(dur * 0.25, 60)
      }
    } catch {
      /* ffmpeg probe failed, use default seek */
    }

    await execFileAsync(
      _ffmpegPath,
      [
        '-ss',
        String(seekSec),
        '-i',
        videoPath,
        '-vframes',
        '1',
        '-q:v',
        '3',
        '-vf',
        `scale=${THUMB_WIDTH}:-1`,
        '-y',
        thumbPath,
      ],
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
