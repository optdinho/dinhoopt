import { execSync } from 'node:child_process'

export interface ProcessInfo {
  pid: number
  name: string
  path: string
  cpu: number
  memory: number
  suspicious: boolean
  reason?: string
}

export interface MemoryScanResult {
  processes: ProcessInfo[]
  suspiciousCount: number
  timestamp: string
}

const SUSPICIOUS_PATTERNS = [
  {
    name: 'Process Hollowing',
    check: (p: ProcessInfo) => p.name === 'svchost.exe' && p.path?.toLowerCase().includes('temp'),
  },
  {
    name: 'Run from Temp',
    check: (p: ProcessInfo) => p.path?.toLowerCase().includes('\\temp\\') || p.path?.toLowerCase().includes('\\tmp\\'),
  },
  {
    name: 'Unsigned DLL Host',
    check: (p: ProcessInfo) => ['rundll32.exe', 'regsvr32.exe', 'mshta.exe'].includes(p.name),
  },
  {
    name: 'High Memory Usage',
    check: (p: ProcessInfo) =>
      p.memory > 500 && !['chrome.exe', 'msedge.exe', 'firefox.exe', 'Code.exe', 'explorer.exe'].includes(p.name),
  },
  {
    name: 'Suspicious Parent',
    check: (p: ProcessInfo) =>
      p.name === 'powershell.exe' || p.name === 'cmd.exe' || p.name === 'wscript.exe' || p.name === 'cscript.exe',
  },
  { name: 'Unknown Signed', check: () => false },
]

export function scanMemory(): MemoryScanResult {
  const processes = getProcessList()
  const scanned = processes.map((p) => {
    for (const pattern of SUSPICIOUS_PATTERNS) {
      if (pattern.check(p)) {
        return { ...p, suspicious: true, reason: pattern.name }
      }
    }
    return { ...p, suspicious: false }
  })
  return {
    processes: scanned,
    suspiciousCount: scanned.filter((p) => p.suspicious).length,
    timestamp: new Date().toISOString(),
  }
}

function getProcessList(): ProcessInfo[] {
  try {
    const output = execSync('tasklist /FO CSV /NH', { encoding: 'utf-8', timeout: 5000 })
    const lines = output.trim().split('\n').filter(Boolean)
    return lines.map((line) => {
      const parts = line.replace(/"/g, '').split(',')
      const memStr = parts[4] || '0'
      const memNum = Number.parseFloat(memStr) / 1024
      return {
        pid: Number.parseInt(parts[1] || '0', 10),
        name: parts[0] || 'unknown',
        path: '',
        cpu: 0,
        memory: Math.round(memNum * 100) / 100,
        suspicious: false,
      }
    })
  } catch {
    return []
  }
}
