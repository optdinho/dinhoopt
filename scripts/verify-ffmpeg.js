const { spawnSync } = require('node:child_process')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')

const CATEGORY_FLAGS = {
  encoders: { arg: '-encoders', kind: 'flags' },
  decoders: { arg: '-decoders', kind: 'flags' },
  muxers: { arg: '-muxers', kind: 'flags' },
  demuxers: { arg: '-demuxers', kind: 'flags' },
  filters: { arg: '-filters', kind: 'arrow' },
  bsfs: { arg: '-bsfs', kind: 'bare' },
  protocols: { arg: '-protocols', kind: 'bare' },
}

const CATEGORIES = Object.keys(CATEGORY_FLAGS)

const FLAGS_LINE = /^\s*([A-Za-z.]{1,6})\s+(\S+)/
const ARROW_LINE = /^\s*\S{1,3}\s+(\S+)\s+[A-Za-z|]+->[A-Za-z|]+/
const BARE_LINE = /^\s*([A-Za-z0-9+_-]+)\s*$/

function addNames(target, raw) {
  for (const name of raw.split(',')) {
    const trimmed = name.trim()
    if (trimmed.length > 0) target.add(trimmed)
  }
}

function parseComponentList(text, kind) {
  const found = new Set()
  if (typeof text !== 'string') return found

  for (const line of text.split(/\r?\n/)) {
    if (kind === 'bare') {
      const bare = BARE_LINE.exec(line)
      if (bare) found.add(bare[1])
      continue
    }

    if (kind === 'arrow') {
      const arrow = ARROW_LINE.exec(line)
      if (arrow) addNames(found, arrow[1])
      continue
    }

    const flags = FLAGS_LINE.exec(line)
    if (flags && flags[2] !== '=') addNames(found, flags[2])
  }

  return found
}

function checkRequirements(requirements, available) {
  const missing = []
  let checked = 0

  for (const category of CATEGORIES) {
    const required = requirements?.[category]
    if (!Array.isArray(required) || required.length === 0) continue

    const present = available?.[category]
    const have = present instanceof Set ? present : new Set()
    checked += required.length

    const names = required.filter((name) => !have.has(name))
    if (names.length > 0) missing.push({ category, names })
  }

  return { ok: missing.length === 0, missing, checked }
}

function formatReport(label, result) {
  const lines = [`ffmpeg-requirements (${label})`]
  for (const entry of result.missing) {
    lines.push(`  MISSING ${entry.category}: ${entry.names.join(', ')}`)
  }
  const absent = result.missing.reduce((total, entry) => total + entry.names.length, 0)
  lines.push(
    result.ok
      ? `  OK: all ${result.checked} required components present`
      : `  FAILED: ${absent} missing of ${result.checked} required components`,
  )
  return lines.join('\n')
}

function readManifest(manifestPath) {
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

function probeAvailable(ffmpegPath, categories = CATEGORIES) {
  const available = {}
  const errors = []

  for (const category of categories) {
    const { arg, kind } = CATEGORY_FLAGS[category]
    const run = spawnSync(ffmpegPath, ['-hide_banner', arg], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    if (run.error) {
      errors.push(`${arg}: ${run.error.message}`)
      available[category] = new Set()
      continue
    }
    available[category] = parseComponentList(`${run.stdout ?? ''}\n${run.stderr ?? ''}`, kind)
  }

  return { available, errors }
}

// Lê o valor de uma flag que exige argumento. Um valor ausente é erro de uso, nunca
// "usa o default": aqui o valor decide *qual binário* o gate julga, e o default
// (`ffmpeg.exe` via PATH) apontaria para outro build — o gate passaria sobre o ffmpeg
// errado, que é o modo de falha mais caro deste script.
function readFlagValue(argv, index, flag) {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`${flag} requires a value (got ${value === undefined ? 'end of args' : `'${value}'`})`)
  }
  return value
}

function parseArgs(argv) {
  const options = { ffmpeg: 'ffmpeg.exe', manifest: join(__dirname, 'ffmpeg-requirements.json') }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--ffmpeg') {
      options.ffmpeg = readFlagValue(argv, index, '--ffmpeg')
      index += 1
      continue
    }
    if (arg === '--manifest') {
      options.manifest = readFlagValue(argv, index, '--manifest')
      index += 1
      continue
    }
    if (arg.startsWith('--ffmpeg=')) {
      options.ffmpeg = arg.slice('--ffmpeg='.length)
      continue
    }
    if (arg.startsWith('--manifest=')) {
      options.manifest = arg.slice('--manifest='.length)
      continue
    }
  }
  return options
}

function main(argv = []) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`ffmpeg-requirements: ${error.message}\n`)
    return 2
  }

  let manifest
  try {
    manifest = readManifest(options.manifest)
  } catch (error) {
    process.stderr.write(`ffmpeg-requirements: cannot read manifest ${options.manifest}: ${error.message}\n`)
    return 2
  }

  const { available, errors } = probeAvailable(options.ffmpeg)
  if (errors.length > 0) {
    process.stderr.write(`ffmpeg-requirements: cannot query ${options.ffmpeg}\n`)
    for (const error of errors) process.stderr.write(`  ${error}\n`)
    return 2
  }

  const result = checkRequirements(manifest, available)
  process.stdout.write(`${formatReport(options.ffmpeg, result)}\n`)
  return result.ok ? 0 : 1
}

module.exports = {
  CATEGORIES,
  CATEGORY_FLAGS,
  checkRequirements,
  formatReport,
  main,
  parseArgs,
  parseComponentList,
  probeAvailable,
  readManifest,
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)))
}
