import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { get } from 'node:https'
import { join } from 'node:path'
import { getLogger } from '../services/logger.service'
import { convertWinapp2Vars, parseWinapp2 } from './winapp2-import.ipc'

export interface ImportedRule {
  subcategory: string
  path: string
  fileMask: string
  recurse: boolean
  removeSelf: boolean
}

const WINAPP2_RAW_URL = 'https://raw.githubusercontent.com/MoscaDotTo/Winapp2/master/Winapp2.ini'

let rules: ImportedRule[] = []
let cacheDirPath: string | null = null

function rulesCachePath(): string {
  return join(cacheDirPath || '', 'winapp2-rules.json')
}

function downloadUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    get(url, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    }).on('error', reject)
  })
}

export function initRulesStore(cacheDir: string): void {
  cacheDirPath = cacheDir
  if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true })
  }
}

export function loadCachedRules(): boolean {
  const cachePath = rulesCachePath()
  if (!existsSync(cachePath)) return false
  try {
    const data = readFileSync(cachePath, 'utf-8')
    rules = JSON.parse(data) as ImportedRule[]
    getLogger().info('winapp2-rules', `Loaded ${rules.length} cached rules from disk`)
    return true
  } catch {
    getLogger().warning('winapp2-rules', 'Failed to load cached rules, will re-download')
    return false
  }
}

function saveRulesToDisk(): void {
  try {
    writeFileSync(rulesCachePath(), JSON.stringify(rules), 'utf-8')
    getLogger().info('winapp2-rules', `Saved ${rules.length} rules to disk cache`)
  } catch (err) {
    getLogger().error('winapp2-rules', `Failed to save rules cache: ${err}`)
  }
}

export async function downloadAndCacheRules(): Promise<number> {
  getLogger().info('winapp2-rules', 'Downloading winapp2.ini from GitHub')
  const content = await downloadUrl(WINAPP2_RAW_URL)
  const result = parseWinapp2(content)
  rules = []
  for (const section of result.sections) {
    for (const fk of section.fileKeys) {
      rules.push({
        subcategory: section.sectionName,
        path: convertWinapp2Vars(fk.path),
        fileMask: fk.fileMask,
        recurse: fk.recurse,
        removeSelf: fk.removeSelf,
      })
    }
  }
  saveRulesToDisk()
  getLogger().success(
    'winapp2-rules',
    `Downloaded and cached ${rules.length} rules from ${result.totalSections} sections`,
  )
  return rules.length
}

export async function ensureRulesLoaded(cacheDir: string): Promise<void> {
  initRulesStore(cacheDir)
  if (loadCachedRules() && rules.length > 0) return
  try {
    await downloadAndCacheRules()
  } catch (err) {
    getLogger().error('winapp2-rules', `Failed to download winapp2.ini: ${err}`)
  }
}

export function getImportedRules(): ImportedRule[] {
  return rules
}

export function setImportedRules(newRules: ImportedRule[]): void {
  rules = newRules
  saveRulesToDisk()
}

export function clearImportedRules(): void {
  rules = []
  try {
    const cachePath = rulesCachePath()
    if (existsSync(cachePath)) writeFileSync(cachePath, '[]', 'utf-8')
  } catch {
    /* ignore */
  }
}

export function getCachedRulesCount(): number {
  return rules.length
}
