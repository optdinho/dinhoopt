import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join, resolve, sep } from 'node:path'
import { app } from 'electron'
import { getLogger } from './logger.service'

const MAX_RULE_FILE_SIZE = 1_048_576 // 1 MB
const MAX_RULE_COUNT = 100

export class CustomYaraService {
  private customRulesDir: string

  constructor() {
    this.customRulesDir = join(app.getPath('userData'), 'custom-yara-rules')
    this.ensureDir()
  }

  private ensureDir(): void {
    if (!existsSync(this.customRulesDir)) {
      mkdirSync(this.customRulesDir, { recursive: true })
    }
  }

  getRulesDir(): string {
    return this.customRulesDir
  }

  // Resolves a rule name to an absolute path contained within the rules
  // directory. Rejects separators, traversal and anything that would escape it.
  private safeRulePath(name: string): string | null {
    if (typeof name !== 'string') return null
    const trimmed = name.trim()
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) return null
    const fileName = trimmed.endsWith('.yar') || trimmed.endsWith('.yara') ? trimmed : `${trimmed}.yar`
    const fullPath = resolve(this.customRulesDir, fileName)
    const root = this.customRulesDir.endsWith(sep) ? this.customRulesDir : `${this.customRulesDir}${sep}`
    if (!fullPath.startsWith(root)) return null
    return fullPath
  }

  getCustomRules(): { name: string; content: string; size: number; addedAt: Date }[] {
    this.ensureDir()
    const files = readdirSync(this.customRulesDir).filter((f) => f.endsWith('.yar') || f.endsWith('.yara'))
    return files.map((name) => {
      const fullPath = join(this.customRulesDir, name)
      const content = readFileSync(fullPath, 'utf-8')
      return { name, content, size: Buffer.byteLength(content, 'utf-8'), addedAt: new Date() }
    })
  }

  addRule(name: string, content: string): boolean {
    if (typeof content !== 'string' || !content.toLowerCase().includes('rule ')) return false

    const filePath = this.safeRulePath(name)
    if (!filePath) {
      getLogger().warning('custom-yara', `Rule rejected: invalid name "${String(name)}"`)
      return false
    }
    const ruleName = basename(filePath)

    // Enforce max file size (1 MB)
    if (Buffer.byteLength(content, 'utf-8') > MAX_RULE_FILE_SIZE) {
      getLogger().warning('custom-yara', `Rule "${ruleName}" rejected: file size exceeds 1 MB limit`)
      return false
    }

    // Enforce max rule count (100 rules per custom set)
    const currentCount = this.getRuleCount()
    if (currentCount >= MAX_RULE_COUNT) {
      getLogger().warning('custom-yara', `Rule "${ruleName}" rejected: max ${MAX_RULE_COUNT} rules per custom set`)
      return false
    }

    this.ensureDir()
    try {
      writeFileSync(filePath, content, 'utf-8')
      return true
    } catch (err) {
      getLogger().warning('custom-yara', `Rule "${ruleName}" could not be written: ${String(err)}`)
      return false
    }
  }

  removeRule(name: string): boolean {
    const filePath = this.safeRulePath(name)
    if (!filePath) {
      getLogger().warning('custom-yara', `Rule remove rejected: invalid name "${String(name)}"`)
      return false
    }
    if (!existsSync(filePath)) return false
    try {
      unlinkSync(filePath)
      return true
    } catch (err) {
      getLogger().warning('custom-yara', `Rule "${basename(filePath)}" could not be removed: ${String(err)}`)
      return false
    }
  }

  getRuleCount(): number {
    this.ensureDir()
    return readdirSync(this.customRulesDir).filter((f) => f.endsWith('.yar') || f.endsWith('.yara')).length
  }
}

export const customYaraService = new CustomYaraService()
