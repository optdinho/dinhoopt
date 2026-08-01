import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { buildClipVideoUrl, CLIP_VIDEO_SCHEME, decodeClipVideoPath } from '@shared/clip-video-url'

export { buildClipVideoUrl, CLIP_VIDEO_SCHEME, decodeClipVideoPath }

export async function handleClipVideoRequest(request: Request): Promise<Response> {
  const filePath = decodeClipVideoPath(request.url)
  if (!filePath) return new Response('bad request', { status: 400 })

  let fileSize: number
  try {
    fileSize = (await stat(filePath)).size
  } catch {
    return new Response('not found', { status: 404 })
  }

  let start = 0
  let end = fileSize - 1
  let status = 200
  const range = request.headers.get('range')
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (match) {
      if (match[1]) start = Number(match[1])
      if (match[2]) end = Math.min(Number(match[2]), fileSize - 1)
      if (start >= fileSize) return new Response('range not satisfiable', { status: 416 })
      if (end < start) end = start
      status = 206
    }
  }

  const length = end - start + 1
  const nodeStream = createReadStream(filePath, { start, end })
  const body = Readable.toWeb(nodeStream) as unknown as BodyInit
  return new Response(body, {
    status,
    headers: {
      'content-type': 'video/mp4',
      'accept-ranges': 'bytes',
      'content-length': String(length),
      ...(status === 206 ? { 'content-range': `bytes ${start}-${end}/${fileSize}` } : {}),
    },
  })
}
