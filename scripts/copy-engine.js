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
  // Scan TFM dirs (e.g. net10.0-windows10.0.26100.0) for publish subdirs
  const candidates = []
  for (const tfm of readdirSync(base)) {
    const tfmDir = join(base, tfm)
    if (!statSync(tfmDir).isDirectory()) continue
    // Check both publish/ (explicit -o) and win-x64/publish/ (implicit -r)
    for (const sub of ['publish', join('win-x64', 'publish')]) {
      const dir = join(tfmDir, sub)
      const exe = join(dir, 'DiNho.Capture.Poc.exe')
      if (existsSync(exe)) {
        candidates.push({ dir, mtime: statSync(exe).mtimeMs })
      }
    }
  }
  if (candidates.length === 0) return null
  // Pick the most recently built candidate
  candidates.sort((a, b) => b.mtime - a.mtime)
  return candidates[0].dir
}

let publishDir = findPublishDir()

if (!publishDir) {
  const exact = join(projectRoot, 'dinho-clips-poc', 'src', 'DiNho.Capture.Poc', 'bin', 'Release', 'net10.0-windows10.0.26100.0', 'publish')
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

// Also copy ffmpeg.exe + runtime DLLs (needed by engine at runtime)
// Priority: custom build > PATH ffmpeg
try {
  // 1. Check for custom minimal build (from scripts/build-ffmpeg.ps1)
  const customDir = join(projectRoot, 'resources', 'ffmpeg-custom')
  const customFfmpeg = join(customDir, 'ffmpeg.exe')
  if (existsSync(customFfmpeg)) {
    // Copy all files from ffmpeg-custom/ (ffmpeg.exe + DLLs)
    for (const entry of readdirSync(customDir)) {
      const src = join(customDir, entry)
      if (statSync(src).isFile()) {
        cpSync(src, join(stagingDir, entry))
      }
    }
    const mb = (statSync(customFfmpeg).size / 1024 / 1024).toFixed(0)
    const dllCount = readdirSync(customDir).filter(f => f.endsWith('.dll')).length
    console.log(`  Copied custom ffmpeg.exe (${mb}MB) + ${dllCount} DLLs`)
  } else {
    // 2. Fall back to PATH ffmpeg (full build, ~231MB)
    const { execSync } = require('child_process')
    try {
      const srcExe = execSync(
        `powershell -NoProfile -Command "(Get-Command ffmpeg.exe).Source"`,
        { encoding: 'utf-8', timeout: 5000 },
      ).trim()
      if (srcExe && existsSync(srcExe)) {
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
        cpSync(actualExe, join(stagingDir, 'ffmpeg.exe'))
        const mb = (statSync(actualExe).size / 1024 / 1024).toFixed(0)
        console.log(`  Copied PATH ffmpeg.exe (${mb}MB)`)
      } else {
        console.log('  WARN: ffmpeg.exe not found on PATH — engine will fail')
      }
    } catch {
      console.log('  WARN: ffmpeg.exe not found — engine will fail if ffmpeg is unavailable')
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
