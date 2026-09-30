/**
 * Catalog of the Windows services exposed by the "STOPED" module.
 *
 * This catalog is the single source of truth: the renderer can only ever
 * reference a service by its `id` (which is *also* the real Windows service
 * name).  The main process resolves the id against this list before touching
 * the Service Control Manager, so a compromised renderer cannot ask the app
 * to disable an arbitrary service.
 *
 * Display strings live in i18n keys (`labelKey` / `descriptionKey`) so the
 * page can be translated; the raw Windows service name is always shown as a
 * monospace subtitle.
 */

export const STOPED_SERVICE_IDS = [
  'PcaSvc',
  'DPS',
  'DiagTrack',
  'SysMain',
  'EventLog',
  'ADPSvc',
  'UmRdpService',
] as const

export type StopedServiceId = (typeof STOPED_SERVICE_IDS)[number]

export interface StopedServiceDef {
  /** Real Windows service name — doubles as the unique id. */
  id: StopedServiceId
  /** i18n key (namespace `stoped`) for the short, plain-language name. */
  labelKey: string
  /** i18n key (namespace `stoped`) for the one-line explanation. */
  descriptionKey: string
}

export const STOPED_SERVICES: readonly StopedServiceDef[] = [
  {
    id: 'PcaSvc',
    labelKey: 'servicePcaSvcLabel',
    descriptionKey: 'servicePcaSvcDescription',
  },
  {
    id: 'DPS',
    labelKey: 'serviceDpsLabel',
    descriptionKey: 'serviceDpsDescription',
  },
  {
    id: 'DiagTrack',
    labelKey: 'serviceDiagTrackLabel',
    descriptionKey: 'serviceDiagTrackDescription',
  },
  {
    id: 'SysMain',
    labelKey: 'serviceSysMainLabel',
    descriptionKey: 'serviceSysMainDescription',
  },
  {
    id: 'EventLog',
    labelKey: 'serviceEventLogLabel',
    descriptionKey: 'serviceEventLogDescription',
  },
  {
    id: 'ADPSvc',
    labelKey: 'serviceAdpSvcLabel',
    descriptionKey: 'serviceAdpSvcDescription',
  },
  {
    id: 'UmRdpService',
    labelKey: 'serviceUmRdpLabel',
    descriptionKey: 'serviceUmRdpDescription',
  },
]

const BY_ID = new Map<string, StopedServiceDef>(STOPED_SERVICES.map((s) => [s.id, s]))

/** Type guard used by the IPC layer to reject unknown service names. */
export function isStopedServiceId(value: unknown): value is StopedServiceId {
  return typeof value === 'string' && BY_ID.has(value)
}

/** Look up a catalog entry. Returns `undefined` for anything not in the list. */
export function getStopedServiceDef(id: string): StopedServiceDef | undefined {
  return BY_ID.get(id)
}
