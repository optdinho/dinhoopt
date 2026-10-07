import { describe, expect, it } from 'vitest'
import { accumulateBatchTotals } from './batch-totals'

describe('accumulateBatchTotals', () => {
  it('soma leftoversFound separado de leftoversCleaned', () => {
    const totals = accumulateBatchTotals([
      { success: true, leftoversFound: 5, leftoversCleaned: 4, leftoversSize: 1024 },
      { success: true, leftoversFound: 3, leftoversCleaned: 2, leftoversSize: 512 },
    ])
    expect(totals).toEqual({
      successCount: 2,
      failCount: 0,
      leftoversFound: 8,
      leftoversCleaned: 6,
      leftoversSize: 1536,
    })
  })

  it('conta falhas e não soma os leftovers delas', () => {
    const totals = accumulateBatchTotals([
      { success: true, leftoversFound: 1, leftoversCleaned: 1, leftoversSize: 0 },
      { success: false, leftoversFound: 0, leftoversCleaned: 0, leftoversSize: 0 },
    ])
    expect(totals).toEqual({
      successCount: 1,
      failCount: 1,
      leftoversFound: 1,
      leftoversCleaned: 1,
      leftoversSize: 0,
    })
  })

  it('devolve zeros para lista vazia', () => {
    expect(accumulateBatchTotals([])).toEqual({
      successCount: 0,
      failCount: 0,
      leftoversFound: 0,
      leftoversCleaned: 0,
      leftoversSize: 0,
    })
  })
})
