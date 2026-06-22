import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage, cliVerbose, log, showProgress } from '../utils'

export async function handleRegistry(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { scanRegistry, fixRegistryEntries } = await import('../../ipc/registry-cleaner.ipc')

  if (sub === 'scan') {
    cliLog(ctx, 'Scanning registry...')
    const startTime = Date.now()
    const entries = await scanRegistry()
    cliVerbose(ctx, `Registry scan completed in ${Date.now() - startTime}ms`)
    if (ctx.json) {
      cliOut(ctx, { entries, count: entries.length })
    } else {
      cliLog(ctx, `Found ${entries.length} registry issues`)
      for (const e of entries) cliLog(ctx, `  [${e.risk}] ${e.keyPath} — ${e.issue}`)
    }
  } else if (sub === 'fix') {
    cliLog(ctx, 'Scanning registry...')
    const entries = await scanRegistry()
    if (entries.length === 0) {
      cliOut(ctx, ctx.json ? { message: 'No issues found' } : 'No registry issues found.')
      return
    }
    const toFix = args.includes('--all') ? entries : entries.filter((e) => e.risk === 'high')
    cliLog(ctx, `Fixing ${toFix.length} of ${entries.length} issues...`)
    const result = await fixRegistryEntries(toFix, (current, total) => {
      if (showProgress(ctx)) process.stdout.write(`\r  Progress: ${current}/${total}`)
    })
    if (showProgress(ctx)) log('')
    cliOut(ctx, result)
  } else {
    cliUsage(ctx, 'dinho --cli registry <scan|fix> [--all] [--json]')
    return ExitCode.INVALID_ARGS
  }
}
