import { regDeleteValue, regSetDword } from '../helpers'

export async function applyBingStartMenu(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions', 1)
}
export function revertBingStartMenu(): Promise<void> {
  return regDeleteValue('HKCU\\SOFTWARE\\Policies\\Microsoft\\Windows\\Explorer', 'DisableSearchBoxSuggestions')
}

export async function applyBingWebSearch(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled', 0)
}
export async function revertBingWebSearch(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Search', 'BingSearchEnabled', 1)
}

export async function applyCortana(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', 'AllowCortana', 0)
}
export function revertCortana(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\Windows Search', 'AllowCortana')
}

export async function applySearchHighlights(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SearchSettings',
    'IsDynamicSearchBoxEnabled',
    0,
  )
}
export async function revertSearchHighlights(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\SearchSettings',
    'IsDynamicSearchBoxEnabled',
    1,
  )
}

export async function applyStoreSearchSuggestions(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsStore', 'DisableStoreSearchSuggestions', 1)
}
export function revertStoreSearchSuggestions(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsStore', 'DisableStoreSearchSuggestions')
}
