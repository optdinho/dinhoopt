import path from 'node:path'

const { join } = path.win32

import fs from 'node:fs'
import { homedir } from 'node:os'
import appsJson from '../../../../rules/win32/apps.json'
import browsersJson from '../../../../rules/win32/browsers.json'
import databasesJson from '../../../../rules/win32/databases.json'
import gamingJson from '../../../../rules/win32/gaming.json'
import gpuCacheJson from '../../../../rules/win32/gpu-cache.json'
import miscJson from '../../../../rules/win32/misc.json'
import steamJson from '../../../../rules/win32/steam.json'
// JSON rule files — statically imported, bundled by Vite
import systemJson from '../../../../rules/win32/system.json'
import type { RulesJsonSet } from '../../rules/loader'
import { buildCleanerPaths } from '../../rules/loader'
import type { PlatformPaths, UninstallLeftoverDir } from '../types'

const HOME = homedir()
const LOCALAPPDATA = process.env.LOCALAPPDATA || join(HOME, 'AppData', 'Local')
const APPDATA = process.env.APPDATA || join(HOME, 'AppData', 'Roaming')
const PROGRAMDATA = process.env.ProgramData || 'C:\\ProgramData'
const PROGRAMFILES_X86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
const PROGRAMFILES = process.env.ProgramFiles || 'C:\\Program Files'

const rulesJson: RulesJsonSet = {
  system: systemJson as RulesJsonSet['system'],
  browsers: browsersJson as RulesJsonSet['browsers'],
  apps: appsJson as RulesJsonSet['apps'],
  gaming: gamingJson as RulesJsonSet['gaming'],
  gpuCache: gpuCacheJson as RulesJsonSet['gpuCache'],
  steam: steamJson as RulesJsonSet['steam'],
  databases: databasesJson as RulesJsonSet['databases'],
  misc: miscJson as RulesJsonSet['misc'],
}

const cleanerPaths = buildCleanerPaths(rulesJson, 'win32')

export function getAllUserProfiles(): string[] {
  const usersDir = 'C:\\Users'
  try {
    return fs
      .readdirSync(usersDir)
      .filter((name) => {
        const skip = ['Public', 'Default', 'Default User', 'All Users', 'desktop.ini']
        if (skip.includes(name)) return false
        const fullPath = join(usersDir, name)
        return fs.statSync(fullPath).isDirectory()
      })
      .map((name) => join(usersDir, name))
  } catch {
    return [process.env.USERPROFILE || HOME]
  }
}

export function getMalwareScanDirs(userProfile?: string): string[] {
  const baseDir = userProfile || process.env.USERPROFILE || HOME
  return [
    join(baseDir, 'AppData', 'Local', 'Temp'),
    join(baseDir, 'AppData', 'Local', 'Microsoft', 'Windows', 'Temporary Internet Files'),
    join(baseDir, 'AppData', 'LocalLow'),
    join(baseDir, 'AppData', 'Roaming'),
    join(baseDir, 'Downloads'),
    join(baseDir, 'Desktop'),
  ]
}

export function createWin32Paths(): PlatformPaths {
  return {
    ...cleanerPaths,

    malwareScanDirs() {
      const userProfile = process.env.USERPROFILE || HOME
      return [
        // High-risk: common malware drop locations — deep scan, high file limits
        { path: join(userProfile, 'Downloads'), maxDepth: 6, maxFiles: 10000 },
        { path: join(userProfile, 'Desktop'), maxDepth: 4, maxFiles: 5000 },
        { path: join(userProfile, 'Documents'), maxDepth: 4, maxFiles: 5000 },
        { path: userProfile, maxDepth: 1, maxFiles: 500 },
        { path: join(LOCALAPPDATA, 'Temp'), maxDepth: 4, maxFiles: 10000 },
        { path: join(HOME, 'AppData', 'LocalLow'), maxDepth: 4, maxFiles: 5000 },
        { path: 'C:\\Windows\\Temp', maxDepth: 3, maxFiles: 5000 },
        { path: 'C:\\Users\\Public', maxDepth: 4, maxFiles: 3000 },

        // Medium-risk: persistence & dropper locations — moderate scan
        { path: APPDATA, maxDepth: 5, maxFiles: 8000 },
        { path: LOCALAPPDATA, maxDepth: 4, maxFiles: 8000 },
        { path: PROGRAMDATA, maxDepth: 3, maxFiles: 5000 },

        // Lower-risk: installed programs — shallow scan for trojaned executables
        { path: PROGRAMFILES, maxDepth: 2, maxFiles: 3000 },
        { path: PROGRAMFILES_X86, maxDepth: 2, maxFiles: 3000 },
      ]
    },

    malwareSystemDirs(): string[] {
      return [
        'c:\\windows\\system32',
        'c:\\windows\\syswow64',
        'c:\\windows',
        'c:\\windows\\servicing',
        'c:\\windows\\winsxs',
      ]
    },

    uninstallLeftoverDirs(): UninstallLeftoverDir[] {
      return [
        { id: 'localappdata', name: 'AppData Local', path: LOCALAPPDATA },
        { id: 'appdata', name: 'AppData Roaming', path: APPDATA },
        { id: 'programfiles', name: 'Program Files', path: PROGRAMFILES },
        { id: 'programfiles-x86', name: 'Program Files (x86)', path: PROGRAMFILES_X86 },
        { id: 'programdata', name: 'ProgramData', path: PROGRAMDATA },
      ]
    },
  }
}
