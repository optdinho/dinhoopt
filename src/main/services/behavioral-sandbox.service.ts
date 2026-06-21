import path from 'node:path'

export interface SandboxedFile {
  filePath: string
  fileName: string
  fileSize: number
  isPE: boolean
  isScript: boolean
  isOffice: boolean
}

export interface SuspiciousBehavior {
  type:
    | 'registry_write'
    | 'file_write'
    | 'network_connect'
    | 'process_create'
    | 'self_copy'
    | 'dll_inject'
    | 'persistence_install'
    | 'anti_debug'
  description: string
  severity: 'medium' | 'high' | 'critical'
  details: string
}

export interface SandboxResult {
  filePath: string
  riskScore: number
  behaviors: SuspiciousBehavior[]
  isMalicious: boolean
  summary: string
  fileInfo: SandboxedFile
}

interface BehaviorRule {
  type: SuspiciousBehavior['type']
  name: string
  check: (content: Buffer, info: SandboxedFile) => boolean
  severity: SuspiciousBehavior['severity']
  details: string
}

const BEHAVIOR_RULES: BehaviorRule[] = [
  {
    type: 'registry_write',
    name: 'Registry Autorun Modification',
    severity: 'critical',
    details: 'Attempts to modify Windows registry Run keys for persistence',
    check: (content, info) => {
      if (info.isPE) return false
      const str = content.toString('latin1').toLowerCase()
      return str.includes('currentversion\\run') || str.includes('currentversion\\runonce')
    },
  },
  {
    type: 'self_copy',
    name: 'Self-Replication',
    severity: 'high',
    details: 'File contains code to copy itself to another location',
    check: (content, info) => {
      if (info.isPE) return false
      const str = content.toString('latin1').toLowerCase()
      return str.includes('copy ') || str.includes('file.copy(') || str.includes('copyto(')
    },
  },
  {
    type: 'network_connect',
    name: 'Network Connection to C2',
    severity: 'critical',
    details: 'Attempts to establish outbound network connection',
    check: (content, info) => {
      if (info.isPE) return false
      const str = content.toString('latin1').toLowerCase()
      return (
        (str.includes('socket') || str.includes('connect(') || str.includes('tcpclient')) &&
        (str.includes('192.168.') || str.includes('10.0.') || str.includes('http://'))
      )
    },
  },
  {
    type: 'process_create',
    name: 'Process Creation',
    severity: 'high',
    details: 'Attempts to create a new process or execute a command',
    check: (content, info) => {
      if (!info.isScript) return false
      const str = content.toString('latin1').toLowerCase()
      return str.includes('process.start(') || str.includes('wscript.shell') || str.includes('shell.execute')
    },
  },
  {
    type: 'dll_inject',
    name: 'DLL Injection Attempt',
    severity: 'critical',
    details: 'Contains code patterns consistent with DLL injection',
    check: (content, info) => {
      if (info.isPE) return false
      const str = content.toString('latin1').toLowerCase()
      return (
        str.includes('loadlibrary') ||
        str.includes('createremotethread') ||
        str.includes('virtualallocex') ||
        str.includes('writeprocessmemory')
      )
    },
  },
  {
    type: 'persistence_install',
    name: 'Persistence Mechanism',
    severity: 'high',
    details: 'Attempts to install a persistence mechanism',
    check: (content, info) => {
      if (info.isPE) return false
      const str = content.toString('latin1').toLowerCase()
      return (
        str.includes('schtasks') ||
        str.includes('startup') ||
        str.includes('servicename') ||
        str.includes('wmi persistence')
      )
    },
  },
  {
    type: 'anti_debug',
    name: 'Anti-Debug Techniques',
    severity: 'medium',
    details: 'Contains anti-debugging or anti-VM code',
    check: (content, info) => {
      if (info.isPE) return false
      const str = content.toString('latin1').toLowerCase()
      return (
        str.includes('isdebuggerpresent') ||
        str.includes('ntglobalflag') ||
        str.includes('peb') ||
        str.includes('vmtoolsd') ||
        str.includes('checkremote')
      )
    },
  },
  {
    type: 'file_write',
    name: 'File Drop to System Dir',
    severity: 'high',
    details: 'Attempts to write files to Windows system directory',
    check: (content, info) => {
      if (info.isPE) return false
      const str = content.toString('latin1').toLowerCase()
      return (
        (str.includes('system32') || str.includes('syswow64')) &&
        (str.includes('write') || str.includes('create') || str.includes('put'))
      )
    },
  },
]

export function analyzeBehavior(filePath: string, content: Buffer): SandboxResult {
  const fileName = path.basename(filePath)
  const fileInfo: SandboxedFile = {
    filePath,
    fileName,
    fileSize: content.length,
    isPE: content[0] === 0x4d && content[1] === 0x5a,
    isScript: fileName.endsWith('.ps1') || fileName.endsWith('.vbs') || fileName.endsWith('.js'),
    isOffice: fileName.endsWith('.docm') || fileName.endsWith('.xlsm') || fileName.endsWith('.pptm'),
  }

  const behaviors: SuspiciousBehavior[] = []

  for (const rule of BEHAVIOR_RULES) {
    try {
      if (rule.check(content, fileInfo)) {
        behaviors.push({
          type: rule.type,
          description: rule.name,
          severity: rule.severity,
          details: rule.details,
        })
      }
    } catch {
      // Skip rule if it throws
    }
  }

  const scoreMap: Record<string, number> = { critical: 25, high: 15, medium: 5 }
  const riskScore = behaviors.reduce((sum, b) => sum + (scoreMap[b.severity] || 0), 0)

  const malicious = riskScore >= 50

  let summary: string
  if (malicious) {
    summary = `⚠️ MALICIOSO — ${behaviors.length} comportamentos suspeitos detectados (score: ${riskScore}/100)`
  } else if (behaviors.length > 0) {
    summary = `⚠️ Suspeito — ${behaviors.length} comportamentos de baixa gravidade (score: ${riskScore}/100)`
  } else {
    summary = '✅ Limpo — Nenhum comportamento suspeito detectado'
  }

  return { filePath, riskScore: Math.min(riskScore, 100), behaviors, isMalicious: riskScore >= 50, summary, fileInfo }
}
