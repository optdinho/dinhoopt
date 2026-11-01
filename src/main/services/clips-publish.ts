import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import { Readable } from 'node:stream'
import { getLogger } from './logger.service'

const UPLOAD_TIMEOUT_MS = 600_000
const UPLOAD_IDLE_TIMEOUT_MS = 60_000

const UPLOAD_URL = 'https://upload.gofile.io/uploadfile'
const BOUNDARY = `----DiNhoClipUpload${Date.now().toString(36)}`

/** One try plus two retries. A 500 from gofile is usually transient. */
export const MAX_UPLOAD_ATTEMPTS = 3
/** Backoff before each retry, indexed by the attempt that just failed. */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 5_000]
/** Longest server message echoed back to the UI. */
const MAX_ERROR_SNIPPET = 80

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

/**
 * 5xx and 429 are worth retrying: gofile answers 500 while its folder service
 * hiccups (observed 2026-10-31 23:42: "error-createFolderResponse"). Anything
 * else — 4xx, timeouts, aborts — is deterministic and retrying only wastes
 * bandwidth on a file that can be hundreds of megabytes.
 */
export function isRetryableStatus(status: number): boolean {
  return status >= 500 || status === 429
}

/** Flattens the server body into a short suffix for the UI error message. */
export function serverErrorSnippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  return flat.length > MAX_ERROR_SNIPPET ? `${flat.slice(0, MAX_ERROR_SNIPPET)}…` : flat
}

interface AttemptOutcome {
  result: PublishResult
  retryable: boolean
}

async function attemptUpload(
  filePath: string,
  fileName: string,
  totalBytes: number,
  onProgress?: (p: PublishProgress) => void,
  signal?: AbortSignal,
): Promise<AttemptOutcome> {
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
      const snippet = serverErrorSnippet(text)
      return {
        result: {
          success: false,
          error: snippet ? `Upload failed (HTTP ${res.status}): ${snippet}` : `Upload failed (HTTP ${res.status})`,
        },
        retryable: isRetryableStatus(res.status),
      }
    }
    try {
      const parsed = JSON.parse(text) as { status?: string; data?: { downloadPage?: string } }
      const link = parsed.data?.downloadPage
      if (parsed.status === 'ok' && link) {
        return { result: { success: true, link }, retryable: false }
      }
      getLogger().warning('ClipPublish', `gofile upload unexpected response: ${text.slice(0, 200)}`)
      return { result: { success: false, error: 'Upload response was invalid' }, retryable: false }
    } catch {
      getLogger().warning('ClipPublish', `gofile upload returned non-JSON: ${text.slice(0, 200)}`)
      return { result: { success: false, error: 'Upload response was invalid' }, retryable: false }
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
      return { result: { success: false, cancelled: true, error: 'Upload cancelled' }, retryable: false }
    }
    getLogger().error('ClipPublish', `gofile upload error: ${e.message}`)
    return { result: { success: false, error: message }, retryable: false }
  } finally {
    clearTimeout(absoluteTimer)
    clearTimeout(idleTimer)
    signal?.removeEventListener('abort', onExternalAbort)
    fileStream.destroy()
  }
}

/** Waits `ms`, resolving true if the caller aborted in the meantime. */
function delayOrAbort(ms: number, signal?: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(true)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => {
      if (timer) clearTimeout(timer)
      resolve(true)
    }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(false)
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
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
  const startedAt = Date.now()
  // Successful uploads used to leave no trace at all, so a user report like
  // "the upload failed yesterday" could not be matched to a file or a size.
  getLogger().info('ClipPublish', `gofile upload start: '${fileName}' (${totalBytes} bytes)`)

  const cancelled = (): PublishResult => {
    getLogger().info('ClipPublish', `gofile upload cancelled for '${fileName}'`)
    return { success: false, cancelled: true, error: 'Upload cancelled' }
  }

  let outcome: AttemptOutcome | undefined
  for (let attempt = 1; attempt <= MAX_UPLOAD_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) return cancelled()

    outcome = await attemptUpload(filePath, fileName, totalBytes, onProgress, signal)
    if (outcome.result.cancelled) return cancelled()
    if (outcome.result.success || !outcome.retryable) break

    const delay = RETRY_DELAYS_MS[attempt - 1]
    if (attempt === MAX_UPLOAD_ATTEMPTS || delay === undefined) break

    getLogger().warning(
      'ClipPublish',
      `gofile upload attempt ${attempt}/${MAX_UPLOAD_ATTEMPTS} failed (${outcome.result.error}); retrying in ${delay}ms`,
    )
    if (await delayOrAbort(delay, signal)) return cancelled()
  }

  const result = outcome?.result ?? { success: false, error: 'Upload failed' }
  const elapsed = Date.now() - startedAt
  if (result.success) {
    getLogger().info('ClipPublish', `gofile upload ok: '${fileName}' in ${elapsed}ms -> ${result.link}`)
  } else {
    getLogger().error(
      'ClipPublish',
      `gofile upload failed: '${fileName}' (${totalBytes} bytes) after ${elapsed}ms — ${result.error}`,
    )
  }
  return result
}
