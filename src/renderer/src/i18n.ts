import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const LOCALES = ['pt', 'en', 'es'] as const

const localeModules = import.meta.glob('./locales/**/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, string> }
>

const resources: Record<string, Record<string, Record<string, string>>> = {}

for (const [path, module] of Object.entries(localeModules)) {
  const parts = path.split('/')
  const lang = parts[parts.length - 2]
  const ns = parts[parts.length - 1]!.replace('.json', '')
  if (!lang || !(LOCALES as readonly string[]).includes(lang)) continue
  resources[lang] ??= {}
  resources[lang][ns] = module.default
}

i18n.use(initReactI18next).init({
  resources,
  lng: 'pt',
  fallbackLng: 'pt',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
})

export default i18n
