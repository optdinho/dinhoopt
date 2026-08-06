import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', () => ({
  statSync: vi.fn(),
  createReadStream: vi.fn(),
}))

vi.mock('node:https', () => ({
  request: vi.fn(),
}))

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

import { createReadStream, statSync } from 'node:fs'
import { request } from 'node:https'
import {
  buildMultipartFooter,
  buildMultipartHeader,
  uploadClipToGofile,
} from './clips-publish'

function makeStream(): EventEmitter & { pipe: (dest: unknown, opts?: unknown) => unknown } {
  const stream = new EventEmitter() as EventEmitter & {
    pipe: (dest: unknown, opts?: unknown) => unknown
  }
  stream.pipe = vi.fn(() => stream)
  return stream
}

function makeReq(): {
  req: Record<string, ReturnType<typeof vi.fn>>
  emitError: (err: NodeJS.ErrnoException) => void
} {
  let onError: (err: NodeJS.ErrnoException) => void = () => {}
  const req = {
    write: vi.fn(),
    end: vi.fn(),
    destroy: vi.fn((err?: Error) => {
      if (err) onError(err as NodeJS.ErrnoException)
      return req
    }),
    setTimeout: vi.fn(),
    on: vi.fn((_event: string, cb: (err: NodeJS.ErrnoException) => void) => {
      if (_event === 'error') onError = cb
      return req
    }),
  }
  return { req, emitError: (err) => onError(err) }
}

