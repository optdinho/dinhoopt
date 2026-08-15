import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { E2E_MARKER_FILENAME } from '../src/shared/e2e-license-marker'

export function createLicenseE2EMarker(userDataDir: string): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(join(userDataDir, E2E_MARKER_FILENAME), String(Date.now()), 'utf-8')
}
