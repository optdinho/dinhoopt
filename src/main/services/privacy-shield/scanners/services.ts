import { isServiceEnabled, regQueryDword, serviceExists } from '../helpers'

export async function checkServiceDiagtrack(): Promise<boolean> {
  return !(await isServiceEnabled('DiagTrack'))
}

export function applicableServiceDiagtrack(): Promise<boolean> {
  return serviceExists('DiagTrack')
}

export async function checkServiceDmwappush(): Promise<boolean> {
  return !(await isServiceEnabled('dmwappushservice'))
}

export function applicableServiceDmwappush(): Promise<boolean> {
  return serviceExists('dmwappushservice')
}

export async function checkServiceDeliveryOptimization(): Promise<boolean> {
  const val = await regQueryDword(
    'HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\DeliveryOptimization',
    'DODownloadMode',
  )
  return val === 0
}

export async function checkServiceMapsbroker(): Promise<boolean> {
  return !(await isServiceEnabled('MapsBroker'))
}

export function applicableServiceMapsbroker(): Promise<boolean> {
  return serviceExists('MapsBroker')
}
