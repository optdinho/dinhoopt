import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  statSync: vi.fn(),
  createReadStream: vi.fn(),
}))

vi.mock('node:stream', () => ({
  Readable: {
    from: vi.fn((iterable: unknown) => iterable),
    toWeb: vi.fn((stream: unknown) => stream),
  },
}))

const loggerSpies = vi.hoisted(() => ({
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => loggerSpies,
}))

import { createReadStream, statSync } from 'node:fs'
import {
  buildMultipartFooter,
  buildMultipartHeader,
  isRetryableStatus,
  MAX_UPLOAD_ATTEMPTS,
  RETRY_DELAYS_MS,
  serverErrorSnippet,
  uploadClipToGofile,
} from './clips-publish'

type AsyncChunks = {
  destroy: ReturnType<typeof vi.fn>
  [Symbol.asyncIterator]: () => AsyncIterator<Buffer>
}

const OK_BODY = JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/abc' } })

function makeAsyncChunks(chunks: Buffer[]): AsyncChunks {
  return {
    destroy: vi.fn(),
    async *[Symbol.asyncIterator]() {
      for (const c of chunks) yield c
    },
  }
}

function makeFetchResponse(status: number, body: string): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    text: async () => body,
  } as unknown as Response
}

function mockFetchReject(error: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      (_url: string, _init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          reject(error)
        }),
    ),
  )
}

function mockFetchAbortAware(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true })
      }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockFetchSlowAbortAware(response: Response, perChunkMs: number): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((resolve, reject) => {
        const signal = init?.signal
        const onAbort = () => reject(signal?.reason)
        if (signal?.aborted) {
          reject(signal.reason)
          return
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        void (async () => {
          const body = init?.body as AsyncIterable<Uint8Array> | undefined
          const footer = buildMultipartFooter()
          if (body) {
            for await (const _chunk of body) {
              if (Buffer.compare(Buffer.from(_chunk), Buffer.from(footer)) === 0) break
              await new Promise((r) => setTimeout(r, perChunkMs))
            }
          }
          signal?.removeEventListener('abort', onAbort)
          resolve(response)
        })()
      }),
  )
  vi.stubGlobal('fetch', fn)
  return fn
}

function mockFetchRespond(response: Response): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body as AsyncIterable<Uint8Array> | undefined
    if (body) {
      for await (const _chunk of body) {
        // drain the multipart body so the generator runs
      }
    }
    return response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

