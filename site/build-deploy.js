#!/usr/bin/env node
/**
 * Monta o pacote pronto para deploy no Netlify:
 *
 *   index.html          -> site atual + link para /download/ (patch idempotente)
 *   download/index.html -> página de download (fonte: site/download/index.html)
 *   favicon.png         -> logo extraído da própria página (evita o 404 de /favicon.ico)
 *
 * Uso:
 *   node site/build-deploy.js --landing "C:\caminho\index.html" [--out site/deploy]
 *
 * O bundle é um artefacto: `site/deploy/` está no .gitignore.
 */
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const getArg = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : args[i + 1]
}

const landingPath = getArg('landing')
const outDir = path.resolve(getArg('out') ?? path.join(__dirname, 'deploy'))

if (!landingPath) {
  console.error('Falta --landing <caminho do index.html do site>')
  process.exit(1)
}
if (!fs.existsSync(landingPath)) {
  console.error(`Ficheiro não encontrado: ${landingPath}`)
  process.exit(1)
}

const pageSource = path.join(__dirname, 'download', 'index.html')
const page = fs.readFileSync(pageSource, 'utf8')

// --- logo -> favicon.png (mesma fonte da página, sem binário no repo) ---
const iconMatch = page.match(/<link rel="icon"[^>]*href="data:image\/png;base64,([A-Za-z0-9+/=]+)"/)
if (!iconMatch) {
  console.error('Não encontrei o favicon embutido em site/download/index.html')
  process.exit(1)
}
const favicon = Buffer.from(iconMatch[1], 'base64')

// --- patch do site ---
let html = fs.readFileSync(landingPath, 'utf8')
const originalBytes = Buffer.byteLength(html, 'utf8')
const applied = []

const NAV_ANCHOR = '<a href="#faq" class="h-nav-links">FAQ</a>'

// Botão "Baixar" no menu do topo. Não usa a classe h-nav-links de propósito:
// essa classe é escondida no telemóvel (max-width:900px), e o download tem de
// continuar acessível aí.
const NAV_BUTTON =
  '<a href="/download/" class="h-nav-dl">' +
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/></svg>' +
  '<span>Baixar</span></a>'

// Remove o link discreto de versões anteriores do script, se existir.
html = html.replace('<a href="/download/" class="h-nav-links">Download</a>\n    ', '')

if (!html.includes('class="h-nav-dl"')) {
  if (!html.includes(NAV_ANCHOR)) {
    console.error('Âncora do menu não encontrada — o site mudou de estrutura?')
    process.exit(1)
  }
  html = html.replace(NAV_ANCHOR, `${NAV_ANCHOR}\n    ${NAV_BUTTON}`)
  applied.push('botão "Baixar" no menu do topo')
}

const NAV_CSS = `<style>
.h-nav a.h-nav-dl{display:inline-flex;align-items:center;gap:7px;background:linear-gradient(135deg,var(--purple),var(--orange));color:#fff;text-decoration:none;font-family:'Orbitron',sans-serif;font-weight:700;font-size:11px;letter-spacing:.06em;text-transform:uppercase;padding:9px 16px;border-radius:8px;box-shadow:0 4px 16px rgba(124,58,237,.35);transition:transform .2s,box-shadow .2s;white-space:nowrap}
.h-nav a.h-nav-dl:hover{transform:translateY(-2px);box-shadow:0 6px 22px rgba(249,115,22,.45);color:#fff}
.h-nav a.h-nav-dl svg{width:14px;height:14px;flex-shrink:0}
@media(max-width:900px){.h-nav a.h-nav-dl{font-size:10px;padding:8px 12px;gap:5px}}
</style>`
if (!html.includes('.h-nav a.h-nav-dl{')) {
  html = html.replace('</style>', `</style>\n${NAV_CSS}`)
  applied.push('estilo do botão "Baixar"')
}

const SUB_END = 'Limpa, acelera, protege e repara seu PC em um único app — sem anúncios.</p>'
if (!html.includes('Baixar o app (grátis)')) {
  if (!html.includes(SUB_END)) {
    console.warn('aviso: parágrafo da secção de software não encontrado — botão CTA não inserido')
  } else {
    html = html.replace(
      SUB_END,
      `${SUB_END}\n\n    <div class="reveal" style="margin:-26px 0 40px">\n      <a href="/download/" class="btn-s"><span>Baixar o app (grátis)</span></a>\n    </div>`,
    )
    applied.push('botão "Baixar o app (grátis)" na secção de software')
  }
}

const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1.0">'
if (!html.includes('rel="icon"')) {
  if (html.includes(VIEWPORT)) {
    html = html.replace(VIEWPORT, `${VIEWPORT}\n<link rel="icon" type="image/png" href="/favicon.png">`)
    applied.push('favicon (elimina o 404 de /favicon.ico)')
  }
}

// --- escreve o bundle ---
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(path.join(outDir, 'download'), { recursive: true })
fs.writeFileSync(path.join(outDir, 'index.html'), html, 'utf8')
fs.writeFileSync(path.join(outDir, 'download', 'index.html'), page, 'utf8')
fs.writeFileSync(path.join(outDir, 'favicon.png'), favicon)

console.log(`origem: ${landingPath} (${originalBytes} bytes)`)
console.log(`destino: ${outDir}`)
console.log(applied.length ? `alterações: ${applied.join(' · ')}` : 'alterações: nenhuma (já estava aplicado)')
console.log('---')
for (const f of ['index.html', 'download/index.html', 'favicon.png']) {
  const s = fs.statSync(path.join(outDir, f))
  console.log(`  ${f.padEnd(22)} ${String(s.size).padStart(9)} bytes`)
}
console.log('\nPronto: arraste esta pasta para o Netlify (ou `netlify deploy --dir`).')
