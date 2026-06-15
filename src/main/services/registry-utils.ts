import { execNativeUtf8 } from './exec-utf8'

/** Executes a reg.exe command with standard args */
export async function execReg(
  args: string[],
  opts?: { timeout?: number; signal?: AbortSignal },
): Promise<{ stdout: string; stderr: string }> {
  return execNativeUtf8('reg', args, opts)
}

/** All three Uninstall registry paths */
export const REGISTRY_UNINSTALL_PATHS = [
  'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
] as const

/** Parse a specific REG_SZ value from reg query output */
export function parseRegValue(output: string, valueName: string): string | null {
  const regex = new RegExp(`\\s+${escapeRegex(valueName)}\\s+REG_SZ\\s+(.+)`, 'i')
  const match = output.match(regex)
  return match ? match[1]!.trim() : null
}

/** Parse a REG_DWORD value from reg query output */
export function parseRegDword(output: string, valueName: string): number | null {
  const regex = new RegExp(`\\s+${escapeRegex(valueName)}\\s+REG_DWORD\\s+0x([0-9a-fA-F]+)`, 'i')
  const match = output.match(regex)
  return match ? Number.parseInt(match[1]!, 16) : null
}

/** Extract a registry key path value from command output (REG_EXPAND_SZ or REG_SZ) */
export function extractRegistryKey(output: string, displayName: string): string | null {
  const regex = new RegExp(`\\s+${escapeRegex(displayName)}\\s+REG_\\w+\\s+(.+)`, 'i')
  const match = output.match(regex)
  return match ? match[1]!.trim() : null
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
