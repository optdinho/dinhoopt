import { machineId } from 'node-machine-id'

export async function generateHwid(): Promise<string> {
  try {
    return await machineId()
  } catch {
    return 'unknown-hwid'
  }
}

export async function getHwProfileRaw(): Promise<string> {
  try {
    return await machineId()
  } catch {
    return 'unknown-hwid'
  }
}