function makeRes(statusCode: number, body: string): EventEmitter {
  const res = new EventEmitter() as EventEmitter & { statusCode: number }
  ;(res as unknown as { statusCode: number }).statusCode = statusCode
  return res
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

  it('resolves file-not-found when statSync throws', async () => {
    vi.mocked(statSync).mockImplementation(() => {
      throw new Error('ENOENT')
    })
    const result = await uploadClipToGofile('C:\\missing.mp4')
    expect(result).toEqual({ success: false, error: 'File not found' })
    expect(request).not.toHaveBeenCalled()
  })

  it('resolves a link on HTTP 200 with valid JSON', async () => {
    const { req } = makeReq()
    let res: EventEmitter
    vi.mocked(request).mockImplementation((_url: string, _opts: unknown, cb: (r: EventEmitter) => void) => {
      res = makeRes(200, JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/abc' } }))
      cb(res)
      return req
    })
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    stream.emit('data', Buffer.alloc(1000))
    stream.emit('end')
    res!.emit('data', Buffer.from(JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/abc' } })))
    res!.emit('end')
    const result = await promise
    expect(result).toEqual({ success: true, link: 'https://gofile.io/d/abc' })
  })

  it('resolves HTTP error status', async () => {
    const { req } = makeReq()
    let res: EventEmitter
    vi.mocked(request).mockImplementation((_url: string, _opts: unknown, cb: (r: EventEmitter) => void) => {
      res = makeRes(500, 'oops')
      cb(res)
      return req
    })
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    stream.emit('data', Buffer.alloc(1000))
    stream.emit('end')
    res!.emit('data', Buffer.from('oops'))
    res!.emit('end')
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Upload failed (HTTP 500)' })
  })

  it('resolves invalid response for non-JSON body', async () => {
    const { req } = makeReq()
    let res: EventEmitter
    vi.mocked(request).mockImplementation((_url: string, _opts: unknown, cb: (r: EventEmitter) => void) => {
      res = makeRes(200, '<html>not json</html>')
      cb(res)
      return req
    })
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    stream.emit('data', Buffer.alloc(1000))
    stream.emit('end')
    res!.emit('data', Buffer.from('<html>not json</html>'))
    res!.emit('end')
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Upload response was invalid' })
  })

  it('resolves invalid response when status is not ok', async () => {
    const { req } = makeReq()
    let res: EventEmitter
    vi.mocked(request).mockImplementation((_url: string, _opts: unknown, cb: (r: EventEmitter) => void) => {
      res = makeRes(200, JSON.stringify({ status: 'error' }))
      cb(res)
      return req
    })
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    stream.emit('data', Buffer.alloc(1000))
    stream.emit('end')
    res!.emit('data', Buffer.from(JSON.stringify({ status: 'error' })))
    res!.emit('end')
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Upload response was invalid' })
  })

  it('maps ECONNRESET to a friendly message', async () => {
    const { req, emitError } = makeReq()
    vi.mocked(request).mockImplementation(() => req as never)
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    emitError(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Connection lost during upload' })
  })

  it('resolves on response-stream error', async () => {
    const { req } = makeReq()
    let res: EventEmitter
    vi.mocked(request).mockImplementation((_url: string, _opts: unknown, cb: (r: EventEmitter) => void) => {
      res = makeRes(200, 'partial body')
      cb(res)
      return req
    })
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    stream.emit('data', Buffer.alloc(1000))
    stream.emit('end')
    res!.emit('error', Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
    const result = await promise
    expect(result).toEqual({ success: false, error: 'Connection lost during upload' })
  })

  it('maps generic errors to their message', async () => {
    const { req, emitError } = makeReq()
    vi.mocked(request).mockImplementation(() => req as never)
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    emitError(new Error('ENOTFOUND'))
    const result = await promise
    expect(result).toEqual({ success: false, error: 'ENOTFOUND' })
  })

  it('resolves on stream read error', async () => {
    const { req } = makeReq()
    vi.mocked(request).mockImplementation(() => req as never)
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    stream.emit('error', new Error('EACCES'))
    const result = await promise
    expect(result).toEqual({ success: false, error: 'EACCES' })
  })

  it('sets a 120s timeout that destroys the request', async () => {
    const { req } = makeReq()
    vi.mocked(request).mockImplementation((_url: string, _opts: unknown, cb: () => void) => {
      cb(makeRes(200, JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/abc' } })))
      return req
    })
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const promise = uploadClipToGofile('C:\\clips\\clip.mp4')
    stream.emit('data', Buffer.alloc(1000))
    stream.emit('end')

    expect(req.setTimeout).toHaveBeenCalledWith(120_000, expect.any(Function))
    const timeoutCb = vi.mocked(req.setTimeout).mock.calls[0]![1] as () => void
    timeoutCb()
    expect(req.destroy).toHaveBeenCalled()

    const result = await promise
    expect(result.success).toBe(false)
    expect(result.error).toBe('Upload timed out')
  })

  it('destroys the request when the abort signal is already aborted', async () => {
    const { req } = makeReq()
    vi.mocked(request).mockImplementation(() => req as never)
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const controller = new AbortController()
    controller.abort()
    const promise = uploadClipToGofile('C:\\clips\\clip.mp4', undefined, controller.signal)
    expect(req.destroy).toHaveBeenCalled()
    await promise
  })

  it('emits progress at 1% thresholds and 100% on end', async () => {
    const { req } = makeReq()
    let res: EventEmitter
    vi.mocked(request).mockImplementation((_url: string, _opts: unknown, cb: (r: EventEmitter) => void) => {
      res = makeRes(200, JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/abc' } }))
      cb(res)
      return req
    })
    const stream = makeStream()
    vi.mocked(createReadStream).mockReturnValue(stream as never)

    const progress: { loaded: number; percent: number }[] = []
    const promise = uploadClipToGofile('C:\\clips\\clip.mp4', (p) => progress.push(p))

    stream.emit('data', Buffer.alloc(400))
    stream.emit('data', Buffer.alloc(600))
    stream.emit('end')
    res!.emit('data', Buffer.from(JSON.stringify({ status: 'ok', data: { downloadPage: 'https://gofile.io/d/abc' } })))
    res!.emit('end')
    await promise

    expect(progress.length).toBeGreaterThan(0)
    expect(progress[0]!.percent).toBe(40)
    expect(progress.at(-1)).toEqual({ loaded: 1000, total: 1000, percent: 100 })
  })
})
