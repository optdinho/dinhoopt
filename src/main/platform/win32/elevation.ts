import { execFileSync } from 'node:child_process'
import path from 'node:path'
import type { PlatformElevation } from '../types'

let _isAdmin: boolean | null = null
let _lastCheck = 0
const CACHE_TTL_MS = 60_000

function getWhoamiPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'whoami.exe')
}

export function createWin32Elevation(): PlatformElevation {
  return {
    isAdmin(): boolean {
      const now = Date.now()
      if (_isAdmin !== null && now - _lastCheck < CACHE_TTL_MS) return _isAdmin

      try {
        const stdout = execFileSync(getWhoamiPath(), ['/groups'], { encoding: 'utf-8', stdio: 'pipe', timeout: 5000 })
        _isAdmin = stdout.includes('S-1-16-12288')
      } catch {
        _isAdmin = false
      }

      _lastCheck = Date.now()
      return _isAdmin
    },
  }
}
