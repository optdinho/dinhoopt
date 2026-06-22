export type Verbosity = 'quiet' | 'normal' | 'verbose'

export interface CliContext {
  json: boolean
  verbosity: Verbosity
}

export const ExitCode = {
  SUCCESS: 0,
  GENERAL_ERROR: 1,
  INVALID_ARGS: 2,
  PERMISSION_DENIED: 3,
  PARTIAL_SUCCESS: 4,
  NOTHING_FOUND: 5,
  UNKNOWN_COMMAND: 6,
  SCAN_THREATS: 7,
} as const

export interface ParsedCliArgs {
  command: string | undefined
  commandArgs: string[]
  ctx: CliContext
  help: boolean
  version: boolean
  hasLegacyFlags: boolean
  hasCleanFlag: boolean
}
