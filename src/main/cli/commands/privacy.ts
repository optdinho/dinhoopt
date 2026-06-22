import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage } from '../utils'

export async function handlePrivacy(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const { scanPrivacy, applyPrivacySettings } = await import('../../ipc/privacy-shield.ipc')

  if (sub === 'scan') {
    cliLog(ctx, 'Scanning privacy settings...')
    const result = await scanPrivacy()
    if (ctx.json) {
      cliOut(ctx, { settings: result.settings, count: result.settings.length })
    } else {
      cliLog(ctx, `Found ${result.settings.length} privacy settings`)
      for (const s of result.settings) {
        const status = s.enabled ? 'ON' : 'OFF'
        cliLog(ctx, `  [${status}] ${s.label} — ${s.description}`)
      }
    }
  } else if (sub === 'apply') {
    cliLog(ctx, 'Scanning privacy settings...')
    const scanResult = await scanPrivacy()
    const toApply = args.includes('--all')
      ? scanResult.settings.map((s) => s.id)
      : scanResult.settings.filter((s) => !s.enabled).map((s) => s.id)
    if (toApply.length === 0) {
      cliOut(ctx, ctx.json ? { message: 'Nothing to apply' } : 'All recommended settings already applied.')
      return
    }
    cliLog(ctx, `Applying ${toApply.length} privacy settings...`)
    const applyResult = await applyPrivacySettings(toApply)
    cliOut(ctx, applyResult)
  } else {
    cliUsage(ctx, 'dinho --cli privacy <scan|apply> [--all]')
    return ExitCode.INVALID_ARGS
  }
}
