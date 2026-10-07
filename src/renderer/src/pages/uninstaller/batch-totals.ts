export interface UninstallOutcome {
  success: boolean
  leftoversFound: number
  leftoversCleaned: number
  leftoversSize: number
}

export interface BatchUninstallTotals {
  successCount: number
  failCount: number
  leftoversFound: number
  leftoversCleaned: number
  leftoversSize: number
}

export function accumulateBatchTotals(results: UninstallOutcome[]): BatchUninstallTotals {
  let successCount = 0
  let failCount = 0
  let leftoversFound = 0
  let leftoversCleaned = 0
  let leftoversSize = 0
  for (const result of results) {
    if (result.success) successCount++
    else failCount++
    leftoversFound += result.leftoversFound
    leftoversCleaned += result.leftoversCleaned
    leftoversSize += result.leftoversSize
  }
  return { successCount, failCount, leftoversFound, leftoversCleaned, leftoversSize }
}
