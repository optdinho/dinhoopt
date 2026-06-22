import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliNotFound, cliOut, cliUsage } from '../utils'

export async function handleStartup(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { listStartupItems, toggleStartupItem, deleteStartupItem, getBootTrace } = await import(
    '../../ipc/startup-manager.ipc'
  )

  if (sub === 'list') {
    const items = await listStartupItems()
    if (ctx.json) {
      cliOut(ctx, items)
    } else {
      cliLog(ctx, `Found ${items.length} startup items`)
      for (const item of items) {
        const status = item.enabled ? 'enabled' : 'disabled'
        cliLog(ctx, `  [${status}] ${item.displayName || item.name} — ${item.impact || 'unknown'} impact`)
      }
    }
  } else if (sub === 'boot-trace') {
    const trace = await getBootTrace()
    cliOut(ctx, trace)
  } else if (sub === 'disable' || sub === 'enable') {
    const name = args.slice(1).join(' ')
    if (!name) {
      cliUsage(ctx, `dinho --cli startup ${sub} <name>`)
      return ExitCode.INVALID_ARGS
    }
    const items = await listStartupItems()
    const item = items.find((i) => i.name === name || i.displayName === name)
    if (!item) {
      cliNotFound(ctx, 'Startup item', name)
      return ExitCode.NOTHING_FOUND
    }
    const enabled = sub === 'enable'
    const result = await toggleStartupItem(item.name, item.location, item.command, item.source, enabled)
    cliOut(ctx, result)
  } else if (sub === 'delete') {
    const name = args.slice(1).join(' ')
    if (!name) {
      cliUsage(ctx, 'dinho --cli startup delete <name>')
      return ExitCode.INVALID_ARGS
    }
    const items = await listStartupItems()
    const item = items.find((i) => i.name === name || i.displayName === name)
    if (!item) {
      cliNotFound(ctx, 'Startup item', name)
      return ExitCode.NOTHING_FOUND
    }
    const result = await deleteStartupItem(item.name, item.location, item.source)
    cliOut(ctx, result)
  } else {
    cliUsage(ctx, 'dinho --cli startup <list|boot-trace|disable|enable|delete> [name]')
    return ExitCode.INVALID_ARGS
  }
}
