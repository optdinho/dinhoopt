/**
 * Analisador de memoria do engine (canais [RAM] e [PostSaveRAM] do JSONL).
 *
 * Lê o log do Electron (~%APPDATA%/dinho-optimizer/logs/<data>.jsonl), extrai as
 * linhas do engine e responde a pergunta da investigacao: a memoria cresce sem
 * limite (leak) ou enche o buffer e estabiliza (churn normal do GC)?
 *
 * O [RAM] e emitido a ~1Hz durante a captura e carrega todos os planos que
 * importam: proc (working set), gcManaged (heap vivo), native = proc-gcManaged,
 * loh/gen2/gen01, committed, allocated (cumulativo do processo) e gcPause.
 *
 * Como o processo do engine pode reiniciar durante o dia, as amostras sao
 * cortadas em sessoes: allocated so pode crescer dentro de uma sessao, logo uma
 * queda (ou um gap grande de captura) marca o fim de uma. Misturar sessoes faria
 * a "taxa de alocacao" e os slopes mentirem.
 *
 * Uso:
 *   node scripts/analyze-ram-log.js                      # log mais recente
 *   node scripts/analyze-ram-log.js <caminho.jsonl>
 *   node scripts/analyze-ram-log.js <caminho.jsonl> --json
 *
 * Sem dependencias externas (so builtins do Node).
 */

'use strict'

const { readFileSync, existsSync, readdirSync, statSync } = require('node:fs')
const { join } = require('node:path')
const { homedir } = require('node:os')

const STATS = ['proc', 'gcManaged', 'native', 'loh', 'gen2', 'gen01', 'committed', 'allocTotal', 'gcPause']
const GAP_SPLIT_SEC = 120
const ALLOC_RESET_MB = 50

function defaultLogDir() {
  const appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')
  for (const name of ['dinho-optimizer', 'DiNhoClips', 'DiNho-Dev']) {
    const dir = join(appData, name, 'logs')
    if (existsSync(dir)) return dir
  }
  return join(appData, 'dinho-optimizer', 'logs')
}

function newestLog(dir) {
  if (!existsSync(dir)) return null
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => ({ f, m: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m)
  return files.length > 0 ? join(dir, files[0].f) : null
}

/** Extrai pares key=numero da mensagem do engine (aceita virgula decimal). */
function parseFields(message) {
  const out = {}
  for (const part of message.split('|')) {
    const m = part.match(/([A-Za-z0-9_]+)=([\d]+(?:[.,]\d+)?)/)
    if (m) out[m[1]] = Number.parseFloat(m[2].replace(',', '.'))
  }
  return out
}

function parseLog(text) {
  const ram = []
  const postSave = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.includes('[RAM]') && !line.includes('[PostSaveRAM]')) continue
    let entry
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const msg = entry.message || ''
    const ts = new Date(entry.timestamp)
    if (Number.isNaN(ts.getTime())) continue

    if (msg.includes('[PostSaveRAM]')) {
      postSave.push({ ts, msg })
      continue
    }
    const marker = msg.indexOf('[RAM]')
    if (marker < 0) continue
    const f = parseFields(msg.slice(marker + '[RAM]'.length))
    ram.push({
      ts,
      t: ts.getTime() / 1000,
      proc: f.proc,
      gcManaged: f.gcManaged,
      native: f.native,
      loh: f.loh,
      gen2: f.gen2,
      gen01: f.gen01,
      committed: f.committed,
      allocTotal: f.allocated,
      total: f.total,
      gcPause: f.gcPause,
    })
  }
  ram.sort((a, b) => a.t - b.t)
  return { ram, postSave }
}

function splitSessions(ram) {
  const sessions = []
  let current = []
  for (const s of ram) {
    if (current.length > 0) {
      const prev = current[current.length - 1]
      const gap = s.t - prev.t
      const allocReset = Number.isFinite(prev.allocTotal) && Number.isFinite(s.allocTotal) && s.allocTotal < prev.allocTotal - ALLOC_RESET_MB
      if (gap > GAP_SPLIT_SEC || allocReset) {
        sessions.push(current)
        current = []
      }
    }
    current.push(s)
  }
  if (current.length > 0) sessions.push(current)
  return sessions.filter((s) => s.length >= 5)
}

