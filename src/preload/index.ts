import { contextBridge } from 'electron'
import { clipsMethods } from './clips'
import { scanMethods } from './scans'
import { systemMethods } from './system'

const api = {
  ...systemMethods,
  ...scanMethods,
  ...clipsMethods,
}

export type DiNhoAPI = typeof api

contextBridge.exposeInMainWorld('dinho', api)
