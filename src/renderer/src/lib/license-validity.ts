const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_MS = 86_400_000

export type LicenseExpiryTone = 'ok' | 'warning' | 'critical'

export interface LicenseExpiry {
  /** Data local em que a licenca expira. */
  expiresAt: Date
  /** Dias de calendario ate expirar: 0 = expira hoje, negativo = ja expirou. */
  daysLeft: number
  tone: LicenseExpiryTone
}

/**
 * Interpreta o `expires_at` devolvido pelo servidor de licencas.
 *
 * Aceita tanto uma data simples (`2026-11-23`) como um timestamp ISO completo.
 * A data simples e lida como calendario local para nao sofrer o desvio de um
 * dia tipico de `new Date('2026-11-23')` (que e meia-noite UTC). O timestamp
 * completo e convertido para a data local real do utilizador.
 */
export function getLicenseExpiry(expiresAt: string | null | undefined, now: Date = new Date()): LicenseExpiry | null {
  if (!expiresAt) return null

  let date: Date
  const dateOnly = DATE_ONLY.exec(expiresAt)
  if (dateOnly) {
    const year = Number(dateOnly[1])
    const month = Number(dateOnly[2])
    const day = Number(dateOnly[3])
    date = new Date(year, month - 1, day)
    // `new Date(2026, 1, 30)` transborda para marco. Rejeitar em vez de mostrar
    // uma validade que o servidor nunca quis dizer.
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      return null
    }
  } else {
    date = new Date(expiresAt)
    if (Number.isNaN(date.getTime())) return null
  }

  const expiryDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  const daysLeft = Math.round((expiryDay - today) / DAY_MS)

  return { expiresAt: date, daysLeft, tone: expiryTone(daysLeft) }
}

export function expiryTone(daysLeft: number): LicenseExpiryTone {
  if (daysLeft <= 3) return 'critical'
  if (daysLeft <= 7) return 'warning'
  return 'ok'
}
