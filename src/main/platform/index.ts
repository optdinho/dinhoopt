import type { PlatformProvider } from './types'
import { createWin32Provider } from './win32'

let _provider: PlatformProvider | null = null

/**
 * Returns the Win32 platform provider.
 * Lazy-initialized singleton — safe to call repeatedly.
 * This build targets Windows only — darwin/linux removed.
 */
export function getPlatform(): PlatformProvider {
  if (_provider) return _provider
  if (process.platform !== 'win32') {
    throw new Error(`This build targets Windows only. Current platform: ${process.platform}`)
  }
  _provider = createWin32Provider()
  return _provider!
}

export type { PlatformProvider } from './types'
