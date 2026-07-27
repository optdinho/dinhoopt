import { PerfMonitorService } from '../../services/perf-monitor'
import type { CliContext } from '../types'
import { ExitCode } from '../types'
import { cliLog, cliOut, cliUsage, formatBytes } from '../utils'

export async function handlePerf(args: string[], ctx: CliContext): Promise<number | undefined> {
  const sub = args[0]
  const perf = new PerfMonitorService()

  if (sub === 'info') {
    const info = await perf.getSystemInfo()
    if (ctx.json) {
      cliOut(ctx, info)
    } else {
      cliLog(ctx, `  CPU: ${info.cpuModel} (${info.cpuCores}C/${info.cpuThreads}T)`)
      cliLog(ctx, `  RAM: ${formatBytes(info.totalMemBytes)}`)
      cliLog(ctx, `  OS:  ${info.osVersion}`)
      cliLog(ctx, `  Host: ${info.hostname}`)
    }
  } else if (sub === 'disk-health') {
    cliLog(ctx, 'Checking disk health...')
    const disks = await perf.getDiskHealth()
    if (ctx.json) {
      cliOut(ctx, disks)
    } else {
      for (const d of disks) {
        cliLog(ctx, `  ${d.model} (${d.type}) — ${d.healthStatus}`)
        if (d.temperature) cliLog(ctx, `    Temperature: ${d.temperature}°C`)
        if (d.remainingLife !== null) cliLog(ctx, `    Remaining life: ${d.remainingLife}%`)
        if (d.powerOnHours !== null) cliLog(ctx, `    Power-on hours: ${d.powerOnHours}`)
      }
    }
  } else if (sub === 'kill') {
    const pid = Number.parseInt(args[1]!, 10)
    if (Number.isNaN(pid)) {
      cliUsage(ctx, 'dinho --cli perf kill <pid>')
      return ExitCode.INVALID_ARGS
    }
    const result = await perf.killProcess(pid)
    cliOut(ctx, result)
  } else {
    cliUsage(ctx, 'dinho --cli perf <info|disk-health|kill> [pid]')
    return ExitCode.INVALID_ARGS
  }
}
