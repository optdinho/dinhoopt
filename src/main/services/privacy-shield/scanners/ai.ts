import { isServiceEnabled, regQueryDword, serviceExists } from '../helpers'

export async function checkCopilot(): Promise<boolean> {
  const val = await regQueryDword(
    'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsCopilot',
    'TurnOffWindowsCopilot',
  )
  return val === 1
}

export async function checkWindowsRecall(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableAIDataAnalysis')
  return val === 1
}

export async function checkRecallBlocker(): Promise<boolean> {
  const enableVal = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'AllowRecallEnable')
  const saveVal = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'AllowRecallSaveState')
  return enableVal === 0 && saveVal === 0
}

export async function checkClickToDo(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\WindowsAI', 'DisableClickToDo')
  return val === 1
}

export async function checkAiServiceAutostart(): Promise<boolean> {
  return !(await isServiceEnabled('AiHost'))
}

export async function applicableAiServiceAutostart(): Promise<boolean> {
  return serviceExists('AiHost')
}

export async function checkEdgeAiFeatures(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Edge', 'ComposeInlineEnabled')
  return val === 0
}

export async function checkPaintAi(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Paint', 'DisableCocreator')
  return val === 1
}

export async function checkNotepadAi(): Promise<boolean> {
  const val = await regQueryDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\WindowsNotepad', 'DisableAIFeatures')
  return val === 1
}
