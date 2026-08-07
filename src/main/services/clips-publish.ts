import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { getLogger } from './logger.service'

const UPLOAD_TIMEOUT_MS = 600_000
const UPLOAD_IDLE_TIMEOUT_MS = 60_000

const UPLOAD_URL = 'https://upload.gofile.io/uploadfile'
const BOUNDARY = '----DiNhoClipUpload' + Date.now().toString(36)

export interface PublishProgress {
  loaded: number
  total: number
  percent: number
}

export interface PublishResult {
  success: boolean
  link?: string
  error?: string
  cancelled?: boolean
}

export function buildMultipartHeader(fileName: string): string {
  const safeName = fileName.replace(/["\r\n]/g, '')
  return (
    `--${BOUNDARY}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${safeName}"\r\n` +
    'Content-Type: application/octet-stream\r\n' +
    '\r\n'
  )
}

export function buildMultipartFooter(): string {
  return `\r\n--${BOUNDARY}--\r\n`
}

export async function uploadClipToGofile(
  filePath: string,
  onProgress?: (p: PublishProgress) => void,
  signal?: AbortSignal,
): Promise<PublishResult> {
  let totalBytes: number
  try {
    totalBytes = statSync(filePath).size
  } catch {
    return { success: false, error: 'File not found' }
  }

  const fileName = basename(filePath)
  const header = Buffer.from(buildMultipartHeader(fileName), 'utf8')
  const footer = Buffer.from(buildMultipartFooter(), 'utf8')
  const fileStream = createReadStream(filePath)
  let loaded = 0
  let lastProgress = 0

  async function* body(): AsyncGenerator<Uint8Array> {
    yield header
    for await (const chunk of fileStream) {
      const buf = chunk as Buffer
      loaded += buf.length
      armIdle()
      if (onProgress && loaded - lastProgress >= totalBytes / 100) {
        lastProgress = loaded
        onProgress({ loaded, total: totalBytes, percent: Math.min(100, (loaded / totalBytes) * 100) })
      }
      yield buf
    }
    if (onProgress && lastProgress < totalBytes) {
      onProgress({ loaded: totalBytes, total: totalBytes, percent: 100 })
    }
    yield footer
  }

  const controller = new AbortController()
  const abort = (): void => controller.abort(new Error('Upload timed out'))
  const absoluteTimer = setTimeout(abort, UPLOAD_TIMEOUT_MS)
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const armIdle = (): void => {
    clearTimeout(idleTimer)
    idleTimer = setTimeout(abort, UPLOAD_IDLE_TIMEOUT_MS)
  }
  armIdle()
  const onExternalAbort = (): void => controller.abort(new Error('Aborted'))
  if (signal?.aborted) {
    controller.abort(new Error('Aborted'))
  } else {
    signal?.addEventListener('abort', onExternalAbort, { once: true })
  }

  try {
    const res = await fetch(UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
        'User-Agent': 'Mozilla/5.0',
      },
      body: Readable.toWeb(Readable.from(body())) as unknown as BodyInit,
      duplex: 'half',
      signal: controller.signal,
    } as unknown as RequestInit)
    const text = await res.text()
    if (res.status !== 200) {
      getLogger().warning('ClipPublish', `gofile upload failed (HTTP ${res.status}): ${text.slice(0, 200)}`)
      return { success: false, error: `Upload failed (HTTP ${res.status})` }
    }
    try {
      const parsed = JSON.parse(text) as { status?: string; data?: { downloadPage?: string } }
      const link = parsed.data?.downloadPage
      if (parsed.status === 'ok' && link) {
        return { success: true, link }
      }
      getLogger().warning('ClipPublish', `gofile upload unexpected response: ${text.slice(0, 200)}`)
      return { success: false, error: 'Upload response was invalid' }
    } catch {
      getLogger().warning('ClipPublish', `gofile upload returned non-JSON: ${text.slice(0, 200)}`)
      return { success: false, error: 'Upload response was invalid' }
    }
  } catch (err) {
    const e = err as NodeJS.ErrnoException
    const message =
      e.message === 'Upload timed out' || e.message === 'Aborted'
        ? e.message
        : e.code === 'ECONNRESET'
          ? 'Connection lost during upload'
          : e.message
    if (message === 'Aborted') {
      getLogger().info('ClipPublish', `gofile upload cancelled for '${basename(filePath)}'`)
      return { success: false, cancelled: true, error: 'Upload cancelled' }
    }
    getLogger().error('ClipPublish', `gofile upload error: ${e.message}`)
    return { success: false, error: message }
  } finally {
    clearTimeout(absoluteTimer)
    clearTimeout(idleTimer)
    signal?.removeEventListener('abort', onExternalAbort)
    fileStream.destroy()
  }
}
