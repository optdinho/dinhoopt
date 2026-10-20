import { join, resolve } from 'node:path'
import { config } from './clips-config-schema'

/**
 * Output-directory resolution and clip path containment.
 *
 * Split out of `clips-config-manager.ts` (Fase 3, item 11). Reads `config` directly —
 * it does NOT import the manager, so there is no cycle (`schema ← paths ← manager`).
 * The manager re-exports both names, so no consumer import changes.
 */

export function getDefaultOutputDir(): string {
  if (config.outputDirectory) return config.outputDirectory
  const home =
    process.env.USERPROFILE ||
    (process.env.HOMEDRIVE && process.env.HOMEPATH ? process.env.HOMEDRIVE + process.env.HOMEPATH : undefined) ||
    process.cwd()
  // Default: %USERPROFILE%\Videos\DiNho Clips — pasta de vídeos do usuário (observável,
  // com nome da marca). O usuário muda pelo front (seletor de pasta) e o valor escolhido
  // persiste em config.outputDirectory, que tem precedência aqui.
  return join(home, 'Videos', 'DiNho Clips')
}

export function clipPathInOutputDir(inputPath: string): string | null {
  const outputDir = getDefaultOutputDir()
  try {
    const resolved = resolve(outputDir, inputPath)
    const normalized = outputDir.toLowerCase()
    const prefix = normalized.endsWith('\\') || normalized.endsWith('/') ? normalized : `${normalized}\\`
    const isDirItself = resolved.toLowerCase() === normalized
    if (!isDirItself && !resolved.toLowerCase().startsWith(prefix)) return null
    return resolved
  } catch {
    return null
  }
}
