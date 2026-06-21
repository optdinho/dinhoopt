import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

const LOCALES = ['pt', 'en', 'es'] as const

// Eagerly load only the default language (pt) to minimize initial bundle
const defaultLocaleModules = import.meta.glob<{ default: Record<string, string> }>('./locales/pt/**/*.json', {
  eager: true,
})

// Lazy glob for all languages (for on-demand loading of en/es)
const allLocaleModules = import.meta.glob<{ default: Record<string, string> }>('./locales/**/*.json')

const resources: Record<string, Record<string, Record<string, string>>> = {}

for (const [path, module] of Object.entries(defaultLocaleModules)) {
  const parts = path.split('/')
  const lang = parts[parts.length - 2]
  const ns = parts[parts.length - 1]!.replace('.json', '')
  if (!lang || !(LOCALES as readonly string[]).includes(lang)) continue
  resources[lang] ??= {}
  resources[lang][ns] = module.default
}

async function loadLanguage(lang: string) {
  if (i18n.hasResourceBundle(lang, 'common')) return

  const prefix = `./locales/${lang}/`
  const loaders = Object.entries(allLocaleModules).filter(([path]) => path.startsWith(prefix))

  await Promise.all(
    loaders.map(async ([path, loader]) => {
      const ns = path.split('/').pop()!.replace('.json', '')
      const mod = await loader()
      i18n.addResourceBundle(lang, ns, mod.default, true, true)
    }),
  )
}

i18n.use(initReactI18next).init({
  resources,
  lng: 'pt',
  fallbackLng: 'pt',
  defaultNS: 'common',
  interpolation: { escapeValue: false },
  partialBundledLanguages: true,
})

// Lazy-load non-default languages on switch
i18n.on('languageChanged', async (lng) => {
  await loadLanguage(lng)
})

export default i18n
