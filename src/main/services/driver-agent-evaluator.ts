import type { AgentEvaluationResult, AgentInfo, AgentVerdict, DriverCandidate } from '@shared/driver-agent-types'
import type { DriverUpdate } from '@shared/types'

export const AGENTS: AgentInfo[] = [
  { id: 'windows-update', nameKey: 'agentWuName', descriptionKey: 'agentWuDesc', icon: 'Cloud', weight: 20 },
  {
    id: 'version-freshness',
    nameKey: 'agentVersionName',
    descriptionKey: 'agentVersionDesc',
    icon: 'ArrowUpCircle',
    weight: 15,
  },
  { id: 'date-maturity', nameKey: 'agentDateName', descriptionKey: 'agentDateDesc', icon: 'CalendarCheck', weight: 10 },
  {
    id: 'whql-certification',
    nameKey: 'agentWhqlName',
    descriptionKey: 'agentWhqlDesc',
    icon: 'ShieldCheck',
    weight: 15,
  },
  {
    id: 'publisher-reputation',
    nameKey: 'agentPublisherName',
    descriptionKey: 'agentPublisherDesc',
    icon: 'Building2',
    weight: 10,
  },
  { id: 'hardware-match', nameKey: 'agentHardwareName', descriptionKey: 'agentHardwareDesc', icon: 'Cpu', weight: 15 },
  {
    id: 'stability-risk',
    nameKey: 'agentStabilityName',
    descriptionKey: 'agentStabilityDesc',
    icon: 'Activity',
    weight: 5,
  },
  {
    id: 'security-relevance',
    nameKey: 'agentSecurityName',
    descriptionKey: 'agentSecurityDesc',
    icon: 'ShieldAlert',
    weight: 5,
  },
  {
    id: 'rollback-safety',
    nameKey: 'agentRollbackName',
    descriptionKey: 'agentRollbackDesc',
    icon: 'Undo2',
    weight: 5,
  },
  { id: 'consensus', nameKey: 'agentConsensusName', descriptionKey: 'agentConsensusDesc', icon: 'Scale', weight: 0 },
]

function parseVersion(v: string): number[] {
  return v.split('.').map((p) => {
    const n = Number(p)
    return Number.isNaN(n) ? 0 : n
  })
}

function isNewerVersion(current: string, available: string): boolean {
  const cur = parseVersion(current)
  const ava = parseVersion(available)
  const maxLen = Math.max(cur.length, ava.length)
  for (let i = 0; i < maxLen; i++) {
    const a = cur[i] ?? 0
    const b = ava[i] ?? 0
    if (b !== a) return b > a
  }
  return false
}

function daysBetween(dateStr1: string, dateStr2: string): number {
  const d1 = new Date(dateStr1).getTime()
  const d2 = new Date(dateStr2).getTime()
  if (Number.isNaN(d1) || Number.isNaN(d2)) return 0
  return Math.floor(Math.abs(d2 - d1) / 86400000)
}

function daysSince(dateStr: string): number {
  const d = new Date(dateStr).getTime()
  if (Number.isNaN(d)) return 0
  return Math.floor((Date.now() - d) / 86400000)
}

function scoreToLabel(score: number, maxScore: number): DriverCandidate['consensusLabel'] {
  const pct = maxScore > 0 ? score / maxScore : 0
  if (pct >= 0.8) return 'critical'
  if (pct >= 0.5) return 'recommended'
  if (pct >= 0.3) return 'optional'
  if (pct >= 0.1) return 'caution'
  return 'skip'
}

// ─── Agent 1: Windows Update ───────────────────────────────
function evaluateWindowsUpdate(_update: DriverUpdate): AgentVerdict {
  const details: string[] = ['Encontrado via Windows Update']
  return {
    agentId: 'windows-update',
    score: 80,
    maxScore: 100,
    label: 'recommended',
    summaryKey: 'agentWuFound',
    details,
  }
}

