const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { _electron: electron } = require('playwright')

const REPO = resolve(__dirname, '..')
const E2E_MARKER = '.dinho-e2e-license'

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : fallback
}

const MINUTES = Number(arg('minutes', '240'))
const SAVE_EVERY = Number(arg('save-every', '30'))
const STATUS_EVERY = Number(arg('status-every', '5'))
const OUT_DIR = resolve(REPO, arg('out', join('soak-out')))
const USER_DATA = resolve(REPO, arg('userdata', join('soak-out', 'userdata')))
const INTERVAL_MS = SAVE_EVERY * 60_000
const TOTAL_MS = MINUTES * 60_000
const SAVES = Math.floor(TOTAL_MS / INTERVAL_MS)

mkdirSync(OUT_DIR, { recursive: true })
mkdirSync(USER_DATA, { recursive: true })
writeFileSync(join(USER_DATA, E2E_MARKER), String(Date.now()), 'utf-8')

const stamp = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
const LOG_FILE = join(OUT_DIR, `soak-${stamp}.log`)
const REPORT_FILE = join(OUT_DIR, `soak-${stamp}.json`)

const report = {
  startedAt: new Date().toISOString(),
  minutes: MINUTES,
  saveEveryMinutes: SAVE_EVERY,
  expectedSaves: SAVES,
  userData: USER_DATA,
  outputDir: null,
  config: null,
  saves: [],
  snapshots: [],
  errors: [],
  fatal: null,
}

function log(line) {
  const stamped = `[${new Date().toISOString()}] ${line}`
  console.log(stamped)
  try {
    appendFileSync(LOG_FILE, `${stamped}\n`, 'utf-8')
  } catch {}
}

function recordError(where, err) {
  const text = err instanceof Error ? `${err.message}\n${err.stack ?? ''}` : String(err)
  report.errors.push({ where, at: new Date().toISOString(), text })
  log(`ERROR ${where}: ${text}`)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let stopping = false

async function snapshot(page) {
  try {
    const s = await page.evaluate(() => window.dinho.clipsGetStatus())
    return {
      at: new Date().toISOString(),
      running: s.running,
      capturing: s.capturing,
      fps: s.fps,
      uptime: s.uptime,
      currentGame: s.currentGame ?? null,
      memoryMB: s.memoryMB ?? null,
      droppedFrames: s.droppedFrames ?? null,
      replayBufferBytes: s.replayBufferBytes ?? null,
      lastClipSize: s.lastClipSize ?? null,
      codec: s.codec ?? null,
    }
  } catch (err) {
    recordError('snapshot', err)
    return null
  }
}

async function waitFor(page, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const s = await page.evaluate(() => window.dinho.clipsGetStatus())
      if (predicate(s)) return s
    } catch {}
    await sleep(1000)
  }
  throw new Error(`timeout waiting for ${label} (${timeoutMs}ms)`)
}

async function saveWithRetry(page, attempt = 1) {
  const result = await page.evaluate(() => window.dinho.clipsSaveClip())
  if (result && result.success) return result
  if (attempt >= 3) return result
  log(`save attempt ${attempt} failed (${result?.error}); retrying in 15s`)
  await sleep(15_000)
  return saveWithRetry(page, attempt + 1)
}

async function run() {
  log(`launching app userData=${USER_DATA}`)
  const app = await electron.launch({
    args: [resolve(REPO, 'out', 'main', 'index.js'), `--dinho-data-dir=${USER_DATA}`],
    env: { ...process.env, NODE_ENV: 'test', DINHO_E2E: '1' },
  })

  app.process().stdout?.on('data', (d) => log(`[app:out] ${String(d).trimEnd()}`))
  app.process().stderr?.on('data', (d) => log(`[app:err] ${String(d).trimEnd()}`))
  app.process().on('exit', (code) => {
    if (stopping) return
    report.fatal = `app process exited early with code ${code}`
    log(report.fatal)
  })

  const page = await app.firstWindow()
  page.on('pageerror', (e) => recordError('pageerror', e))
  await page.waitForLoadState('domcontentloaded')

  await page.evaluate(async () => {
    await window.dinho.onboardingSet?.(true)
  })
  await sleep(500)
  await page.reload()
  await sleep(2500)
  await page.evaluate(() => {
    window.location.hash = '#/clips'
  })
  await sleep(3000)

  await waitFor(page, () => true, 15_000, 'clips API')

  const cfg = await page.evaluate(async () => {
    await window.dinho.clipsSetConfig({
      replayTimeSeconds: 300,
      fps: 60,
      width: 1920,
      height: 1080,
      cq: 20,
      replayBufferMode: 'disk',
    })
    return window.dinho.clipsGetConfig()
  })
  report.config = cfg
  report.outputDir = cfg?.outputDirectory ?? null
  log(`config set: replay=${cfg?.replayTimeSeconds}s fps=${cfg?.fps} cq=${cfg?.cq} out=${report.outputDir}`)

  log('starting engine')
  await page.evaluate(() => window.dinho.clipsStartEngine())
  await waitFor(page, (s) => s.running, 60_000, 'engine running')
  log('engine running')

  log('starting capture')
  let started = false
  for (let i = 1; i <= 6 && !started; i++) {
    const r = await page.evaluate(() => window.dinho.clipsStartCapture())
    if (!r?.success) log(`startCapture attempt ${i}: ${r?.error}`)
    try {
      await waitFor(page, (s) => s.capturing, 15_000, 'capturing')
      started = true
    } catch {
      await sleep(5_000)
    }
  }
  if (!started) throw new Error('capture never started')
  const first = await snapshot(page)
  log(
    `capturing started; currentGame=${first?.currentGame ?? 'NONE'} fps=${first?.fps} codec=${first?.codec}`,
  )
  if (!first?.currentGame) log('WARNING: engine reports no current game target')

  const statusTimer = setInterval(async () => {
    if (stopping) return
    const s = await snapshot(page)
    if (s) report.snapshots.push(s)
  }, STATUS_EVERY * 60_000)

  for (let i = 1; i <= SAVES; i++) {
    await sleep(INTERVAL_MS)
    const before = await snapshot(page)
    const result = await saveWithRetry(page)
    const entry = { index: i, elapsedMinutes: i * SAVE_EVERY, result, statusBeforeSave: before }
    report.saves.push(entry)
    log(
      `save ${i}/${SAVES} at ${entry.elapsedMinutes}min: success=${result?.success} error=${result?.error ?? '-'} size=${before?.lastClipSize ?? '?'} fps=${before?.fps ?? '?'} mem=${before?.memoryMB ?? '?'}`,
    )
  }

  clearInterval(statusTimer)
  stopping = true
  log('soak window complete; stopping')
  await app.close()
}

async function main() {
  const guard = setTimeout(() => {
    report.fatal = 'hard timeout exceeded'
    log('hard timeout; exiting')
    process.exit(2)
  }, TOTAL_MS + 10 * 60_000)
  guard.unref?.()

  process.on('SIGINT', () => {
    stopping = true
    log('SIGINT received')
  })
  process.on('SIGTERM', () => {
    stopping = true
    log('SIGTERM received')
  })

  try {
    await run()
  } catch (err) {
    stopping = true
    recordError('run', err)
    report.fatal = report.fatal ?? String(err)
  } finally {
    report.endedAt = new Date().toISOString()
    try {
      writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8')
      log(`report: ${REPORT_FILE}`)
    } catch (err) {
      log(`failed to write report: ${err}`)
    }
    process.exit(report.fatal ? 1 : 0)
  }
}

main()
