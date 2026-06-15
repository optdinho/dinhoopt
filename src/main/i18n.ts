import { getSettings } from './services/settings-store'

import pt from '../renderer/src/locales/pt/tray.json'

const resources: Record<string, Record<string, string>> = { pt }

export function t(key: string, params?: Record<string, string | number>): string {
  let lang: string
  try {
    lang = getSettings().language || 'pt'
  } catch {
    lang = 'pt'
  }
  const str = resources[lang]?.[key] ?? resources.pt![key] ?? key
  if (!params) return str
  return str.replace(/\{\{(\w+)\}\}/g, (_, k) => String(params[k] ?? ''))
}
