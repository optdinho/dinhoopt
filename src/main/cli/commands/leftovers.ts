import { cleanItems } from '../../services/file-utils'
import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage, formatBytes } from '../utils'

export async function handleLeftovers(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { scanForLeftovers } = await import('../../services/uninstall-leftovers')

  if (sub === 'scan' || sub === 'clean') {
    cliLog(ctx, 'Scanning for uninstall leftovers...')
    const results = await scanForLeftovers(() => null)
    const totalItems = results.reduce((s, r) => s + r.itemCount, 0)
    const totalSize = results.reduce((s, r) => s + r.totalSize, 0)
    if (ctx.json && sub === 'scan') {
      cliOut(ctx, { results, totalItems, totalSize })
    } else if (sub === 'scan') {
      cliLog(ctx, `Found ${totalItems} leftover items (${formatBytes(totalSize)})`)
      for (const r of results) cliLog(ctx, `  ${r.subcategory}: ${r.itemCount} items, ${formatBytes(r.totalSize)}`)
    }
    if (sub === 'clean') {
      if (totalItems === 0) {
        cliOut(ctx, ctx.json ? { message: 'No leftovers found' } : 'No leftovers found.')
        return ExitCode.NOTHING_FOUND
      }
      cliLog(ctx, `Cleaning ${totalItems} items (${formatBytes(totalSize)})...`)
      const itemIds = results.flatMap((r) => r.items.map((i) => i.id))
      const cleanResult = await cleanItems(itemIds)
      cliOut(ctx, cleanResult)
    }
  } else {
    cliUsage(ctx, 'dinho --cli leftovers <scan|clean>')
    return ExitCode.INVALID_ARGS
  }
}
