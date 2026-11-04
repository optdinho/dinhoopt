import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { IPC } from '@shared/channels'
import { CleanerType } from '@shared/enums'
import type { CleanResult, ScanResult } from '@shared/types'
import { ipcMain } from 'electron'
import { getPlatform } from '../platform'
import { cleanItems, scanDirectory } from '../services/file-utils'
import { validateStringArray } from '../services/ipc-validation'
import { getLogger } from '../services/logger.service'
import { cacheItems, getCachedItem } from '../services/scan-cache'
import { getSettings } from '../services/settings-store'
import type { WindowGetter } from './index'
import { validateSender } from './sender-validation'

/**
 * User data that browser cleaning must never delete, whatever a scan returns.
 * This is a second line of defence on top of the cache-only scanner: if an id
 * ever points at one of these files, the clean handler refuses it.
 */
const PROTECTED_BROWSER_FILES = new Set([
  // Cookies
  'cookies',
  'cookies-journal',
  'cookies.sqlite',
  'cookies.sqlite-wal',
  'cookies.sqlite-shm',
  // Saved logins / passwords
  'login data',
  'login data-journal',
  'logins.json',
  'key3.db',
  'key4.db',
  'signons.sqlite',
  // Autofill / payment data
  'web data',
  'web data-journal',
  // History / bookmarks
  'history',
  'history-journal',
  'places.sqlite',
  'places.sqlite-wal',
  'places.sqlite-shm',
  'bookmarks',
  'bookmarks.html',
  'favicons',
  'top sites',
])

export function isProtectedBrowserFile(filePath: string): boolean {
  const base = filePath.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  return PROTECTED_BROWSER_FILES.has(base)
}

interface ChromiumBrowserDef {
  key: string
  label: string
  base: string
  cache: string
  codeCache: string
  gpuCache: string
  serviceWorker: string
  hasProfiles: boolean
}