/** Slope por minimos quadrados, em MB por minuto. */
function slopePerMin(samples, key) {
  const pts = samples.filter((s) => Number.isFinite(s[key]))
  if (pts.length < 3) return NaN
  const t0 = pts[0].t
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (const p of pts) {
    const x = (p.t - t0) / 60
    const y = p[key]
    sx += x
    sy += y
    sxx += x * x
    sxy += x * y
  }
  const n = pts.length
  const den = n * sxx - sx * sx
  if (Math.abs(den) < 1e-9) return NaN
  return (n * sxy - sx * sy) / den
}

/** Slopes em tres tercos do regime: distingue rampa-que-estabiliza de leak linear. */
function slopeSegments(samples, key) {
  const n = samples.length
  if (n < 9) return [NaN, NaN, NaN]
  const i = Math.floor(n / 3)
  const j = Math.floor((2 * n) / 3)
  return [
    slopePerMin(samples.slice(0, i), key),
    slopePerMin(samples.slice(i, j), key),
    slopePerMin(samples.slice(j), key),
  ]
}

/**
 * Leitura da forma: num leak a inclinacao se mantem nos tercos; num buffer que
 * enche, a inclinacao cai a ~0 no ultimo terco.
 */
function classify(early, late) {
  if (!Number.isFinite(early) || !Number.isFinite(late)) return 'indeterminado (amostras insuficientes)'
  if (late <= Math.max(5, Math.abs(early) * 0.25)) return 'ESTABILIZOU (compativel com buffer fill)'
  if (late > 30) return 'CRESCIMENTO SUSTENTADO (suspeita de leak)'
  return 'crescimento lento (observar mais tempo)'
}

function round(v, d = 1) {
  return Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v
}

function summarizeSession(samples) {
  const w = samples.filter((s) => s.t - samples[0].t >= 60)
  const steady = w.length >= 5 ? w : samples
  const first = steady[0]
  const last = steady[steady.length - 1]
  const elapsed = last.t - first.t
  const allocChurn = Number.isFinite(first.allocTotal) && Number.isFinite(last.allocTotal) && elapsed > 0
    ? (last.allocTotal - first.allocTotal) / elapsed
    : NaN

  const out = {
    start: samples[0].ts,
    end: samples[samples.length - 1].ts,
    sampleCount: samples.length,
    durationSec: round(samples[samples.length - 1].t - samples[0].t, 0),
    steadyStart: first.ts,
    deltas: {},
    slopes: {},
    segments: {},
    allocChurnPerSec: round(allocChurn, 2),
  }
  for (const k of STATS) {
    if (k === 'allocTotal') continue
    out.deltas[k] = Number.isFinite(first[k]) && Number.isFinite(last[k]) ? round(last[k] - first[k], 0) : NaN
    out.slopes[k] = round(slopePerMin(steady, k), 2)
  }
  for (const k of ['proc', 'committed', 'native', 'gcManaged']) {
    out.segments[k] = slopeSegments(steady, k).map((v) => round(v, 2))
  }
  out.verdict = {
    proc: classify(out.segments.proc[0], out.segments.proc[2]),
    committed: classify(out.segments.committed[0], out.segments.committed[2]),
  }
  return out
}

