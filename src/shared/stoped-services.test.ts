import { describe, expect, it } from 'vitest'
import { getStopedServiceDef, isStopedServiceId, STOPED_SERVICE_IDS, STOPED_SERVICES } from './stoped-services'

describe('stoped-services catalog', () => {
  it('exposes the 7 requested services in order', () => {
    expect([...STOPED_SERVICE_IDS]).toEqual([
      'PcaSvc',
      'DPS',
      'DiagTrack',
      'SysMain',
      'EventLog',
      'ADPSvc',
      'UmRdpService',
    ])
  })

  it('has one definition per id, all with i18n keys', () => {
    expect(STOPED_SERVICES).toHaveLength(STOPED_SERVICE_IDS.length)
    for (const def of STOPED_SERVICES) {
      expect(def.id).toBeTruthy()
      expect(def.labelKey).toMatch(/^service\w+Label$/)
      expect(def.descriptionKey).toMatch(/^service\w+Description$/)
    }
  })

  it('has no duplicate ids', () => {
    const ids = STOPED_SERVICES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('isStopedServiceId accepts catalog ids and rejects anything else', () => {
    expect(isStopedServiceId('EventLog')).toBe(true)
    expect(isStopedServiceId('DiagTrack')).toBe(true)
    expect(isStopedServiceId('Spooler')).toBe(false)
    expect(isStopedServiceId('')).toBe(false)
    expect(isStopedServiceId(null)).toBe(false)
    expect(isStopedServiceId(42)).toBe(false)
    expect(isStopedServiceId({})).toBe(false)
  })

  it('isStopedServiceId rejects case variants (SCM is case-sensitive-ish, catalog is canonical)', () => {
    expect(isStopedServiceId('eventlog')).toBe(false)
  })

  it('getStopedServiceDef returns the definition or undefined', () => {
    expect(getStopedServiceDef('SysMain')?.id).toBe('SysMain')
    expect(getStopedServiceDef('Nope')).toBeUndefined()
  })
})
