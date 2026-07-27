import { scannerMethods } from './scanner'
import { systemMethods as core } from './system'

export const systemMethods = {
  ...core,
  ...scannerMethods,
}
