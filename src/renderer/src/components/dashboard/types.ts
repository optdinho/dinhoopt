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
  networkCleaned: number
  vulnerabilitiesFound: number
  memoryFreed: number
  systemRepairStatus?: string
  appsUpdated?: number
  driversUpdated?: number
  trimDrives?: number
  powerPlanActivated?: string
  rebootRequired?: boolean
}

export interface ToolCoverageItem {
  key: string
  label: string
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties; strokeWidth?: number }>
  color: string
  usedRecently: boolean
  usedEver: boolean
}
