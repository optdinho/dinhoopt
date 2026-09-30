import type { StopedServiceId } from '../stoped-services'
import type { ServiceStartType } from './system-a'

/** Live state of a single service in the STOPED catalog. */
export interface StopedServiceState {
  id: StopedServiceId
  name: string
  /** True when the SCM reports the service as Running. */
  running: boolean
  startType: ServiceStartType
  /** False when the service does not exist on this machine (e.g. Windows N). */
  found: boolean
}

export interface StopedStatusResult {
  services: StopedServiceState[]
  runningCount: number
  stoppedCount: number
  /** Services present in the catalog but missing from this Windows install. */
  missingCount: number
}

export interface StopedChangeFailure {
  id: StopedServiceId
  error: string
}

export interface StopedChangeResult {
  /** True when at least one service was changed. */
  success: boolean
  /** Aggregate error message, present when `success` is false. */
  error?: string
  /** Ids successfully changed. */
  changed: StopedServiceId[]
  /** Per-service failures. */
  failed: StopedChangeFailure[]
  /**
   * Always true after a successful change: a restart is what makes the new
   * startup type take effect for every service in this module.
   */
  rebootRequired: boolean
}
