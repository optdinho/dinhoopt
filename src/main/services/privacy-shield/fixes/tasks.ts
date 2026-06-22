import { disableTask, enableTask } from '../helpers'

export async function applyTaskCompatibilityAppraiser(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser')
}
export async function revertTaskCompatibilityAppraiser(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\Application Experience\\Microsoft Compatibility Appraiser')
}

export async function applyTaskProgramDataUpdater(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater')
}
export async function revertTaskProgramDataUpdater(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\Application Experience\\ProgramDataUpdater')
}

export async function applyTaskAutochkProxy(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\Autochk\\Proxy')
}
export async function revertTaskAutochkProxy(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\Autochk\\Proxy')
}

export async function applyTaskCeipConsolidator(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator')
}
export async function revertTaskCeipConsolidator(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\Customer Experience Improvement Program\\Consolidator')
}

export async function applyTaskUsbCeip(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip')
}
export async function revertTaskUsbCeip(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\Customer Experience Improvement Program\\UsbCeip')
}

export async function applyTaskDiskDiagnostic(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector')
}
export async function revertTaskDiskDiagnostic(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\DiskDiagnostic\\Microsoft-Windows-DiskDiagnosticDataCollector')
}

export async function applyTaskFeedbackDm(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\Feedback\\Siuf\\DmClient')
}
export async function revertTaskFeedbackDm(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\Feedback\\Siuf\\DmClient')
}

export async function applyTaskMapsUpdate(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\Maps\\MapsUpdateTask')
}
export async function revertTaskMapsUpdate(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\Maps\\MapsUpdateTask')
}

export async function applyTaskMapsToast(): Promise<void> {
  await disableTask('\\Microsoft\\Windows\\Maps\\MapsToastTask')
}
export async function revertTaskMapsToast(): Promise<void> {
  await enableTask('\\Microsoft\\Windows\\Maps\\MapsToastTask')
}
