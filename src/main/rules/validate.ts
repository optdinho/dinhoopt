import { readFileSync } from 'fs'
import { join } from 'path'

const SCHEMA_PATH = join(__dirname, '../../../rules/schema/rules.schema.json')

interface ValidationResult {
  valid: boolean
  errors: string[]
}

function main(): void {
  const args = process.argv.slice(2)
  const ruleFiles = args.length > 0 ? args : [join(__dirname, '../../../rules/rules.json')]

  let schema: Record<string, unknown>
  try {
    schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8'))
  } catch {
    console.error('Could not load schema from', SCHEMA_PATH)
    process.exit(1)
  }

  let allValid = true
  for (const file of ruleFiles) {
    const result = validateFile(file, schema)
    if (result.valid) {
      console.log(`✓ ${file}`)
    } else {
      console.error(`✗ ${file}`)
      for (const err of result.errors) {
        console.error(`  ${err}`)
      }
      allValid = false
    }
  }

  process.exit(allValid ? 0 : 1)
}

function validateFile(filePath: string, _schema: Record<string, unknown>): ValidationResult {
  let content: unknown
  try {
    content = JSON.parse(readFileSync(filePath, 'utf-8'))
  } catch {
    return { valid: false, errors: [`Failed to parse ${filePath}`] }
  }

  if (!Array.isArray(content)) {
    return { valid: false, errors: ['Root must be an array of rules'] }
  }

  const errors: string[] = []
  for (let i = 0; i < content.length; i++) {
    const rule = content[i]
    if (!rule.id) errors.push(`Rule [${i}]: missing "id"`)
    if (!rule.name) errors.push(`Rule [${i}] "${rule.id || '?'}": missing "name"`)
    if (!rule.platforms || !Array.isArray(rule.platforms)) {
      errors.push(`Rule [${i}] "${rule.id || '?'}": missing or invalid "platforms"`)
    }
  }

  return { valid: errors.length === 0, errors }
}

main()
