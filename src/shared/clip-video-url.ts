export const CLIP_VIDEO_SCHEME = 'clip-video'

export function buildClipVideoUrl(clipPath: string): string {
  return `${CLIP_VIDEO_SCHEME}://file?path=${encodeURIComponent(clipPath)}`
}

export function decodeClipVideoPath(url: string): string | null {
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== `${CLIP_VIDEO_SCHEME}:`) return null
    return parsed.searchParams.get('path')
  } catch {
    return null
  }
}