export function registerBrowserCleanerIpc(getWindow: WindowGetter): void {
  ipcMain.handle(IPC.BROWSER_SCAN, async (event): Promise<ScanResult[]> => {
    if (!validateSender(event, getWindow())) return []
    getLogger().info('browser-cleaner', 'Starting browser scan...')
    // Browser cleaning is cache-only by design. Cookies, saved logins, passwords,
    // history and bookmarks are never scanned nor deleted.
    const results: ScanResult[] = []
    const category = CleanerType.Browser
    const browserPaths = getPlatform().paths.browserPaths()

    const chromiumBrowsers: ChromiumBrowserDef[] = [
      { key: 'chrome', label: 'Chrome', ...browserPaths.chrome, hasProfiles: true },
      { key: 'edge', label: 'Edge', ...browserPaths.edge, hasProfiles: true },
      { key: 'brave', label: 'Brave', ...browserPaths.brave, hasProfiles: true },
      { key: 'vivaldi', label: 'Vivaldi', ...browserPaths.vivaldi, hasProfiles: true },
      // Opera stores profiles differently — cache is directly under the base path
      { key: 'opera', label: 'Opera', ...browserPaths.opera, hasProfiles: false },
      { key: 'operaGX', label: 'Opera GX', ...browserPaths.operaGX, hasProfiles: false },
      { key: 'arc', label: 'Arc', ...browserPaths.arc, hasProfiles: true },
      { key: 'chromium', label: 'Chromium', ...browserPaths.chromium, hasProfiles: true },
      { key: 'thorium', label: 'Thorium', ...browserPaths.thorium, hasProfiles: true },
      { key: 'supermium', label: 'Supermium', ...browserPaths.supermium, hasProfiles: true },
      { key: 'helium', label: 'Helium', ...browserPaths.helium, hasProfiles: true },
      { key: 'cromite', label: 'Cromite', ...browserPaths.cromite, hasProfiles: true },
      { key: 'catsxp', label: 'CatsXP', ...browserPaths.catsxp, hasProfiles: true },
    ]

    // Scan all Chromium-based browsers
    for (const browser of chromiumBrowsers) {
      if (!existsSync(browser.base)) continue

      if (browser.hasProfiles) {
        const profiles = await getChromiumProfiles(browser.base)
        for (const profile of profiles) {
          const cacheDirs = [
            { dir: browser.cache, label: 'Cache' },
            { dir: browser.codeCache, label: 'Code Cache' },
            { dir: browser.gpuCache, label: 'GPU Cache' },
            { dir: browser.serviceWorker, label: 'Service Worker Cache' },
          ]
          for (const { dir, label } of cacheDirs) {
            const cachePath = join(browser.base, profile, dir)
            if (existsSync(cachePath)) {
              const result = await scanDirectory(cachePath, category, `${browser.label} - ${profile} ${label}`)
              if (result.items.length > 0) {
                cacheItems(result.items)
                results.push(result)
              }
            }
          }
        }
      } else {
        // Opera-style: cache dirs directly under base
        const cacheDirs = [
          { dir: browser.cache, label: 'Cache' },
          { dir: browser.codeCache, label: 'Code Cache' },
          { dir: browser.gpuCache, label: 'GPU Cache' },
          { dir: browser.serviceWorker, label: 'Service Worker Cache' },
        ]
        for (const { dir, label } of cacheDirs) {
          const cachePath = join(browser.base, dir)
          if (existsSync(cachePath)) {
            const result = await scanDirectory(cachePath, category, `${browser.label} - ${label}`)
            if (result.items.length > 0) {
              cacheItems(result.items)
              results.push(result)
            }
          }
        }
      }
    }

    // Firefox
    if (existsSync(browserPaths.firefox.cache)) {
      try {
        const profileDirs = await readdir(browserPaths.firefox.cache, { withFileTypes: true })
        for (const dir of profileDirs) {
          if (dir.isDirectory()) {
            const cachePath = join(browserPaths.firefox.cache, dir.name, 'cache2', 'entries')
            if (existsSync(cachePath)) {
              const result = await scanDirectory(cachePath, category, `Firefox - ${dir.name} Cache`)
              if (result.items.length > 0) {
                cacheItems(result.items)
                results.push(result)
              }
            }
          }
        }
      } catch {
        getLogger().warning('browser-cleaner', 'Skipped inaccessible Firefox cache')
      }
    }
    // Firefox cookies are deliberately never scanned: cookies are user data.

    // Firefox forks — Zen is excluded here because it's already covered by the app scanner (zen-browser in apps.json)
    const firefoxForks = [
      { key: 'librewolf', label: 'LibreWolf', ...browserPaths.librewolf },
      { key: 'waterfox', label: 'Waterfox', ...browserPaths.waterfox },
      { key: 'floorp', label: 'Floorp', ...browserPaths.floorp },
    ]
    for (const fork of firefoxForks) {
      if (!fork.cache || !existsSync(fork.cache)) continue
      try {
        const profileDirs = await readdir(fork.cache, { withFileTypes: true })
        for (const dir of profileDirs) {
          if (dir.isDirectory()) {
            const cachePath = join(fork.cache, dir.name, 'cache2')
            if (existsSync(cachePath)) {
              const result = await scanDirectory(cachePath, category, `${fork.label} - ${dir.name} Cache`)
              if (result.items.length > 0) {
                cacheItems(result.items)
                results.push(result)
              }
            }
          }
        }
      } catch {
        getLogger().warning('browser-cleaner', `Skipped inaccessible ${fork.label} cache`)
      }
    }

    // Safari (macOS only) — cache directory only, never cookies/history/bookmarks
    if (browserPaths.safari && existsSync(browserPaths.safari.cache)) {
      const result = await scanDirectory(browserPaths.safari.cache, category, 'Safari - Cache')
      if (result.items.length > 0) {
        cacheItems(result.items)
        results.push(result)
      }
    }

    const win = getWindow()
    if (win && !win.isDestroyed())
      win.webContents.send(IPC.SCAN_PROGRESS, {
        phase: 'scanning',
        category,
        currentPath: 'Browser scan complete',
        progress: 100,
        itemsFound: results.reduce((s, r) => s + r.itemCount, 0),
        sizeFound: results.reduce((s, r) => s + r.totalSize, 0),
      })

    getLogger().success('browser-cleaner', 'Browser scan completed')
    return results
  })

  ipcMain.handle(IPC.BROWSER_CLEAN, async (event, itemIds: string[]): Promise<CleanResult> => {
    if (!validateSender(event, getWindow()))
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    getLogger().info('browser-cleaner', 'Starting browser clean...')
    const valid = validateStringArray(itemIds)
    if (!valid) {
      getLogger().warning('browser-cleaner', 'Invalid item IDs received for browser clean')
      return { totalCleaned: 0, filesDeleted: 0, filesSkipped: 0, errors: [], needsElevation: false }
    }
    const safeIds = valid.filter((id) => {
      const item = getCachedItem(id)
      return !item || !isProtectedBrowserFile(item.path)
    })
    if (safeIds.length < valid.length) {
      getLogger().warning(
        'browser-cleaner',
        `Refused to delete ${valid.length - safeIds.length} protected browser file(s) (cookies/logins/history)`,
      )
    }
    const settings = getSettings()
    if (settings.cleaner.closeBrowsersBeforeClean) {
      await getPlatform().browser.closeBrowsers()
    }
    return cleanItems(safeIds, (processed, total, currentPath, cleanedSize) => {
      const win = getWindow()
      if (win && !win.isDestroyed())
        win.webContents.send(IPC.SCAN_PROGRESS, {
          phase: 'cleaning',
          category: CleanerType.Browser,
          currentPath,
          progress: total > 0 ? (processed / total) * 100 : 100,
          itemsFound: total,
          sizeFound: cleanedSize,
        })
    }).then((result) => {
      getLogger().success(
        'browser-cleaner',
        `Browser clean completed — ${result.totalCleaned} bytes cleaned, ${result.filesDeleted} files deleted`,
      )
      return result
    })
  })
}

async function getChromiumProfiles(basePath: string): Promise<string[]> {
  const profiles = ['Default']
  try {
    const entries = await readdir(basePath, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('Profile ')) {
        profiles.push(entry.name)
      }
    }
  } catch {
    getLogger().warning('browser-cleaner', 'Skipped inaccessible Chromium profiles directory')
  }
  return profiles
}