function fmtTs(d) {
  if (!(d instanceof Date)) return String(d)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtSeg(seg) {
  return seg.map((v) => (Number.isFinite(v) ? `${v >= 0 ? '+' : ''}${v}` : '?')).join(' / ')
}

function printHuman(report) {
  console.log(`Arquivo: ${report.file}`)
  console.log(`Amostras [RAM]: ${report.totalSamples}  |  sessoes: ${report.sessions.length}  |  [PostSaveRAM]: ${report.postSave.length}`)
  console.log('')

  report.sessions.forEach((s, i) => {
    const sec = summarizeSession(s)
    console.log(`== Sessao ${i + 1}: ${fmtTs(sec.start)} -> ${fmtTs(sec.end)}  (${sec.durationSec}s, ${sec.sampleCount} amostras) ==`)
    console.log(`   regime a partir de ${fmtTs(sec.steadyStart)} (primeiros 60s = aquecimento/buffer fill)`)
    const order = ['proc', 'total', 'committed', 'gcManaged', 'native', 'loh', 'gen2']
    for (const k of order) {
      const d = sec.deltas[k]
      const sl = sec.slopes[k]
      if (!Number.isFinite(d)) continue
      const sign = d >= 0 ? '+' : ''
      const label = k === 'total' ? 'ring' : k
      console.log(`   ${label.padEnd(9)} ${sign}${d} MB   slope ${sl >= 0 ? '+' : ''}${sl} MB/min`)
    }
    console.log(`   tercos proc      ${fmtSeg(sec.segments.proc)} MB/min (inicio/meio/fim)`)
    console.log(`   tercos committed ${fmtSeg(sec.segments.committed)} MB/min`)
    console.log(`   allocTotal (cumulativo) churn ${sec.allocChurnPerSec} MB/s`)
    console.log(`   => proc: ${sec.verdict.proc} | committed: ${sec.verdict.committed}`)
    console.log('')
  })

  if (report.postSave.length > 0) {
    console.log('== Vereditos pos-save ==')
    for (const p of report.postSave) {
      if (p.msg.includes('VEREDITO') || p.msg.includes('INDISPONIVEL')) console.log(`   ${fmtTs(p.ts)}  ${p.msg}`)
    }
    console.log('')
  }
}

function main() {
  const args = process.argv.slice(2)
  const asJson = args.includes('--json')
  const printCurve = args.includes('--curve')
  const explicit = args.find((a) => !a.startsWith('--'))
  const file = explicit || newestLog(defaultLogDir())
  if (!file) {
    console.error('Nenhum .jsonl encontrado. Passe o caminho explicitamente.')
    process.exit(1)
  }
  if (!existsSync(file)) {
    console.error(`Arquivo nao existe: ${file}`)
    process.exit(1)
  }

  const { ram, postSave } = parseLog(readFileSync(file, 'utf8'))
  const sessions = splitSessions(ram)

  if (asJson) {
    const summarized = {
      file,
      totalSamples: ram.length,
      postSave: postSave.map((p) => ({ ts: p.ts.toISOString(), msg: p.msg })),
      sessions: sessions.map(summarizeSession),
    }
    console.log(JSON.stringify(summarized, null, 2))
    return
  }

  if (ram.length === 0) {
    console.log(`Arquivo: ${file}`)
    console.log('Nenhuma linha [RAM]/[PostSaveRAM] encontrada (a captura nao correu?).')
    return
  }

  if (printCurve) {
    printCurves({ file, sessions })
    return
  }

  printHuman({ file, totalSamples: ram.length, postSave, sessions })
}

/** Tabela downsampleada: proc vs ring (buffer) vs committed/native por sessao. */
function printCurves(report) {
  console.log(`Arquivo: ${report.file}`)
  report.sessions.forEach((s, i) => {
    console.log('')
    console.log(`== Sessao ${i + 1}: ${fmtTs(s[0].ts)} -> ${fmtTs(s[s.length - 1].ts)} (${s.length} amostras) ==`)
    console.log('   hora      proc   ring   committed  native  gcManaged')
    const max = 20
    const step = Math.max(1, Math.floor(s.length / max))
    for (let k = 0; k < s.length; k += step) {
      const p = s[k]
      const f = (v) => String(Number.isFinite(v) ? v : '-').padStart(5)
      console.log(`   ${fmtTs(p.ts)} ${f(p.proc)}  ${f(p.total)}  ${f(p.committed).padStart(7)}  ${f(p.native).padStart(6)}  ${f(p.gcManaged).padStart(6)}`)
    }
  })
}

main()
