export interface IpcSuccess<T = unknown> {
  success: true
  data?: T
}

export interface IpcError {
  success: false
  error: string
  code?: string
}

export type IpcResult<T = unknown> = IpcSuccess<T> | IpcError
