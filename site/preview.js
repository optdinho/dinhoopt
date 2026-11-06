#!/usr/bin/env node
/**
 * Servidor local que imita o Netlify, para pré-visualizar o pacote de deploy.
 *
 *   node site/preview.js                 # serve site/deploy na porta 8080 e abre o browser
 *   node site/preview.js --port 3000
 *   node site/preview.js --no-open
 *
 * Porque não abrir o index.html com duplo-clique: os links do site são
 * absolutos ("/download/", "/#planos"), como devem ser em produção. Por
 * file:// eles apontam para a raiz do disco (C:\download\) e não encontram
 * nada. Este servidor reproduz o Netlify:
 *
 *   /download   -> 301 -> /download/
 *   /download/  -> download/index.html
 *
 * Só usa módulos nativos do Node.
 */
const fs = require('node:fs')
const http = require('node:http')
const path = require('node:path')
const { exec } = require('node:child_process')

const args = process.argv.slice(2)
const getArg = (name) => {
  const i = args.indexOf(`--${name}`)
  return i === -1 ? null : args[i + 1]
}

const ROOT = path.resolve(getArg('root') ?? path.join(__dirname, 'deploy'))
const START_PORT = Number(getArg('port') ?? 8080)
const OPEN = !args.includes('--no-open')

const entry = path.join(ROOT, 'index.html')
if (!fs.existsSync(entry)) {
  console.error(`Não encontrei ${entry}`)
  console.error('Gera o pacote primeiro:')
  console.error('  node site/build-deploy.js --landing "<index.html do site>"')
  process.exit(1)
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
}

const withinRoot = (file) => file === ROOT || file.startsWith(ROOT + path.sep)

const resolveFile = (urlPath) => {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  const file = path.join(ROOT, clean)
  if (!withinRoot(file)) return null
  return clean.endsWith('/') ? path.join(file, 'index.html') : file
}

const server = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0]

  // Mesmo comportamento do Netlify: /download sem barra redireciona.
  if (urlPath === '/download') {
    res.writeHead(301, { Location: '/download/' })
    res.end()
    console.log('301  /download -> /download/')
    return
  }

  const file = resolveFile(urlPath)
  if (!file) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('403')
    console.log('403 ', urlPath)
    return
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end(`404 — não encontrado: ${urlPath}`)
      console.log('404 ', urlPath)
      return
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    })
    res.end(data)
    console.log('200 ', urlPath)
  })
})

const listen = (port, attemptsLeft) => {
  server.once('error', (err) => {
    if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
      console.log(`porta ${port} ocupada, a tentar ${port + 1}…`)
      listen(port + 1, attemptsLeft - 1)
      return
    }
    console.error('Falhou a iniciar o servidor:', err.message)
    process.exit(1)
  })

  server.listen(port, '127.0.0.1', () => {
    const base = `http://127.0.0.1:${port}`
    console.log(`\n  Site      : ${base}/`)
    console.log(`  Download  : ${base}/download/`)
    console.log('\n  Ctrl+C para parar.\n')
    if (OPEN && process.platform === 'win32') exec(`start "" "${base}/"`)
  })
}

listen(START_PORT, 10)
