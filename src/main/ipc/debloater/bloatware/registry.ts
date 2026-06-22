// ── Win32 uninstall cache (populated during scan, consumed during removal) ──

export const win32UninstallCommands = new Map<string, { type: 'msi' | 'exe'; command: string }>()

/** Clears cached Win32 uninstall commands — exported for testing */
export function clearWin32Cache(): void {
  win32UninstallCommands.clear()
}
