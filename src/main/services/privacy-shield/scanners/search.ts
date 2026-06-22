import { regQueryDword } from '../helpers'

export async function checkBingStartMenu(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer',
    'DisableSearchBoxSuggestions',
  )
  return val === 1
}

export async function checkBingWebSearch(): Promise<boolean> {
  const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled')
  return val === 0
}

export async function checkCortana(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', 'AllowCortana')
  return val === 0
}

export async function checkSearchHighlights(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SearchSettings',
    'IsDynamicSearchBoxEnabled',
  )
  return val === 0
}

export async function checkStoreSearchSuggestions(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsStore', 'DisableStoreSearchSuggestions')
  return val === 1
}
