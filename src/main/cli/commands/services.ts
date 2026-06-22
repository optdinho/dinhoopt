import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage } from '../utils'

export async function handleServices(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { scanServices, applyServiceChanges } = await import('../../ipc/service-manager.ipc')

  if (sub === 'scan') {
    cliLog(ctx, 'Scanning services...')
    const result = await scanServices()
    if (ctx.json) {
      cliOut(ctx, { services: result.services, count: result.services.length })
    } else {
      cliLog(ctx, `Found ${result.services.length} optimizable services`)
      for (const s of result.services)
        cliLog(ctx, `  [${s.startType}] ${s.displayName} (${s.name}) — ${s.description || ''}`)
    }
  } else if (sub === 'disable' || sub === 'manual') {
    const name = args
      .slice(1)
      .filter((a) => !a.startsWith('--'))
      .join(' ')
    if (!name) {
      cliUsage(ctx, `dinho --cli services ${sub} <service-name>`)
      return ExitCode.INVALID_ARGS
    }
    const targetType = sub === 'disable' ? 'Disabled' : 'Manual'
    cliLog(ctx, `Setting ${name} to ${targetType}...`)
    const result = await applyServiceChanges([{ name, targetStartType: targetType }])
    cliOut(ctx, result)
  } else {
    cliUsage(ctx, 'dinho --cli services <scan|disable|manual> [service-name]')
    return ExitCode.INVALID_ARGS
  }
}
