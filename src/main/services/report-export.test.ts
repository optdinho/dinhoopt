import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type { MalwareScanResult } from '@shared/types'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { exportScanReport } from './report-export.service'

const OUT_DIR = join(import.meta.dirname, '..', '..', '..', 'tmp-report-export-test')

function makeResult(overrides?: Partial<MalwareScanResult>): MalwareScanResult {
  return {
    threats: [
      {
        id: '1',
        path: 'C:\\malware\\virus.exe',
        fileName: 'virus.exe',
        size: 1024,
        detectionName: 'Trojan.Generic',
        severity: 'critical',
        source: 'signature',
        details: 'Detected by YARA rule',
        selected: false,
      },
      {
        id: '2',
        path: 'C:\\temp\\hack.ps1',
        fileName: 'hack.ps1',
        size: 512,
        detectionName: 'Heuristic.PS1',
        severity: 'high',
        source: 'heuristic',
        details: 'Suspicious PowerShell script',
        selected: false,
      },
    ],
    filesScanned: 1000,
    duration: 15234,
    engines: ['YARA', 'Heuristic'],
    scanId: 'scan-123',
    ...overrides,
  }
}

describe('report export service', () => {
  beforeEach(() => {
    if (!existsSync(OUT_DIR)) {
      mkdirSync(OUT_DIR, { recursive: true })
    }
  })

  afterEach(() => {
    if (existsSync(OUT_DIR)) {
      rmSync(OUT_DIR, { recursive: true, force: true })
    }
  })

  it('JSON export produces valid JSON', async () => {
    const result = makeResult()
    const outputPath = join(OUT_DIR, 'report.json')
    const success = exportScanReport(result, 'json', outputPath)
    expect(success).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed).toHaveProperty('threats')
    expect(parsed).toHaveProperty('filesScanned', 1000)
    expect(parsed).toHaveProperty('duration', 15234)
  })

  it('CSV export has headers', () => {
    const result = makeResult()
    const outputPath = join(OUT_DIR, 'report.csv')
    const success = exportScanReport(result, 'csv', outputPath)
    expect(success).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Threat')
    expect(content).toContain('Type')
    expect(content).toContain('Severity')
    expect(content).toContain('File')
    expect(content).toContain('Status')
    expect(content).toContain('Detected At')
  })

  it('CSV export has correct row count', () => {
    const result = makeResult()
    const outputPath = join(OUT_DIR, 'report.csv')
    exportScanReport(result, 'csv', outputPath)

    const content = readFileSync(outputPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(3) // header + 2 threat rows
  })

  it('TXT export includes scan summary', () => {
    const result = makeResult()
    const outputPath = join(OUT_DIR, 'report.txt')
    const success = exportScanReport(result, 'txt', outputPath)
    expect(success).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('Scan Report')
    expect(content).toContain('Threats found: 2')
    expect(content).toContain('Files scanned: 1000')
  })

  it('TXT export has correct sections', () => {
    const result = makeResult()
    const outputPath = join(OUT_DIR, 'report.txt')
    exportScanReport(result, 'txt', outputPath)

    const content = readFileSync(outputPath, 'utf-8')
    expect(content).toContain('=== DiNho Optimizer - Scan Report ===')
    expect(content).toContain('=== Threats ===')
    expect(content).toContain('=== Summary ===')
  })

  it('Empty threats list still produces valid output', () => {
    const result = makeResult({ threats: [] })
    const outputPath = join(OUT_DIR, 'report.json')
    const success = exportScanReport(result, 'json', outputPath)
    expect(success).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    const parsed = JSON.parse(content)
    expect(parsed.threats).toEqual([])
  })

  it('Invalid format returns false', () => {
    const result = makeResult()
    const outputPath = join(OUT_DIR, 'report.txt')
    const success = exportScanReport(result, 'pdf' as 'csv', outputPath)
    expect(success).toBe(false)
  })

  it('Unwritable path returns false', () => {
    const result = makeResult()
    const badPath = join('Z:', 'does-not-exist', 'report.json')
    const success = exportScanReport(result, 'json', badPath)
    expect(success).toBe(false)
  })

  it('All formats include scan date', () => {
    const result = makeResult()
    const txtPath = join(OUT_DIR, 'report.txt')
    exportScanReport(result, 'txt', txtPath)
    const txtContent = readFileSync(txtPath, 'utf-8')
    expect(txtContent).toContain('Date:')

    const csvPath = join(OUT_DIR, 'report.csv')
    exportScanReport(result, 'csv', csvPath)
    const csvContent = readFileSync(csvPath, 'utf-8')
    const csvLines = csvContent.trim().split('\n')
    expect(csvLines[1]).toMatch(/,/) // has data

    const jsonPath = join(OUT_DIR, 'report.json')
    exportScanReport(result, 'json', jsonPath)
    const jsonContent = readFileSync(jsonPath, 'utf-8')
    const parsed = JSON.parse(jsonContent)
    expect(parsed.threats).toHaveLength(2)
  })

  it('Edge case: very long threat names are properly quoted in CSV', () => {
    const longName = 'A'.repeat(500)
    const result = makeResult({
      threats: [
        {
          id: '1',
          path: `C:\\${longName}.exe`,
          fileName: `${longName}.exe`,
          size: 999,
          detectionName: longName,
          severity: 'medium',
          source: 'signature',
          details: 'Long name test',
          selected: false,
        },
      ],
    })
    const outputPath = join(OUT_DIR, 'report.csv')
    const success = exportScanReport(result, 'csv', outputPath)
    expect(success).toBe(true)

    const content = readFileSync(outputPath, 'utf-8')
    const lines = content.trim().split('\n')
    expect(lines).toHaveLength(2)

    const dataLine = lines[1]!
    expect(dataLine).toContain(`"${longName}"`)
  })
})
