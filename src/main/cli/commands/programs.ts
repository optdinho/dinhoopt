import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage, formatBytes } from '../utils'

export async function handlePrograms(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { getInstalledProgramsFull } = await import('../../services/program-uninstaller')

  if (sub === 'list') {
    cliLog(ctx, 'Loading installed programs...')
    const programs = await getInstalledProgramsFull()
    if (ctx.json) {
      cliOut(ctx, { programs, count: programs.length })
    } else {
      cliLog(ctx, `Found ${programs.length} installed programs`)
      for (const p of programs)
        cliLog(
          ctx,
          `  ${p.displayName} ${p.displayVersion || ''} — ${p.publisher || 'Unknown publisher'} — ${p.estimatedSize ? formatBytes(p.estimatedSize * 1024) : ''}`,
        )
    }
  } else {
    cliUsage(ctx, 'dinho --cli programs list')
    return ExitCode.INVALID_ARGS
  }
}
