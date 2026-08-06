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

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

import { createReadStream, statSync } from 'node:fs'
import { buildMultipartFooter, buildMultipartHeader, uploadClipToGofile } from './clips-publish'

type AsyncChunks = {
  destroy: ReturnType<typeof vi.fn>
  [Symbol.asyncIterator]: () => AsyncIterator<Buffer>
}

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
    mockFetchRespond(
      makeFetchResponse(200, JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/abc' } })),
    )
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4')
    expect(result).toEqual({ success: true, link: 'https://gofile.io/d/abc' })
  })

  it('resolves HTTP error status', async () => {
    mockFetchRespond(makeFetchResponse(500, 'oops'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4')
    expect(result).toEqual({ success: false, error: 'Upload failed (HTTP 500)' })
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

  it('resolves a timeout after 120s', async () => {
    vi.useFakeTimers()
    mockFetchReject(new Error('Upload timed out'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    await vi.advanceTimersByTimeAsync(120_000)
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Upload timed out' })
  })

  it('resolves aborted when the signal is already aborted', async () => {
    mockFetchReject(new Error('Aborted'))
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(1000)]) as never)

    const controller = new AbortController()
    controller.abort()
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4', undefined, controller.signal)
    expect(result).toEqual({ success: false, error: 'Aborted' })
  })

  it('emits progress at 1% thresholds and 100% on end', async () => {
    mockFetchRespond(
      makeFetchResponse(200, JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/abc' } })),
    )
    vi.mocked(createReadStream).mockReturnValue(makeAsyncChunks([Buffer.alloc(400), Buffer.alloc(600)]) as never)

    const progress: { loaded: number; percent: number }[] = []
    const result = await uploadClipToGofile('C:\\clips\\clip.mp4', (p) => progress.push(p))

    expect(result.success).toBe(true)
    expect(progress.length).toBeGreaterThan(0)
    expect(progress[0]!.percent).toBe(40)
    expect(progress.at(-1)).toEqual({ loaded: 1000, total: 1000, percent: 100 })
  })
})
