/**
 * Copy the .NET engine publish output to a version-independent staging location.
 * electron-builder.yml references resources/clips-engine-staging/ so the
 * framework version in the path doesn't need manual updates.
 */
const { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } = require('node:fs')
const { join } = require('node:path')

const projectRoot = join(__dirname, '..')

function findPublishDir() {
  const base = join(projectRoot, 'dinho-clips-poc', 'src', 'DiNho.Capture.Poc', 'bin', 'Release')
  if (!existsSync(base)) return null
  // Scan TFM dirs (e.g. net9.0-windows10.0.26100.0) for publish subdirs
  for (const tfm of readdirSync(base)) {
    const tfmDir = join(base, tfm)
    if (!statSync(tfmDir).isDirectory()) continue
    // Prefer win-x64/publish (self-contained with -r win-x64)
    const ridPublish = join(tfmDir, 'win-x64', 'publish')
    if (existsSync(join(ridPublish, 'DiNho.Capture.Poc.exe'))) {
      return ridPublish
    }
    // Fallback to publish/ (self-contained without explicit -r)
    const publish = join(tfmDir, 'publish')
    if (existsSync(join(publish, 'DiNho.Capture.Poc.exe'))) {
      return publish
    }
  }
  return null
}

let publishDir = findPublishDir()

if (!publishDir) {
  const exact = join(projectRoot, 'dinho-clips-poc', 'src', 'DiNho.Capture.Poc', 'bin', 'Release', 'net9.0-windows10.0.26100.0', 'publish')
  if (existsSync(exact)) publishDir = exact
}

if (!publishDir) {
  console.error('ERROR: Engine publish directory not found. Build the .NET project first:')
  console.error('  cd dinho-clips-poc/src/DiNho.Capture.Poc && dotnet publish -c Release --self-contained true -r win-x64')
  process.exit(1)
}

const stagingDir = join(projectRoot, 'resources', 'clips-engine-staging')

if (existsSync(stagingDir)) {
  rmSync(stagingDir, { recursive: true, force: true })
}
mkdirSync(stagingDir, { recursive: true })
cpSync(publishDir, stagingDir, { recursive: true })

// Also copy ffmpeg.exe (needed by engine at runtime)
// Try to find them via PowerShell (resolves WinGet symlinks properly)
try {
  const { execSync } = require('child_process')
  for (const tool of ['ffmpeg']) {
    try {
      // PowerShell resolves symlinks; (Get-Command).Source gives the resolved path
      const srcExe = execSync(
        `powershell -NoProfile -Command "(Get-Command ${tool}.exe).Source"`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim()
      if (srcExe && existsSync(srcExe)) {
        // Resolve symlinks (WinGet uses symlinks)
        let actualExe = srcExe
        try {
          const st = require('fs').lstatSync(srcExe)
          if (st.isSymbolicLink()) {
            actualExe = require('fs').readlinkSync(srcExe)
            if (!require('path').isAbsolute(actualExe)) {
              actualExe = require('path').join(require('path').dirname(srcExe), actualExe)
            }
          }
        } catch { /* use srcExe as-is */ }
        cpSync(actualExe, join(stagingDir, `${tool}.exe`))
        const mb = (statSync(actualExe).size / 1024 / 1024).toFixed(0)
        console.log(`  Copied ${tool}.exe (${mb}MB)`)
      } else {
        console.log(`  WARN: ${tool}.exe resolved but not accessible: ${srcExe}`)
      }
    } catch (err) {
      console.log(`  WARN: ${tool}.exe not found on PATH — engine will fail if ffmpeg is unavailable`)
    }
  }
} catch {
  console.log('  WARN: could not copy ffmpeg — engine will fail if ffmpeg is unavailable')
}

let fileCount = 0
function countFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) countFiles(full)
    else fileCount++
  }
}
countFiles(stagingDir)
console.log(`Copied ${fileCount} engine files to ${stagingDir}`)