/** Returns the responses in order, repeating the last one once exhausted. */
function mockFetchSequence(responses: Response[]): ReturnType<typeof vi.fn> {
  let index = 0
  const fn = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = init?.body as AsyncIterable<Uint8Array> | undefined
    if (body) {
      for await (const _chunk of body) {
        // drain
      }
    }
    const response = responses[Math.min(index, responses.length - 1)]
    index += 1
    return response as Response
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

describe('buildMultipartHeader/Footer', () => {
  it('builds a header with the file name', () => {
    const header = buildMultipartHeader('clip.mp4')
    expect(header).toContain('name="file"')
    expect(header).toContain('filename="clip.mp4"')
    expect(header).toContain('Content-Type: application/octet-stream')
    expect(header.endsWith('\r\n\r\n')).toBe(true)
  })

  it('builds a closing footer', () => {
    const footer = buildMultipartFooter()
    expect(footer).toContain('--')
    expect(footer).toContain('--\r\n')
  })

  it('strips quotes and CR/LF from the file name', () => {
    const header = buildMultipartHeader('clip"evil\r\n.mp4')
    expect(header).toContain('filename="clipevil.mp4"')
    expect(header).not.toContain('"evil')
    expect(header).not.toContain('\r\n.mp4')
  })
})

describe('isRetryableStatus', () => {
  it('retries 5xx', () => {
    expect(isRetryableStatus(500)).toBe(true)
    expect(isRetryableStatus(502)).toBe(true)
    expect(isRetryableStatus(503)).toBe(true)
  })

  it('retries 429', () => {
    expect(isRetryableStatus(429)).toBe(true)
  })

  it('does not retry 2xx or other 4xx', () => {
    expect(isRetryableStatus(200)).toBe(false)
    expect(isRetryableStatus(400)).toBe(false)
    expect(isRetryableStatus(403)).toBe(false)
    expect(isRetryableStatus(404)).toBe(false)
  })
})

describe('serverErrorSnippet', () => {
  it('flattens whitespace', () => {
    expect(serverErrorSnippet('  error\n\ncreateFolderResponse  ')).toBe('error createFolderResponse')
  })

  it('returns an empty string for a blank body', () => {
    expect(serverErrorSnippet('   \n\t ')).toBe('')
  })

  it('truncates a long body with an ellipsis', () => {
    const snippet = serverErrorSnippet('x'.repeat(200))
    expect(snippet).toHaveLength(81)
    expect(snippet.endsWith('…')).toBe(true)
  })
})

describe('uploadClipToGofile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(statSync).mockReturnValue({ size: 1000 } as ReturnType<typeof statSync>)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('resolves file-not-found when statSync throws', async () => {
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const fetchMock = mockFetchRespond(makeFetchResponse(200, '{}'))
    const result = await uploadClipToGofile('C:\\missing.mp4')
    expect(result).toEqual({ success: false, error: 'File not found' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves a link on HTTP 200 with valid JSON', async () => {
    mockFetchRespond(makeFetchResponse(200, OK_BODY))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4')
    expect(result).toEqual({ success: true, link: 'https://gofile.io/d/abc' })
  })

  it('logs the start and the successful end of an upload', async () => {
    mockFetchRespond(makeFetchResponse(200, OK_BODY))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)
    await uploadClipToGofile('C:\\clips\\clip.mp4')

    expect(loggerSpies.info).toHaveBeenCalledWith(
      'ClipPublish',
      expect.stringContaining("gofile upload start: 'clip.mp4' (1000 bytes)"),
    )
    expect(loggerSpies.info).toHaveBeenCalledWith(
      'ClipPublish',
      expect.stringContaining("gofile upload ok: 'clip.mp4'"),
    )
  })

  it('retries 3 times on HTTP 500 and reports the server snippet', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchRespond(makeFetchResponse(500, 'error-createFolderResponse'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    await vi.advanceTimersByTimeAsync(8_000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(MAX_UPLOAD_ATTEMPTS)
    expect(result).toEqual({
      success: false,
      error: 'Upload failed (HTTP 500): error-createFolderResponse',
    })
    expect(loggerSpies.warning).toHaveBeenCalledWith(
      'ClipPublish',
      expect.stringContaining(`attempt 1/${MAX_UPLOAD_ATTEMPTS} failed`),
    )
    expect(loggerSpies.error).toHaveBeenCalledWith(
      'ClipPublish',
      expect.stringContaining("gofile upload failed: 'clip.mp4' (1000 bytes)"),
    )
  })

  it('succeeds on a retry after a transient 500', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchSequence([
      makeFetchResponse(500, 'error-createFolderResponse'),
      makeFetchResponse(200, OK_BODY),
    ])
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] as number)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ success: true, link: 'https://gofile.io/d/abc' })
  })

  it('retries 429 as well', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchRespond(makeFetchResponse(429, 'too many requests'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    await vi.advanceTimersByTimeAsync(8_000)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(MAX_UPLOAD_ATTEMPTS)
    expect(result.error).toBe('Upload failed (HTTP 429): too many requests')
  })

  it('does not retry a 4xx response', async () => {
    const fetchMock = mockFetchRespond(makeFetchResponse(400, 'bad request'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const result = await uploadClipToGofile('C:\\clips\\clip.mp4')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: false, error: 'Upload failed (HTTP 400): bad request' })
  })

  it('cancels when aborted during the retry backoff', async () => {
    vi.useFakeTimers()
    const fetchMock = mockFetchRespond(makeFetchResponse(500, 'boom'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const controller = new AbortController()
    const promise = uploadClipToGofile('C:\\clips\\clip.mp4', undefined, controller.signal)
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    controller.abort()
    await vi.advanceTimersByTimeAsync(RETRY_DELAYS_MS[0] as number)
    const result = await promise

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ success: false, cancelled: true, error: 'Upload cancelled' })
  })

  it('resolves invalid response for non-JSON body', async () => {
    mockFetchRespond(makeFetchResponse(200, '<html>not json</html>'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4')
    expect(result).toEqual({ success: false, error: 'Upload response was invalid' })
  })

  it('resolves invalid response when status is not ok', async () => {
    mockFetchRespond(makeFetchResponse(200, JSON.stringify({ status: 'error' })))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4')
    expect(result).toEqual({ success: false, error: 'Upload response was invalid' })
  })

  it('maps ECONNRESET to a friendly message', async () => {
    mockFetchReject(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4')
    expect(result).toEqual({ success: false, error: 'Connection lost during upload' })
  })

  it('maps generic errors to their message', async () => {
    mockFetchReject(new Error('ENOTFOUND'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4')
    expect(result).toEqual({ success: false, error: 'ENOTFOUND' })
  })

  it('resolves a timeout at the absolute 600s limit', async () => {
    vi.useFakeTimers()
    mockFetchAbortAware()
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    await vi.advanceTimersByTimeAsync(600_000)
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Upload timed out' })
  })

  it('does not time out at 120s while upload keeps progressing', async () => {
    vi.useFakeTimers()
    mockFetchSlowAbortAware(makeFetchResponse(200, OK_BODY), 50_000)
    vi.mocked(createReadStream).mockReturnValue(
      makeAsyncChunks([Buffer.alloc(250), Buffer.alloc(250), Buffer.alloc(250), Buffer.alloc(250)]) as never,
    )

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    await vi.advanceTimersByTimeAsync(260_000)
    const result = await promise
    expect(result).toEqual({ success: true, link: 'https://gofile.io/d/abc' })
  })

  it('aborts after 60s of idle upload with no progress', async () => {
    vi.useFakeTimers()
    mockFetchAbortAware()
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    await vi.advanceTimersByTimeAsync(60_000)
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Upload timed out' })
  })

  it('resolves aborted when the signal is already aborted', async () => {
    mockFetchReject(new Error('Aborted'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const controller = new AbortController()
    controller.abort()
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4', undefined, controller.signal)
    expect(result).toEqual({ success: false, cancelled: true, error: 'Upload cancelled' })
  })

  it('emits progress at 1% thresholds and 100% on end', async () => {
    mockFetchRespond(makeFetchResponse(200, OK_BODY))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(400), Buffer.alloc(600)]) as never)

    const progress: { loaded: number; percent: number }[] = []
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4', (p) => progress.push(p))

    expect(result.success).toBe(true)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[0]!.percent).toBe(40)
    expect(progress.at(-1)).toEqual({ loaded: 1000, total: 1000, percent: 100 })
  })
})
