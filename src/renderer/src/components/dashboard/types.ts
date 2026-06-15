export type OneClickPhase = 'idle' | 'scanning' | 'cleaning' | 'done'

export interface OneClickResult {
  spaceRecovered: number
  filesCleaned: number
  registryFixed: number
  driversRemoved: number
  threatsFound: number
  threatsQuarantined: number
  privacyScore: number
  privacyIssues: number
  startupHighImpact: number
  updatesAvailable: number
}

export interface ToolCoverageItem {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; strokeWidth?: number }>
  color: string
  usedRecently: boolean
  usedEver: boolean
}
