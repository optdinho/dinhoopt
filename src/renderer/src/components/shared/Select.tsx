import type { ComponentProps, CSSProperties } from 'react'

/**
 * The OS popup of a native `<select>` ignores the app theme: it opens with the system
 * background (white) while the text inherits `--text-primary` (white in dark mode) —
 * invisible text. Pinning the background/colour keeps the list readable in both themes.
 *
 * Callers may override it with their own themed colours; inline styles always win over
 * the caller's `className`, so any <Select> in the app is readable by construction.
 */
export const nativeSelectStyle: CSSProperties = {
  background: 'var(--card-bg)',
  color: 'var(--text-primary)',
}

/**
 * Native `<select>` with the app-theme popup fix already applied. Used everywhere instead
 * of a bare `<select>` so the fix cannot be forgotten (see `nativeSelectStyle`).
 */
export function Select({ style, ...rest }: ComponentProps<'select'>) {
  return <select {...rest} style={{ ...nativeSelectStyle, ...style }} />
}
