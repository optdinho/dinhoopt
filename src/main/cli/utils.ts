import type { CliContext } from './types'

export function log(msg: string): void {
  process.stdout.write(`${msg}\n`)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** i).toFixed(2)} ${units[i]}`
}

export function cliLog(ctx: CliContext, msg: string): void {
  if (ctx.verbosity === 'quiet') return
  process.stdout.write(`${msg}\n`)
}

export function cliVerbose(ctx: CliContext, msg: string): void {
  if (ctx.verbosity !== 'verbose') return
  process.stdout.write(`  [verbose] ${msg}\n`)
}

export function cliOut(ctx: CliContext, data: unknown): void {
  if (ctx.json) {
    log(JSON.stringify(data, null, 2))
  } else if (ctx.verbosity === 'quiet') {
    return
  } else if (Array.isArray(data)) {
    for (const item of data) {
      if (typeof item === 'string') log(`  ${item}`)
      else log(`  ${JSON.stringify(item)}`)
    }
  } else if (typeof data === 'object' && data !== null) {
    for (const [k, v] of Object.entries(data)) {
      log(`  ${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
    }
  } else {
    log(String(data))
  }
}

export function cliUsage(ctx: CliContext, usage: string): void {
  if (ctx.json) {
    log(JSON.stringify({ error: 'invalid_usage', usage }))
  } else {
    log(`Usage: ${usage}`)
  }
}

export function cliNotFound(ctx: CliContext, type: string, name: string): void {
  if (ctx.json) {
    log(JSON.stringify({ error: 'not_found', type, name }))
  } else {
    log(`${type} not found: ${name}`)
  }
}

export function showProgress(ctx: CliContext): boolean {
  return ctx.verbosity !== 'quiet' && !ctx.json
}

export function printHelp(): void {
  log(
    `

DiNho CLI — Full-featured command line interface

Usage:
  dinho --cli <command> [subcommand] [options]
  dinho --daemon [--api-key <key>]

Daemon Mode:
  --daemon                     Start as headless daemon

File Cleaners (legacy flags also supported):
  scan [--system] [--browser] [--app] [--gaming] [--recycle-bin] [--all]
  clean [--system] [--browser] [--app] [--gaming] [--recycle-bin] [--all]

Registry:
  registry scan              Scan for registry issues
  registry fix [--all]       Fix found registry issues

Startup Manager:
  startup list               List startup items
  startup boot-trace         Show boot time trace
  startup disable <name>     Disable a startup item
  startup enable <name>      Enable a startup item
  startup delete <name>      Delete a startup item

Debloater:
  debloat scan               Scan for removable bloatware
  debloat remove <pkg,...>   Remove specified packages (comma-separated)
  debloat remove --all       Remove all detected bloatware

Disk Analyzer:
  disk drives                List available drives
  disk analyze <drive>       Analyze disk usage (e.g. disk analyze C)
  disk file-types <drive>    Analyze file types on a drive

Network Cleanup:
  network scan               Scan DNS cache, Wi-Fi profiles, ARP cache
  network clean [--all]      Clean selected network items

Malware Scanner:
  malware scan               Scan for malware threats
  malware quarantine <path>  Quarantine a detected file
  malware delete <path>      Delete a detected file

Privacy Shield:
  privacy scan               Scan privacy settings
  privacy apply [--all]      Apply recommended privacy settings

Driver Manager:
  drivers scan               Scan for old/unused driver packages
  drivers clean <name,...>   Remove specified driver packages
  drivers check-updates      Check for driver updates
  drivers update [--all]     Install driver updates

Service Manager:
  services scan              Scan Windows services
  services disable <name>    Set service to disabled
  services manual <name>     Set service to manual start

Program Uninstaller:
  programs list              List installed programs

Software Updater:
  updates check              Check for software updates (via winget)
  updates run <id,...>       Update specified apps
  updates run --all          Update all available apps

Performance Monitor:
  perf info                  Show system information
  perf disk-health           Show disk S.M.A.R.T. health
  perf kill <pid>            Kill a process by PID

Uninstall Leftovers:
  leftovers scan             Scan for uninstall leftovers
  leftovers clean            Clean found leftovers

CVE Scanner:
  cve list                   List known CVE vulnerabilities

Scan History:
  history list               Show scan history
  history clear              Clear scan history

Config Management:
  config get [key]             Show settings
  config set <key> <value>     Update a setting


Prometheus Metrics:
  metrics                    Print current metrics (Prometheus text format)
  metrics-server [--port N]  Start HTTP metrics endpoint (default: port 9100)

Global Options:
  --json          Output as JSON
  --verbose       Show detailed progress, timing, and debug info
  -q, --quiet     Suppress all output except errors and final result
  --all           Select all items for action commands
  -h, --help      Show this help
  -v, --version   Show version

Exit Codes:
  0  Success
  1  General error
  2  Invalid arguments
  3  Permission denied (needs elevation)
  4  Partial success (some operations failed)
  5  Nothing found (scan returned zero items)
  6  Unknown command
  7  Threats/issues found requiring attention

Examples:
  dinho --cli scan --all --clean        Scan & clean all file categories
  dinho --cli registry scan --json      Scan registry, JSON output
  dinho --cli debloat scan              List removable bloatware
  dinho --cli startup list              Show startup items
  dinho --cli malware scan              Run malware scan
  dinho --cli perf info                 Show system specs
  dinho --cli metrics                   Print Prometheus metrics
  dinho --cli metrics-server --port 9200  Start metrics endpoint
   dinho --daemon                        Run headless daemon
`.trim(),
  )
}
