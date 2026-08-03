/**
 * Build + publish the .NET engine FRESH and copy the output to a version-independent
 * staging location. electron-builder.yml references resources/clips-engine-staging/
 * so the framework version in the path doesn't need manual updates.
 *
 * Always publishes from source (into a clean temp dir) instead of reusing stale
 * bin/Release publish folders left by manual `dotnet publish` commands —
 * those can be older than the latest build and would bake old fixes into the
 * installer.
 */
const { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } = require('node:fs')
const { execFileSync } = require('node:child_process')
const { join } = require('node:path')
const { tmpdir } = require('node:os')

const projectRoot = join(__dirname, '..')
const engineProj = join(projectRoot, 'dinho-clips-poc', 'src', 'DiNho.Capture.Poc', 'DiNho.Capture.Poc.csproj')

function publishFresh() {
  const outDir = join(tmpdir(), 'dinhocopy')
  // Clean temp dir so publish is always full & fresh (no incremental cache)
  rmSync(outDir, { recursive: true, force: true })
  mkdirSync(outDir, { recursive: true })
  try {
    console.log('Publishing engine (fresh)...')
    execFileSync('dotnet', [
      'publish', '-c', 'Release',
      '--self-contained', 'true',
      '-r', 'win-x64',
      '-o', outDir,
      engineProj,
    ], { stdio: 'inherit' })
    const exe = join(outDir, 'DiNho.Capture.Poc.exe')
    if (!existsSync(exe)) {
      console.error('ERROR: publish finished but DiNho.Capture.Poc.exe not found')
      process.exit(1)
    }
    return outDir
  } catch (err) {
    console.error('ERROR: dotnet publish failed:', err.message)
    console.error('  cd dinho-clips-poc/src/DiNho.Capture.Poc && dotnet publish -c Release --self-contained true -r win-x64')
    process.exit(1)
  }
}

const publishDir = publishFresh()

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

// Copy VC++ runtime DLLs (needed by ApplicationLoopback.dll — the C++ loopback
// capture is dynamically linked against MSVC CRT, not self-contained).
// Sources are the redist-installed copies under System32 (same machine that
// builds/publishes the engine), which are the proven-compatible versions.
const vcRuntimeDlls = ['msvcp140.dll', 'vcruntime140.dll', 'vcruntime140_1.dll']
const system32 = process.env.SystemRoot ? join(process.env.SystemRoot, 'System32') : null
if (system32 && existsSync(system32)) {
  let copiedVc = 0
  for (const dll of vcRuntimeDlls) {
    const src = join(system32, dll)
    if (existsSync(src)) {
      cpSync(src, join(stagingDir, dll))
      copiedVc++
    }
  }
  console.log(`  Copied ${copiedVc} VC++ runtime DLLs (${vcRuntimeDlls.join(', ')})`)
} else {
  console.log('  WARN: System32 not found — VC++ runtime DLLs not bundled (ApplicationLoopback.dll may fail)')
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

rmSync(publishDir, { recursive: true, force: true })
