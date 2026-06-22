import { isTaskActive, taskExists } from '../helpers'

export async function checkTaskCompatibilityAppraiser(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser'))
}

export function applicableTaskCompatibilityAppraiser(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser')
}

export async function checkTaskProgramDataUpdater(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater'))
}

export function applicableTaskProgramDataUpdater(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater')
}

export async function checkTaskAutochkProxy(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\Autochk\\Proxy'))
}

export function applicableTaskAutochkProxy(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\Autochk\\Proxy')
}

export async function checkTaskCeipConsolidator(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator'))
}

export function applicableTaskCeipConsolidator(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator')
}

export async function checkTaskUsbCeip(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip'))
}

export function applicableTaskUsbCeip(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip')
}

export async function checkTaskDiskDiagnostic(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector'))
}

export function applicableTaskDiskDiagnostic(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector')
}

export async function checkTaskFeedbackDm(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\Feedback\\Siuf\\DmClient'))
}

export function applicableTaskFeedbackDm(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\Feedback\\Siuf\\DmClient')
}

export async function checkTaskMapsUpdate(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\Maps\\MapsUpdateTask'))
}

export function applicableTaskMapsUpdate(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\Maps\\MapsUpdateTask')
}

export async function checkTaskMapsToast(): Promise<boolean> {
  return !(await isTaskActive('\\Microsoft\\Windows\\Maps\\MapsToastTask'))
}

export function applicableTaskMapsToast(): Promise<boolean> {
  return taskExists('\\Microsoft\\Windows\\Maps\\MapsToastTask')
}
