import { disableService, enableService, regDeleteValue, regSetDword } from '../helpers'

export async function applyServiceDiagtrack(): Promise<void> {
  await disableService('DiagTrack')
}
export async function revertServiceDiagtrack(): Promise<void> {
  await enableService('DiagTrack')
}

export async function applyServiceDmwappush(): Promise<void> {
  await disableService('dmwappushservice')
}
export async function revertServiceDmwappush(): Promise<void> {
  await enableService('dmwappushservice')
}

export async function applyServiceDeliveryOptimization(): Promise<void> {
  await regSetDword('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization', 'DODownloadMode', 0)
}
export function revertServiceDeliveryOptimization(): Promise<void> {
  return regDeleteValue('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization', 'DODownloadMode')
}

export async function applyServiceMapsbroker(): Promise<void> {
  await disableService('MapsBroker')
}
export async function revertServiceMapsbroker(): Promise<void> {
  await enableService('MapsBroker')
}
