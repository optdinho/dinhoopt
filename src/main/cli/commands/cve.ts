import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage } from '../utils'

export async function handleCve(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]

  if (sub === 'list') {
    const emptyResult = {
      vulnerabilities: [],
      summary: { critical: 0, high: 0, medium: 0, low: 0 },
      total: 0,
      librarySize: 0,
    }
    if (ctx.json) {
      cliOut(ctx, emptyResult)
    } else {
      cliLog(ctx, '  No vulnerabilities found (cloud system no longer available).')
    }
    return ExitCode.SUCCESS
  }
  cliUsage(ctx, 'dinho --cli cve <list>')
  return ExitCode.INVALID_ARGS
}
