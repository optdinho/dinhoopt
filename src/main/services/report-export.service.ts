import { writeFileSync } from 'node:fs'
import type { MalwareScanResult } from '@shared/types'

export type ExportFormat = 'csv' | 'json' | 'txt'

export function exportScanReport(result: MalwareScanResult, format: ExportFormat, outputPath: string): boolean {
  let content: string
  switch (format) {
    case 'json':
      content = JSON.stringify(result, null, 2)
      break
    case 'csv':
      content = generateCsv(result)
      break
    case 'txt':
      content = generateTxt(result)
      break
    default:
      return false
  }
  try {
    writeFileSync(outputPath, content, 'utf-8')
    return true
  } catch {
    return false
  }
}

function escapeCsv(value: string): string {
  // Prevent CSV injection by stripping formula-leading chars and escaping quotes
  const sanitized = value.replace(/^[=+\-@\t\r]/, '')
  return `"${sanitized.replace(/"/g, '""')}"`
}

function generateCsv(result: MalwareScanResult): string {
  const headers = 'Threat,Type,Severity,File,Status,Detected At\n'
  const rows = result.threats
    .map((t) =>
      [
        escapeCsv(t.detectionName),
        escapeCsv(t.source),
        escapeCsv(t.severity),
        escapeCsv(t.path),
        '"detected"',
        `"${new Date().toISOString()}"`,
      ].join(','),
    )
    .join('\n')
  return headers + rows
}

function generateTxt(result: MalwareScanResult): string {
  const lines = [
    '=== DiNho Optimizer - Scan Report ===',
    `Date: ${new Date().toISOString()}`,
    `Duration: ${result.duration}ms`,
    `Files scanned: ${result.filesScanned}`,
    `Threats found: ${result.threats.length}`,
    '',
    '=== Threats ===',
    ...result.threats.map((t) => `[${t.severity}] ${t.detectionName} (${t.source}) - ${t.path} - detected`),
    '',
    '=== Summary ===',
    `Critical: ${result.threats.filter((t) => t.severity === 'critical').length}`,
    `High: ${result.threats.filter((t) => t.severity === 'high').length}`,
    `Medium: ${result.threats.filter((t) => t.severity === 'medium').length}`,
    `Low: ${result.threats.filter((t) => t.severity === 'low').length}`,
  ]
  return lines.join('\n')
}
