import { execFile } from 'node:child_process'
import type { EnhanceOption } from '@shared/types/clips'

const ENHANCE_OPTIONS: readonly EnhanceOption[] = ['none', 'sr', 'frc', 'sr+frc']

export const AMD_VENDOR_ID = 0x1002

/** Max output resolution for sr_amf (upscale 2x capped at 1080p). */
export const SR_MAX_W = 1920
export const SR_MAX_H = 1080

/**
 * Validates an enhance value against the allowlist. Invalid/unknown values fall back to 'none'.
 */
export function parseEnhanceOption(value: unknown): EnhanceOption {
  return typeof value === 'string' && (ENHANCE_OPTIONS as readonly string[]).includes(value)
    ? (value as EnhanceOption)
    : 'none'
}

/**
 * Builds the AMF enhance `-vf` filter chain for a re-encode.
 *
 * - 'sr'     -> sr_amf (AMF HQ upscale, 2x capped at SR_MAX_W x SR_MAX_H, NV12 output)
 * - 'frc'    -> frc_amf (AMF frame-rate converter, motion search on full resolution)
 * - 'sr+frc' -> both chained
 *
 * Returns null when the enhance is 'none'/invalid or the source resolution is
 * unknown (dims <= 0), in which case the caller skips the filter entirely.
 */
export function buildAmfEnhanceVf(enhance: EnhanceOption, srcW: number, srcH: number): string | null {
  if (enhance === 'none' || (enhance !== 'sr' && enhance !== 'frc' && enhance !== 'sr+frc')) return null
  if (srcW <= 0 || srcH <= 0) return null

  const chain: string[] = []
  if (enhance === 'sr' || enhance === 'sr+frc') {
    const w = Math.min(srcW * 2, SR_MAX_W)
    const h = Math.min(srcH * 2, SR_MAX_H)
    chain.push(`sr_amf=w=${w}:h=${h}:format=nv12:algorithm=sr1-1`)
  }
  if (enhance === 'frc' || enhance === 'sr+frc') {
    chain.push('frc_amf=profile=high:fallback_mode=blend')
  }
  return chain.length > 0 ? chain.join(',') : null
}

/**
 * Normalizes a raw sharpness value (0..1) from IPC.
 *
 * - finite number -> clamped to [0, 1]
 * - anything else (undefined, string, NaN, Infinity, boolean) -> 0 (off)
 */
export function normalizeSharpness(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

/**
 * Appends a `cas` (Contrast Adaptive Sharpening) filter to a `-vf` filter chain.
 *
 * - strength <= 0 or NaN -> the chain is returned unchanged (sharpening off)
 * - strength > 1          -> clamped to 1
 * - strength is formatted with a decimal point (JS number toString is
 *   locale-independent), so ffmpeg always parses it correctly
 *
 * Returns null when the chain was null and the filter is off.
 */
export function appendSharpnessFilter(chain: string | null, strength: number): string | null {
  if (!Number.isFinite(strength) || strength <= 0) return chain
  const s = Math.min(1, strength)
  const cas = `cas=strength=${s}`
  return chain && chain.length > 0 ? `${chain},${cas}` : cas
}

export interface VideoResolution {
  w: number
  h: number
}

/**
 * Probes the video resolution of a file via `ffmpeg -i` (parses the first
 * `Stream #0:0: Video: ... WxH` from stderr). Returns null when it can't be
 * determined (missing stream, unparseable, spawn error, timeout).
 */
export function probeVideoResolution(ffmpegPath: string, filePath: string): Promise<VideoResolution | null> {
  return new Promise((resolve) => {
    execFile(
      ffmpegPath,
      ['-hide_banner', '-i', filePath],
      { timeout: 15_000 },
      (err, _stdout, stderr) => {
        if (err && !stderr) {
          resolve(null)
          return
        }
        const match = /Stream #\d+:\d+(?:\(\w+\))?: Video: .*?(\d{2,5})x(\d{2,5})/.exec(String(stderr ?? ''))
        if (!match) {
          resolve(null)
          return
        }
        const w = Number(match[1])
        const h = Number(match[2])
        resolve(w > 0 && h > 0 ? { w, h } : null)
      },
    )
  })
}
