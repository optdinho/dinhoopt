import { disableService, enableService, regDeleteValue, regSetDword } from '../helpers'

export async function applyCopilot(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot', 'TurnOffWindowsCopilot', 1)
}
export function revertCopilot(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot', 'TurnOffWindowsCopilot')
}

export async function applyWindowsRecall(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableAIDataAnalysis', 1)
}
export function revertWindowsRecall(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableAIDataAnalysis')
}

export async function applyClickToDo(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableClickToDo', 1)
}
export function revertClickToDo(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableClickToDo')
}

export async function applyAiServiceAutostart(): Promise<void> {
  await disableService('AiHost')
}
export async function revertAiServiceAutostart(): Promise<void> {
  await enableService('AiHost')
}

export async function applyEdgeAiFeatures(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'ComposeInlineEnabled', 0)
}
export function revertEdgeAiFeatures(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'ComposeInlineEnabled')
}

export async function applyPaintAi(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Paint', 'DisableCocreator', 1)
}
export function revertPaintAi(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Paint', 'DisableCocreator')
}

export async function applyNotepadAi(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsNotepad', 'DisableAIFeatures', 1)
}
export function revertNotepadAi(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsNotepad', 'DisableAIFeatures')
}
