import { createReadStream, statSync } from 'node:fs'
import { basename } from 'node:path'
import { request } from 'node:https'
import { getLogger } from './logger.service'

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

export function uploadClipToGofile(
  filePath: string,
  onProgress?: (p: PublishProgress) => void,
  signal?: AbortSignal,
): Promise<PublishResult> {
  return new Promise<PublishResult>((resolve) => {
    let totalBytes: number
    try {
      totalBytes = statSync(filePath).size
    } catch {
      resolve({ success: false, error: 'File not found' })
      return
    }

    const fileName = basename(filePath)
    const header = buildMultipartHeader(fileName)
    const footer = buildMultipartFooter()
    const contentLength = Buffer.byteLength(header) + totalBytes + Buffer.byteLength(footer)

    const req = request(
      UPLOAD_URL,
      {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${BOUNDARY}`,
          'Content-Length': String(contentLength),
          'User-Agent': 'Mozilla/5.0',
        },
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('error', (err: NodeJS.ErrnoException) => {
          const message = err.code === 'ECONNRESET' ? 'Connection lost during upload' : err.message
          getLogger().error('ClipPublish', `gofile response error: ${err.message}`)
          resolve({ success: false, error: message })
        })
        res.on('data', (chunk: Buffer) => chunks.push(chunk))
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8')
          if (res.statusCode !== 200) {
            getLogger().warning(
              'ClipPublish',
              `gofile upload failed (HTTP ${res.statusCode}): ${body.slice(0, 200)}`,
            )
            resolve({ success: false, error: `Upload failed (HTTP ${res.statusCode})` })
            return
          }
          try {
            const parsed = JSON.parse(body) as { status?: string; data?: { downloadPage?: string } }
            const link = parsed.data?.downloadPage
            if (parsed.status === 'ok' && link) {
              resolve({ success: true, link })
            } else {
              getLogger().warning('ClipPublish', `gofile upload unexpected response: ${body.slice(0, 200)}`)
              resolve({ success: false, error: 'Upload response was invalid' })
            }
          } catch {
            getLogger().warning('ClipPublish', `gofile upload returned non-JSON: ${body.slice(0, 200)}`)
            resolve({ success: false, error: 'Upload response was invalid' })
          }
        })
      },
    )

    req.setTimeout(120_000, () => {
      req.destroy(new Error('Upload timed out'))
    })

    req.on('error', (err: NodeJS.ErrnoException) => {
      const message = err.code === 'ECONNRESET' ? 'Connection lost during upload' : err.message
      getLogger().error('ClipPublish', `gofile upload error: ${err.message}`)
      resolve({ success: false, error: message })
    })

    if (signal) {
      const abort = (): void => {
        req.destroy(new Error('Aborted'))
      }
      if (signal.aborted) {
        abort()
      } else {
        signal.addEventListener('abort', abort, { once: true })
      }
    }

    req.write(header)

    const stream = createReadStream(filePath)
    let loaded = 0
    let lastProgress = 0
    stream.on('data', (chunk: Buffer) => {
      loaded += chunk.length
      if (onProgress && loaded - lastProgress >= totalBytes / 100) {
        lastProgress = loaded
        onProgress({ loaded, total: totalBytes, percent: Math.min(100, (loaded / totalBytes) * 100) })
      }
    })
    stream.on('error', (err: NodeJS.ErrnoException) => {
      req.destroy(err)
      resolve({ success: false, error: err.message })
    })
    stream.on('end', () => {
      if (onProgress) {
        onProgress({ loaded: totalBytes, total: totalBytes, percent: 100 })
      }
      req.end(footer)
    })

    stream.pipe(req, { end: false })
  })
}
