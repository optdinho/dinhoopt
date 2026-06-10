export const LANGUAGES = [
  { code: 'pt', name: 'Portuguese', nativeName: 'Português' },
  { code: 'en', name: 'English', nativeName: 'English' },
  { code: 'es', name: 'Spanish', nativeName: 'Español' }
] as const

export type LanguageCode = (typeof LANGUAGES)[number]['code']

export const RTL_LANGUAGES: readonly string[] = ['ar', 'he']