// ─── Agent 2: Version Freshness ──────────────────────────────
function evaluateVersionFreshness(update: DriverUpdate): AgentVerdict {
  const cur = parseVersion(update.currentVersion)
  const ava = parseVersion(update.availableVersion)
  const details: string[] = []

  if (!isNewerVersion(update.currentVersion, update.availableVersion)) {
    return {
      agentId: 'version-freshness',
      score: 0,
      maxScore: 100,
      label: 'skip',
      summaryKey: 'agentVersionNotNewer',
      details: ['Versão disponível não é mais recente que a atual'],
    }
  }

  let score = 50
  const majorDiff = (ava[0] ?? 0) - (cur[0] ?? 0)
  const minorDiff = (ava[1] ?? 0) - (cur[1] ?? 0)

  if (majorDiff > 0) {
    score += 30
    details.push(`Atualização de versão principal: ${update.currentVersion} → ${update.availableVersion}`)
  } else if (minorDiff > 0) {
    score += 15
    details.push(`Atualização de versão secundária: ${update.currentVersion} → ${update.availableVersion}`)
  } else {
    details.push(`Atualização incremental: ${update.currentVersion} → ${update.availableVersion}`)
  }

  if (majorDiff >= 2) {
    score = Math.min(score, 70)
    details.push('Salto de versão grande — verificar compatibilidade')
  }

  return {
    agentId: 'version-freshness',
    score,
    maxScore: 100,
    label: score >= 70 ? 'recommended' : score >= 40 ? 'optional' : 'caution',
    summaryKey: 'agentVersionNewer',
    details,
  }
}

// ─── Agent 3: Date Maturity ──────────────────────────────────
function evaluateDateMaturity(update: DriverUpdate): AgentVerdict {
  const daysAvail = daysSince(update.availableDate)
  const daysSinceCurrent = daysBetween(update.currentDate, update.availableDate)
  const details: string[] = []

  details.push(`Disponível há ${daysAvail} dias`)

  let score = 50
  if (daysAvail < 7) {
    score = 10
    details.push('Muito recente — pode conter instabilidades')
  } else if (daysAvail < 30) {
    score = 40
    details.push('Relativamente novo — estável na maioria dos casos')
  } else if (daysAvail < 90) {
    score = 70
    details.push('Maturidade adequada — amplamente testado')
  } else if (daysAvail < 365) {
    score = 80
    details.push('Bem estabelecido — maduro e confiável')
  } else {
    score = 30
    details.push('Antigo — pode estar desatualizado')
  }

  if (daysSinceCurrent > 180) {
    score += 10
    details.push('Atualização significativa em relação à versão atual')
  }

  return {
    agentId: 'date-maturity',
    score: Math.min(score, 100),
    maxScore: 100,
    label: score >= 60 ? 'recommended' : score >= 30 ? 'optional' : 'caution',
    summaryKey: 'agentDateSummary',
    details,
  }
}

// ─── Agent 4: WHQL Certification ─────────────────────────────
function evaluateWhql(update: DriverUpdate): AgentVerdict {
  const title = update.updateTitle.toLowerCase()
  const provider = update.provider.toLowerCase()
  const details: string[] = []

  const whqlKeywords = ['whql', 'microsoft', 'windows hardware', 'signed']
  const hasWhql = whqlKeywords.some((kw) => title.includes(kw) || provider.includes(kw))

  let score = 0
  if (hasWhql || provider.includes('microsoft')) {
    score = 90
    details.push('Driver certificado WHQL ou assinado pela Microsoft')
  } else if (provider.includes('intel') || provider.includes('nvidia') || provider.includes('amd')) {
    score = 70
    details.push('Driver de fabricante OEM confiável')
  } else {
    score = 30
    details.push('Certificação WHQL não verificada — proceeda com cautela')
  }

  return {
    agentId: 'whql-certification',
    score,
    maxScore: 100,
    label: score >= 60 ? 'recommended' : 'caution',
    summaryKey: hasWhql ? 'agentWhqlCertified' : 'agentWhqlUnknown',
    details,
  }
}

// ─── Agent 5: Publisher Reputation ───────────────────────────
function evaluatePublisher(update: DriverUpdate): AgentVerdict {
  const provider = update.provider.toLowerCase()
  const details: string[] = []

  let score = 0
  let label: AgentVerdict['label'] = 'caution'

  if (provider.includes('microsoft')) {
    score = 95
    label = 'critical'
    details.push('Editor: Microsoft Corporation — Altamente confiável')
  } else if (provider.includes('intel') || provider === 'intel corporation') {
    score = 85
    label = 'recommended'
    details.push('Editor: Intel — Fornecedor confiável')
  } else if (provider.includes('nvidia') || provider === 'nvidia corporation') {
    score = 85
    label = 'recommended'
    details.push('Editor: NVIDIA — Fornecedor confiável')
  } else if (provider.includes('amd') || provider.includes('advanced micro devices')) {
    score = 85
    label = 'recommended'
    details.push('Editor: AMD — Fornecedor confiável')
  } else if (provider.includes('realtek') || provider.includes('broadcom') || provider.includes('qualcomm')) {
    score = 70
    label = 'recommended'
    details.push(`Editor: ${update.provider} — Fornecedor conhecido`)
  } else {
    score = 40
    label = 'caution'
    details.push(`Editor: ${update.provider} — Reputação não verificada`)
  }

  return {
    agentId: 'publisher-reputation',
    score,
    maxScore: 100,
    label,
    summaryKey: 'agentPublisherSummary',
    details,
  }
}

