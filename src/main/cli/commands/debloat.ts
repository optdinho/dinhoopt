import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage } from '../utils'

export async function handleDebloat(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { scanBloatware, removeBloatware } = await import('../../ipc/debloater.ipc')

  if (sub === 'scan') {
    cliLog(ctx, 'Scanning for bloatware...')
    const apps = await scanBloatware()
    if (ctx.json) {
      cliOut(ctx, { apps, count: apps.length })
    } else {
      cliLog(ctx, `Found ${apps.length} removable apps`)
      for (const a of apps) cliLog(ctx, `  ${a.name} (${a.packageName}) — ${a.size} — ${a.description}`)
    }
  } else if (sub === 'remove') {
    const allFlag = args.includes('--all')
    if (allFlag) {
      cliLog(ctx, 'Scanning for bloatware...')
      const apps = await scanBloatware()
      if (apps.length === 0) {
        cliOut(ctx, ctx.json ? { message: 'No bloatware found' } : 'No bloatware found.')
        return
      }
      const packageNames = apps.map((a) => a.packageName)
      cliLog(ctx, `Removing ${packageNames.length} apps...`)
      const result = await removeBloatware(packageNames, (current, total, currentApp, status) => {
        cliLog(ctx, `  [${current}/${total}] ${currentApp}: ${status}`)
      })
      cliOut(ctx, result)
    } else {
      const pkgArg = args.find((a) => a !== 'remove' && !a.startsWith('--'))
      if (!pkgArg) {
        cliUsage(ctx, 'dinho --cli debloat remove <pkg1,pkg2,...> or --all')
        return ExitCode.INVALID_ARGS
      }
      const packageNames = pkgArg
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      cliLog(ctx, `Removing ${packageNames.length} apps...`)
      const result = await removeBloatware(packageNames, (current, total, currentApp, status) => {
        cliLog(ctx, `  [${current}/${total}] ${currentApp}: ${status}`)
      })
      cliOut(ctx, result)
    }
  } else {
    cliUsage(ctx, 'dinho --cli debloat <scan|remove> [packages|--all]')
    return ExitCode.INVALID_ARGS
  }
}
