export const SEVERITY_STYLES_BASE: Record<string, { bg: string; border: string; text: string; labelKey: string }> = {
  major: {
    bg: 'rgba(239,68,68,0.08)',
    border: 'rgba(239,68,68,0.18)',
    text: '#f87171',
    labelKey: 'softwareUpdater.severityMajor',
  },
  minor: {
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.18)',
    text: '#fbbf24',
    labelKey: 'softwareUpdater.severityMinor',
  },
  patch: {
    bg: 'rgba(34,197,94,0.08)',
    border: 'rgba(34,197,94,0.18)',
    text: '#4ade80',
    labelKey: 'softwareUpdater.severityPatch',
  },
  unknown: {
    bg: 'rgba(113,113,122,0.08)',
    border: 'rgba(113,113,122,0.18)',
    text: '#a1a1aa',
    labelKey: 'softwareUpdater.severityUpdate',
  },
}

export const SORT_LABEL_KEYS: Record<string, string> = {
  name: 'softwareUpdater.sortName',
  severity: 'softwareUpdater.sortSeverity',
  source: 'softwareUpdater.sortSource',
}

export const FILTER_LABEL_KEYS: Record<string, string> = {
  all: 'softwareUpdater.filterAll',
  major: 'softwareUpdater.filterMajor',
  minor: 'softwareUpdater.filterMinor',
  patch: 'softwareUpdater.filterPatch',
}

export type SeverityFilterValue = keyof typeof FILTER_LABEL_KEYS
export type SortFieldValue = keyof typeof SORT_LABEL_KEYS
