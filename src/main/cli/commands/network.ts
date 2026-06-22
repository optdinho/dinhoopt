import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage } from '../utils'

export async function handleNetwork(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { scanNetwork, cleanNetworkItems } = await import('../../ipc/network-cleanup.ipc')

  if (sub === 'scan') {
    cliLog(ctx, 'Scanning network...')
    const items = await scanNetwork()
    if (ctx.json) {
      cliOut(ctx, { items, count: items.length })
    } else {
      cliLog(ctx, `Found ${items.length} network items`)
      for (const item of items) cliLog(ctx, `  [${item.type}] ${item.label} — ${item.detail}`)
    }
  } else if (sub === 'clean') {
    cliLog(ctx, 'Scanning network...')
    const items = await scanNetwork()
    if (items.length === 0) {
      cliOut(ctx, ctx.json ? { message: 'Nothing to clean' } : 'No network items found.')
      return
    }
    const toClean = args.includes('--all') ? items : items.filter((i) => i.selected)
    cliLog(ctx, `Cleaning ${toClean.length} items...`)
    const result = await cleanNetworkItems(toClean)
    cliOut(ctx, result)
  } else {
    cliUsage(ctx, 'dinho --cli network <scan|clean> [--all]')
    return ExitCode.INVALID_ARGS
  }
}