// ─── Agent 6: Hardware Match ─────────────────────────────────
function evaluateHardwareMatch(update: DriverUpdate): AgentVerdict {
  const deviceName = update.deviceName.toLowerCase()
  const updateTitle = update.updateTitle.toLowerCase()
  const details: string[] = []

  let score = 60

  if (deviceName && updateTitle) {
    const deviceWords = deviceName.split(/\s+/)
    const matchCount = deviceWords.filter((w) => w.length > 2 && updateTitle.includes(w)).length
    const matchRatio = deviceWords.length > 0 ? matchCount / deviceWords.length : 0

    if (matchRatio >= 0.7) {
      score = 90
      details.push('Título do update corresponde exatamente ao dispositivo')
    } else if (matchRatio >= 0.3) {
      score = 70
      details.push('Correspondência parcial entre update e dispositivo')
    } else {
      score = 50
      details.push('Correspondência genérica — verificar compatibilidade')
    }
  }

  if (update.className) {
    details.push(`Classe do dispositivo: ${update.className}`)
  }

  return {
    agentId: 'hardware-match',
    score,
    maxScore: 100,
    label: score >= 70 ? 'recommended' : 'optional',
    summaryKey: score >= 70 ? 'agentHardwareMatch' : 'agentHardwarePartial',
    details,
  }
}

// ─── Agent 7: Stability Risk ─────────────────────────────────
function evaluateStabilityRisk(update: DriverUpdate): AgentVerdict {
  const cur = parseVersion(update.currentVersion)
  const ava = parseVersion(update.availableVersion)
  const details: string[] = []

  const majorDiff = (ava[0] ?? 0) - (cur[0] ?? 0)
  const minorDiff = (ava[1] ?? 0) - (cur[1] ?? 0)
  const daysAvail = daysSince(update.availableDate)

  let riskScore = 70

  if (majorDiff >= 2) {
    riskScore -= 30
    details.push('Risco alto: salto de 2+ versões principais')
  } else if (majorDiff === 1) {
    riskScore -= 10
    details.push('Risco moderado: mudança de versão principal')
  } else if (minorDiff <= 2 && minorDiff > 0) {
    riskScore += 10
    details.push('Baixo risco: atualização menor dentro da mesma versão')
  }

  if (daysAvail < 14) {
    riskScore -= 20
    details.push('Risco adicional: driver muito recente (menos de 14 dias)')
  } else if (daysAvail > 180) {
    riskScore += 5
    details.push('Driver bem testado pelo mercado (6+ meses disponível)')
  }

  if (providerIsOem(update.provider)) {
    riskScore += 10
  }

  const finalScore = Math.max(0, Math.min(100, riskScore))

  return {
    agentId: 'stability-risk',
    score: finalScore,
    maxScore: 100,
    label: finalScore >= 60 ? 'recommended' : finalScore >= 30 ? 'caution' : 'skip',
    summaryKey: finalScore >= 60 ? 'agentStabilityLow' : 'agentStabilityHigh',
    details,
  }
}

// ─── Agent 8: Security Relevance ─────────────────────────────
function evaluateSecurityRelevance(update: DriverUpdate): AgentVerdict {
  const title = update.updateTitle.toLowerCase()
  const details: string[] = []

  const securityKeywords = [
    'security',
    'security update',
    'vulnerability',
    'cve-',
    'critical',
    'important',
    'exploit',
    'privilege escalation',
    'remote code execution',
    'denial of service',
    'information disclosure',
    'buffer overflow',
    'patch',
  ]

  const foundKeywords = securityKeywords.filter((kw) => title.includes(kw))

  let score = 0
  if (foundKeywords.length > 0) {
    score = Math.min(30 + foundKeywords.length * 20, 100)
    details.push(`Contém palavras-chave de segurança: ${foundKeywords.join(', ')}`)
  } else {
    score = 20
    details.push('Nenhum indicador de segurança identificado no título')
  }

  if (title.includes('critical') || title.includes('cve-')) {
    score = Math.max(score, 90)
    details.push('ATUALIZAÇÃO CRÍTICA DE SEGURANÇA')
  }

  return {
    agentId: 'security-relevance',
    score,
    maxScore: 100,
    label: score >= 70 ? 'critical' : score >= 40 ? 'recommended' : 'optional',
    summaryKey: score >= 70 ? 'agentSecurityCritical' : score >= 40 ? 'agentSecurityPresent' : 'agentSecurityNone',
    details,
  }
}

