import { regDeleteValue, regSetDword } from '../helpers'

export async function applyClipboardSync(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'AllowCrossDeviceClipboard', 0)
}
export function revertClipboardSync(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'AllowCrossDeviceClipboard')
}

export async function applyClipboardHistory(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Clipboard', 'EnableClipboardHistory', 0)
}
export async function revertClipboardHistory(): Promise<void> {
  await regSetDword('HKCU\\SOFTWARE\\Microsoft\\Clipboard', 'EnableClipboardHistory', 1)
}

export async function applySettingsSync(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\SettingSync', 'DisableSettingSync', 2)
}
export function revertSettingsSync(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\SettingSync', 'DisableSettingSync')
}

export async function applyFindMyDevice(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Microsoft\\MdmCommon\\SettingValues', 'LocationSyncEnabled', 0)
}
export async function revertFindMyDevice(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Microsoft\\MdmCommon\\SettingValues', 'LocationSyncEnabled', 1)
}
