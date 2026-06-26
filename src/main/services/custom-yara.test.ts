import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let currentTmpDir = ''

vi.mock('electron', () => ({
  app: {
    getPath: () => currentTmpDir,
    isPackaged: false,
  },
}))

vi.mock('./logger.service', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  }),
}))

async function getCustomYaraService(): Promise<typeof import('./custom-yara.service')> {
  return import('./custom-yara.service')
}

describe('CustomYaraService', () => {
  beforeEach(() => {
    currentTmpDir = join(tmpdir(), 'tmp-test-custom-yara')
    if (!existsSync(currentTmpDir)) {
      mkdirSync(currentTmpDir, { recursive: true })
    }
  })

  afterEach(() => {
    const testDir = join(currentTmpDir, 'custom-yara-rules')
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  it('addRule creates file in rules directory', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    const result = service.addRule('test.yar', 'rule TestRule { condition: true }')
    expect(result).toBe(true)

    const rulesDir = service.getRulesDir()
    const files = readdirSync(rulesDir).filter((f) => f.endsWith('.yar'))
    expect(files).toContain('test.yar')
  })

  it('addRule validates YARA syntax (must contain rule)', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    const result = service.addRule('invalid.yar', 'some random content')
    expect(result).toBe(false)
  })

  it('removeRule deletes file', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    service.addRule('delete-me.yar', 'rule TestRule { condition: true }')
    const result = service.removeRule('delete-me.yar')
    expect(result).toBe(true)

    const rulesDir = service.getRulesDir()
    const files = readdirSync(rulesDir).filter((f) => f.endsWith('.yar'))
    expect(files).not.toContain('delete-me.yar')
  })

  it('removeRule returns false for non-existent', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    const result = service.removeRule('nonexistent.yar')
    expect(result).toBe(false)
  })

  it('getCustomRules returns all rules', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    service.addRule('rule1.yar', 'rule Rule1 { condition: true }')
    service.addRule('rule2.yar', 'rule Rule2 { condition: false }')

    const rules = service.getCustomRules()
    expect(rules).toHaveLength(2)
    const names = rules.map((r) => r.name).sort()
    expect(names).toEqual(['rule1.yar', 'rule2.yar'])
  })

  it('getRuleCount returns correct count', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    expect(service.getRuleCount()).toBe(0)

    service.addRule('count1.yar', 'rule Count1 { condition: true }')
    expect(service.getRuleCount()).toBe(1)

    service.addRule('count2.yar', 'rule Count2 { condition: true }')
    expect(service.getRuleCount()).toBe(2)
  })

  it('Multiple rules can be added', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    service.addRule('multi1.yar', 'rule Multi1 { condition: true }')
    service.addRule('multi2.yar', 'rule Multi2 { condition: true }')
    service.addRule('multi3.yar', 'rule Multi3 { condition: true }')

    expect(service.getRuleCount()).toBe(3)
  })

  it('Re-add same name overwrites', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    service.addRule('same.yar', 'rule Original { condition: true }')
    service.addRule('same.yar', 'rule Overwritten { condition: false }')

    const rules = service.getCustomRules()
    const match = rules.find((r) => r.name === 'same.yar')
    expect(match).toBeDefined()
    expect(match?.content).toContain('Overwritten')
  })

  it('Empty directory returns empty list', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    const rules = service.getCustomRules()
    expect(rules).toEqual([])
  })

  it('Constructor creates directory if not exists', async () => {
    const customYaraPath = join(currentTmpDir, 'custom-yara-rules')
    if (existsSync(customYaraPath)) {
      rmSync(customYaraPath, { recursive: true, force: true })
    }
    expect(existsSync(customYaraPath)).toBe(false)

    const service = new (await import('./custom-yara.service')).CustomYaraService()
    expect(existsSync(customYaraPath)).toBe(true)
  })

  it('addRule appends .yar extension if missing', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    const result = service.addRule('noext', 'rule NoExt { condition: true }')
    expect(result).toBe(true)

    const rules = service.getCustomRules()
    expect(rules.some((r) => r.name === 'noext.yar')).toBe(true)
  })

  it('addRule preserves .yara extension', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    const result = service.addRule('custom.yara', 'rule YaraExt { condition: true }')
    expect(result).toBe(true)

    const rules = service.getCustomRules()
    expect(rules.some((r) => r.name === 'custom.yara')).toBe(true)
  })

  it('getCustomRules includes .yara files', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    service.addRule('dot-yara.yara', 'rule DotYara { condition: true }')
    service.addRule('dot-yar.yar', 'rule DotYar { condition: true }')

    const rules = service.getCustomRules()
    expect(rules).toHaveLength(2)
    const names = rules.map((r) => r.name).sort()
    expect(names).toEqual(['dot-yar.yar', 'dot-yara.yara'])
  })

  it('getRuleCount includes .yara files', async () => {
    const { customYaraService: service } = await getCustomYaraService()
    service.addRule('a.yar', 'rule A { condition: true }')
    service.addRule('b.yara', 'rule B { condition: true }')
    expect(service.getRuleCount()).toBe(2)
  })
})