// ─── Agent 9: Rollback Safety ────────────────────────────────
function evaluateRollbackSafety(): AgentVerdict {
  const details: string[] = [
    'Recomenda-se criar um ponto de restauração antes de instalar drivers',
    'O Windows mantém versões anteriores do driver em DriverStore',
  ]

  return {
    agentId: 'rollback-safety',
    score: 60,
    maxScore: 100,
    label: 'optional',
    summaryKey: 'agentRollbackAvailable',
    details,
  }
}

// ─── Agent 10: Consensus Aggregator ──────────────────────────
function evaluateConsensus(verdicts: AgentVerdict[]): AgentVerdict {
  const nonConsensus = verdicts.filter((v) => v.agentId !== 'consensus')
  const totalWeighted = nonConsensus.reduce((sum, v) => {
    const agent = AGENTS.find((a) => a.id === v.agentId)
    return sum + (v.score / v.maxScore) * (agent?.weight ?? 5)
  }, 0)
  const totalWeight = nonConsensus.reduce((sum, v) => {
    const agent = AGENTS.find((a) => a.id === v.agentId)
    return sum + (agent?.weight ?? 5)
  }, 0)
  const consensusScore = totalWeight > 0 ? Math.round((totalWeighted / totalWeight) * 100) : 0

  const criticalCount = nonConsensus.filter((v) => v.label === 'critical').length
  const skipCount = nonConsensus.filter((v) => v.label === 'skip').length
  const cautionCount = nonConsensus.filter((v) => v.label === 'caution').length

  const details: string[] = [
    `${criticalCount} agente(s) classificaram como crítico`,
    `${nonConsensus.length - skipCount - cautionCount - criticalCount} agente(s) recomendaram`,
    skipCount > 0 ? `${skipCount} agente(s) sugerem ignorar` : '',
    cautionCount > 0 ? `${cautionCount} agente(s) recomendam cautela` : '',
  ].filter(Boolean)

  return {
    agentId: 'consensus',
    score: consensusScore,
    maxScore: 100,
    label: scoreToLabel(consensusScore, 100),
    summaryKey: 'agentConsensusSummary',
    details,
  }
}

function providerIsOem(provider: string): boolean {
  const known = ['microsoft', 'intel', 'nvidia', 'amd', 'realtek', 'broadcom', 'qualcomm']
  return known.some((k) => provider.toLowerCase().includes(k))
}

export function evaluateDrivers(updates: DriverUpdate[]): AgentEvaluationResult {
  const candidates: DriverCandidate[] = []

  for (const update of updates) {
    const verdicts: AgentVerdict[] = [
      evaluateWindowsUpdate(update),
      evaluateVersionFreshness(update),
      evaluateDateMaturity(update),
      evaluateWhql(update),
      evaluatePublisher(update),
      evaluateHardwareMatch(update),
      evaluateStabilityRisk(update),
      evaluateSecurityRelevance(update),
      evaluateRollbackSafety(),
    ]

    const consensus = evaluateConsensus(verdicts)
    verdicts.push(consensus)

    candidates.push({
      updateId: update.id,
      deviceName: update.deviceName,
      deviceId: update.deviceId,
      className: update.className,
      currentVersion: update.currentVersion,
      availableVersion: update.availableVersion,
      currentDate: update.currentDate,
      availableDate: update.availableDate,
      provider: update.provider,
      updateTitle: update.updateTitle,
      downloadSize: update.downloadSize,
      verdicts,
      consensusScore: consensus.score,
      consensusLabel: consensus.label,
      approved: false,
    })
  }

  const criticalCount = candidates.filter((c) => c.consensusLabel === 'critical').length
  const recommendedCount = candidates.filter((c) => c.consensusLabel === 'recommended').length
  const optionalCount = candidates.filter((c) => c.consensusLabel === 'optional').length
  const cautionCount = candidates.filter((c) => c.consensusLabel === 'caution').length
  const skipCount = candidates.filter((c) => c.consensusLabel === 'skip').length

  candidates.sort((a, b) => b.consensusScore - a.consensusScore)

  return {
    candidates,
    evaluatedAt: new Date().toISOString(),
    totalCandidates: candidates.length,
    criticalCount,
    recommendedCount,
    optionalCount,
    cautionCount,
    skipCount,
  }
}
