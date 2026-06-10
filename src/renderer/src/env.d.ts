/// <reference types="vite/client" />

import type { DiNhoAPI } from '../../preload/index'

declare module '*.png' {
  const src: string
  export default src
}

declare global {
  interface Window {
    dinho: DiNhoAPI
  }
}
