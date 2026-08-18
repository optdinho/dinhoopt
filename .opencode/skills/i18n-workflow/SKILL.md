---
name: i18n-workflow
description: >
  Internationalization patterns for DiNho Optimizer's React renderer.
  react-i18next hooks, locale file structure, namespace conventions,
  adding new keys, and avoiding common pitfalls.
origin: project
date_added: 2026-08-17
---

# i18n Workflow — DiNho Optimizer

## Locale Structure

```
src/renderer/src/locales/
├── en/          # English (fallback)
│   ├── common.json
│   ├── dashboard.json
│   ├── clips.json
│   ├── malware.json
│   ├── privacy.json
│   └── ...
├── pt/          # Portuguese (default)
│   └── ...
└── es/          # Spanish
    └── ...
```

**Key rule:** `en` is the fallback language. All keys must exist in `en` first.

## Namespaces

Each locale file is a **namespace**. Usage in components:

```tsx
// Domain-specific namespace
const { t } = useTranslation('clips');
const { t } = useTranslation('malware');
const { t } = useTranslation('dashboard');

// Common namespace (no argument)
const { t } = useTranslation();
```

Namespaces are registered in `src/renderer/src/i18n.ts` via `i18next.init()` resources config.

## Adding New Keys

1. Add key to `en/<namespace>.json` first (canonical)
2. Add translations to `pt/<namespace>.json` and `es/<namespace>.json`
3. Use snake_case for key names: `clipSaved`, `scanComplete`, `replayTimeLabel`
4. Group related keys: prefix with feature name if ambiguous

```jsonc
// en/clips.json
{
  "clipSaved": "Clip saved",
  "replayTime": "Replay time",
  "replayTimeLabel": "{{seconds}}s replay buffer"
}
```

## Component Patterns

```tsx
import { useTranslation } from 'react-i18next';

// Simple string
const label = t('clipSaved');

// With interpolation
const msg = t('replayTimeLabel', { seconds: 120 });

// Pluralization
const count = t('filesFound', { count: 5 });

// Namespace switch
const { t } = useTranslation('malware');
const title = t('scanTitle');
```

## Layout Patterns (Labels + Values)

```tsx
// Inline label + value (common in dashboard/clips)
<span>{t('replayTime')}: </span>
<span>{replayTime}s</span>

// Stat card pattern
<div className="flex items-center justify-between">
  <span className="text-sm text-muted-foreground">{t('memoryUsage')}</span>
  <span className="font-mono">{memoryMB}MB</span>
</div>
```

## Checking Locale Completeness

```bash
# Find keys in en but missing in pt
npx ts-node scripts/check-locales.ts  # if exists, or:
node -e "const en=require('./locales/en/clips.json'); const pt=require('./locales/pt/clips.json'); Object.keys(en).forEach(k => !(k in pt) && console.log('missing pt:', k))"
```

## Common Pitfalls

1. **Hardcoded strings in JSX** — always use `t()`, never bare strings for user-facing text
2. **Missing fallback** — `t('key')` returns the key itself if missing; always test with `en` as fallback
3. **Console.log instead of renderer log** — renderer logs go through IPC (`window.dinho?.log()`)
4. **Namespace mismatch** — `useTranslation('clips')` but key is in `common.json` = shows raw key
5. **Right-to-left not needed** — all supported locales are LTR

## Locale Config

```ts
// src/renderer/src/i18n.ts
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

i18n.use(initReactI18next).init({
  resources: { en: { common: enCommon, clips: enClips }, pt: { ... }, es: { ... } },
  lng: localStorage.getItem('language') || 'pt',  // default Portuguese
  fallbackLng: 'en',
  ns: ['common'],
  interpolation: { escapeValue: false },  // React already escapes
});
```

## Adding a New Locale

1. Create `src/renderer/src/locales/<code>/` directory
2. Copy all namespace JSONs from `en/` as templates
3. Translate all values
4. Register in `i18n.ts` resources config
5. Add language option to settings UI (if applicable)

## Testing i18n in Components

```tsx
// Mock i18next in tests
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,  // returns raw key for assertions
    i18n: { language: 'en' },
  }),
}));

// Assert key is used
expect(screen.getByText('clipSaved')).toBeInTheDocument();
```
