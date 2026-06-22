import { regDeleteValue, regSetDword } from '../helpers'

export async function applyAdvertisingId(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled', 0)
}
export async function revertAdvertisingId(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AdvertisingInfo', 'Enabled', 1)
}

export async function applySuggestedContent(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SubscribedContent-338393Enabled',
    0,
  )
}
export async function revertSuggestedContent(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SubscribedContent-338393Enabled',
    1,
  )
}

export async function applyTipsNotifications(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SubscribedContent-338389Enabled',
    0,
  )
}
export async function revertTipsNotifications(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SubscribedContent-338389Enabled',
    1,
  )
}

export async function applyStartSuggestions(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SystemPaneSuggestionsEnabled',
    0,
  )
}
export async function revertStartSuggestions(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SystemPaneSuggestionsEnabled',
    1,
  )
}

export async function applyLockScreenSpotlight(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'RotatingLockScreenEnabled',
    0,
  )
}
export async function revertLockScreenSpotlight(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'RotatingLockScreenEnabled',
    1,
  )
}

export async function applySilentlyInstalledApps(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SilentInstalledAppsEnabled',
    0,
  )
}
export async function revertSilentlyInstalledApps(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'SilentInstalledAppsEnabled',
    1,
  )
}

export async function applyPreinstalledApps(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'PreInstalledAppsEnabled',
    0,
  )
}
export async function revertPreinstalledApps(): Promise<void> {
  await regSetDword(
    'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\ContentDeliveryManager',
    'PreInstalledAppsEnabled',
    1,
  )
}
