#!/usr/bin/env node
// ─── Interactive CLI Rule Generator ──────────────────────────
// Creates new cleaner rule entries by prompting for app details.
// Run: npm run new-rule

const { createInterface } = require('node:readline')
const { readFileSync, writeFileSync } = require('node:fs')
const path = require('node:path')

const RULES_DIR = path.resolve(__dirname, '..', 'rules')

const PLATFORM_VARS = {
  win32: ['${HOME}', '${LOCALAPPDATA}', '${APPDATA}', '${WINDIR}', '${PROGRAMDATA}', '${PROGRAMFILES}', '${TMPDIR}'],
  darwin: ['${HOME}', '${LIBRARY}', '${CACHES}', '${APP_SUPPORT}', '${TMPDIR}'],
  linux: ['${HOME}', '${CONFIG}', '${CACHE}', '${LOCAL_SHARE}', '${TMPDIR}'],
}

const CATEGORIES = {
  apps: 'apps.json',
  gaming: 'gaming.json',
  'gpu-cache': 'gpu-cache.json',
}

const CHROMIUM_SUBDIRS = ['Cache/Cache_Data', 'Code Cache', 'GPUCache']

const rl = createInterface({ input: process.stdin, output: process.stdout })

function ask(question, defaultVal) {
  const suffix = defaultVal ? ` (${defaultVal})` : ''
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => {
      resolve(answer.trim() || defaultVal || '')
    })
  })
}

function askYesNo(question, defaultVal = true) {
  const hint = defaultVal ? 'Y/n' : 'y/N'
  return new Promise((resolve) => {
    rl.question(`${question} [${hint}]: `, (answer) => {
      const a = answer.trim().toLowerCase()
      if (!a) return resolve(defaultVal)
      resolve(a === 'y' || a === 'yes')
    })
  })
}

function toId(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function insertSorted(apps, newApp) {
  const idx = apps.findIndex((a) => a.name.localeCompare(newApp.name) > 0)
  if (idx === -1) {
    apps.push(newApp)
  } else {
    apps.splice(idx, 0, newApp)
  }
}

async function main() {

  // App name
  const name = await ask('App display name (e.g. "Notion")')
  if (!name) {
    process.exit(1)
  }

  // App ID
  const suggestedId = toId(name)
  const id = await ask('App ID (lowercase-with-hyphens)', suggestedId)
  const category = await ask('Category', 'apps')
  if (!CATEGORIES[category]) {
    process.exit(1)
  }
  const targetFile = CATEGORIES[category]
  const platformInput = await ask('Platforms', 'win32,darwin,linux')
  const platforms = platformInput
    .split(',')
    .map((p) => p.trim())
    .filter((p) => PLATFORM_VARS[p])

  if (platforms.length === 0) {
    process.exit(1)
  }

  // Is it a Chromium/Electron app?
  const isElectron = await askYesNo('\nIs this a Chromium/Electron app? (auto-adds Cache_Data, Code Cache, GPUCache)')

  // Collect paths per platform
  const platformPaths = {}
  for (const platform of platforms) {

    if (isElectron) {
      const basePath = await ask('Base path to app data (e.g. ${APPDATA}/Notion)')
      if (!basePath) {
        process.exit(1)
      }
      platformPaths[platform] = CHROMIUM_SUBDIRS.map((sub) => `${basePath}/${sub}`)
      for (const p of platformPaths[platform]) {
      }
      const extraPaths = await ask('Additional paths? (comma-separated, or Enter to skip)')
      if (extraPaths) {
        platformPaths[platform].push(...extraPaths.split(',').map((p) => p.trim()))
      }
    } else {
      const paths = await ask('Cache paths (comma-separated)')
      if (!paths) {
        process.exit(1)
      }
      platformPaths[platform] = paths.split(',').map((p) => p.trim())
    }
  }

  // Optional childSubdir
  const childSubdir = await ask('\nchildSubdir? (leave empty if not needed)')

  // Optional description
  const description = await ask("Description (what gets cleaned and why it's safe)")
  for (const platform of platforms) {
    for (const p of platformPaths[platform]) {
    }
  }
  if (childSubdir) 
  if (description) 

  const confirmed = await askYesNo('\nWrite these entries?')
  if (!confirmed) {
    process.exit(0)
  }

  // Write to each platform file
  let filesModified = 0
  for (const platform of platforms) {
    const filePath = path.join(RULES_DIR, platform, targetFile)
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))

    // Check for duplicate ID
    if (data.apps.some((a) => a.id === id)) {
      continue
    }

    const entry = { id, name, paths: platformPaths[platform] }
    if (childSubdir) entry.childSubdir = childSubdir
    if (description) entry.description = description

    insertSorted(data.apps, entry)
    writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`)
    filesModified++
  }

  if (filesModified > 0) {
  }

  rl.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
