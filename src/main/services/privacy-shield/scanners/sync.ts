import { regQueryDword } from '../helpers'

export async function checkClipboardSync(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'AllowCrossDeviceClipboard')
  return val === 0
}

export async function checkClipboardHistory(): Promise<boolean> {
  const val = await regQueryDword('HKCU\\SOFTWARE\\Microsoft\\Clipboard', 'EnableClipboardHistory')
  return val === 0
}

export async function checkSettingsSync(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\SettingSync', 'DisableSettingSync')
  return val === 2
}

export async function checkFindMyDevice(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Microsoft\\MdmCommon\\SettingValues', 'LocationSyncEnabled')
  return val === 0
}
