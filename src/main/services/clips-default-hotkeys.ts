import type { HotkeyBinding } from '@shared/types'

/**
 * Canonical default hotkey set — THE single source of truth.
 *
 * Historically two sets existed and disagreed:
 *  - clips-config-store DEFAULTS (new installs): F12 save 300s, F11 save 120s, Alt+1 screenshot;
 *  - clips-config-manager defaultHotkeys() (engine fallback): F8 save 60s, F9 screenshot, F10 toggleMic.
 * Both now come from this module (item 2, 2026-10-19). The C# engine keeps its own
 * standalone fallback (ConfigManager.cs:22-24, F8/F9/F10) used only when the engine runs
 * WITHOUT Electron (standalone CLI) — do NOT align that file: Electron always sends the
 * full config on engine start, so the C# fallback is unreachable in the app.
 *
 * This module is deliberately free of electron/fs imports so both the store (defaults)
 * and the manager (empty-config fallback) can import it without circular dependencies.
 */
export const DEFAULT_HOTKEYS: HotkeyBinding[] = [
  {
    id: 'hk-save-8',
    vk: 123,
    modifiers: [],
    action: 'saveClip',
    replayDurationSeconds: 300,
    enabled: true,
  },
  {
    id: 'hk-1782208376874',
    vk: 122,
    modifiers: [],
    action: 'saveClip',
    replayDurationSeconds: 120,
    enabled: true,
  },
  {
    id: 'hk-1782222941097',
    vk: 49,
    modifiers: ['Alt'],
    action: 'screenshot',
    replayDurationSeconds: 60,
    enabled: true,
  },
]

/**
 * Returns fresh copies of the canonical set (entries AND modifiers arrays), so callers
 * can never mutate the shared constant.
 */
export function defaultHotkeys(): HotkeyBinding[] {
  return DEFAULT_HOTKEYS.map((hk) => ({ ...hk, modifiers: [...hk.modifiers] }))
}
