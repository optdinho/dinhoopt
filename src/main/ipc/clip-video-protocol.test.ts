import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  buildClipVideoUrl,
  CLIP_VIDEO_SCHEME,
  decodeClipVideoPath,
  handleClipVideoRequest,
} from './clip-video-protocol'

const tempDir = mkdtempSync(join(tmpdir(), 'clip-video-protocol-'))

vi.mock('../services/clips-config-manager', () => ({
  clipPathInOutputDir: (inputPath: string) => {
    const resolved = resolve(inputPath)
    return resolved.toLowerCase().startsWith(tempDir.toLowerCase()) ? resolved : null
  },
}))

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

const sample = join(tempDir, 'sample.mp4')
writeFileSync(sample, Buffer.alloc(1000, 0x41))

function makeRequest(url: string, range?: string): Request {
  return new Request(url, { headers: range ? { range } : {} })
}

describe('clip-video-protocol', () => {
  it('buildClipVideoUrl round-trips through decodeClipVideoPath', () => {
    const url = buildClipVideoUrl('C:\\Users\\test\\my clip.mp4')
    expect(url.startsWith(`${CLIP_VIDEO_SCHEME}://file?path=`)).toBe(true)
    expect(decodeClipVideoPath(url)).toBe('C:\\Users\\test\\my clip.mp4')
  })

  it('decodeClipVideoPath returns null for wrong protocol', () => {
    expect(decodeClipVideoPath('file:///C:/test/clip.mp4')).toBeNull()
  })

  it('decodeClipVideoPath returns null for malformed URL', () => {
    expect(decodeClipVideoPath('not a url')).toBeNull()
  })

  it('decodeClipVideoPath returns null when path param is missing', () => {
    expect(decodeClipVideoPath('clip-video://file')).toBeNull()
  })

  it('serves full file with 200 when no range header', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample)))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('video/mp4')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('content-length')).toBe('1000')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBe(1000)
  })

  it('serves partial content with 206 and content-range', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample), 'bytes=100-199'))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 100-199/1000')
    expect(res.headers.get('content-length')).toBe('100')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf.length).toBe(100)
    expect(buf.every((b) => b === 0x41)).toBe(true)
  })

  it('clamps range end to file size', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample), 'bytes=900-99999'))
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 900-999/1000')
  })

  it('returns 416 when start is beyond file size', async () => {
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(sample), 'bytes=1000-2000'))
    expect(res.status).toBe(416)
  })

  it('returns 400 when path param is missing', async () => {
    const res = await handleClipVideoRequest(makeRequest(`${CLIP_VIDEO_SCHEME}://file`))
    expect(res.status).toBe(400)
  })

  it('returns 404 for nonexistent file', async () => {
    const missing = join(tempDir, 'missing.mp4')
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(missing)))
    expect(res.status).toBe(404)
  })

  it('returns 403 for a path outside the clips output directory', async () => {
    const outside = join(tmpdir(), 'outside-clips', 'secret.mp4')
    const res = await handleClipVideoRequest(makeRequest(buildClipVideoUrl(outside)))
    expect(res.status).toBe(403)
  })
})
