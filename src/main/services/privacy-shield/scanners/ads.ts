import { regQueryDword } from '../helpers'

export async function checkAdvertisingId(): Promise<boolean> {
  const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled')
  return val === 0
}

export async function checkSuggestedContent(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SubscribedContent-338393Enabled',
  )
  return val === 0
}

export async function checkTipsNotifications(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SubscribedContent-338389Enabled',
  )
  return val === 0
}

export async function checkStartSuggestions(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SystemPaneSuggestionsEnabled',
  )
  return val === 0
}

export async function checkLockScreenSpotlight(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'RotatingLockScreenEnabled',
  )
  return val === 0
}

export async function checkSilentlyInstalledApps(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SilentInstalledAppsEnabled',
  )
  return val === 0
}

export async function checkPreinstalledApps(): Promise<boolean> {
  const val = await regQueryDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'PreInstalledAppsEnabled',
  )
  return val === 0
}
