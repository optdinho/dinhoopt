declare const __APP_VERSION__: string

/**
 * App version injected at build time by electron-vite (`define` in electron.vite.config.ts).
 * In the test environment the global is not defined, so `typeof` (which never throws on an
 * undeclared identifier) guards the access and falls back to a sentinel.
 */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
