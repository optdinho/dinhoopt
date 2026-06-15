import { describe, expect, it } from 'vitest'
import { AGENT_IDS } from './driver-agent-types'

describe('driver-agent-types', () => {
  it('AGENT_IDS has all expected agent IDs', () => {
    expect(AGENT_IDS).toEqual([
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
    ])
  })

  it('AGENT_IDS has exactly 10 entries', () => {
    expect(AGENT_IDS.length).toBe(10)
  })

  it('AGENT_IDS contains no duplicates', () => {
    expect(AGENT_IDS.length).toBe(new Set(AGENT_IDS).size)
  })
})
