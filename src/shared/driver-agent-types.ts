export const AGENT_IDS = [
  'windows-update',
  'version-freshness',
  'date-maturity',
  'whql-certification',
  'publisher-reputation',
  'hardware-match',
  'stability-risk',
  'security-relevance',
  'rollback-safety',
  'consensus',
] as const

export type AgentId = (typeof AGENT_IDS)[number]

export interface AgentInfo {
  id: AgentId
  nameKey: string
  descriptionKey: string
  icon: string
  weight: number
}

export interface AgentVerdict {
  agentId: AgentId
  score: number
  maxScore: number
  label: 'critical' | 'recommended' | 'optional' | 'caution' | 'skip'
  summaryKey: string
  details: string[]
}

export interface DriverCandidate {
  updateId: string
  deviceName: string
  deviceId: string
  className: string
  currentVersion: string
  availableVersion: string
  currentDate: string
  availableDate: string
  provider: string
  updateTitle: string
  downloadSize: string
  verdicts: AgentVerdict[]
  consensusScore: number
  consensusLabel: 'critical' | 'recommended' | 'optional' | 'caution' | 'skip'
  approved: boolean
}

export interface AgentEvaluationResult {
  candidates: DriverCandidate[]
  evaluatedAt: string
  totalCandidates: number
  criticalCount: number
  recommendedCount: number
  optionalCount: number
  cautionCount: number
  skipCount: number
}
