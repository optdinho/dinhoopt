# build-ffmpeg.ps1 — Build minimal ffmpeg for DiNho Clips Engine
# Output: resources/ffmpeg-custom/ffmpeg.exe (~20-30MB)
#
# The set of ffmpeg components enabled here is generated from
# scripts/ffmpeg-requirements.json, which is the single source of truth derived
# from what the C# engine and the TS main process actually pass to ffmpeg.
# After the build, verify-ffmpeg.js fails the build if the produced binary is
# missing any of them — a silently reduced ffmpeg is how a session ends up
# falling back to libx264 with no visible error.
#
# Requires: MSYS2 + mingw-w64 toolchain. The package names below were VERIFIED against
# packages.msys2.org, using the Build Dependencies / Dependencies of MSYS2's own
# mingw-w64-x86_64-ffmpeg (9.0.2) as the reference list, because that is the exact set
# its PKGBUILD links:
#   pacman -S --noconfirm mingw-w64-x86_64-toolchain mingw-w64-x86_64-nasm \
#     mingw-w64-x86_64-pkgconf mingw-w64-x86_64-autotools mingw-w64-x86_64-cc \
#     mingw-w64-x86_64-dlfcn mingw-w64-x86_64-x264 mingw-w64-x86_64-x265 \
#     mingw-w64-x86_64-ffnvcodec-headers mingw-w64-x86_64-libvpl \
#     mingw-w64-x86_64-svt-av1 mingw-w64-x86_64-amf-headers
#
# Names that are easy to get wrong (all three were wrong or unknown before this check):
#   - oneVPL/QSV is mingw-w64-x86_64-libvpl (2.17.0). It *replaces* the older
#     mingw-w64-x86_64-onevpl; there is no package named "libmfx" any more.
#   - SVT-AV1 is mingw-w64-x86_64-svt-av1 — with a hyphen. "svtav1" finds nothing.
#   - AMF is mingw-w64-x86_64-amf-headers (1.5.2) and it ships **headers only**
#     (/mingw64/include/AMF/...), no amfcofw64 import lib. MSYS2's ffmpeg lists it as a
#     build dep and has no amf runtime dep, so mirroring that is the supported path; if
#     configure complains about amfcofw64, the AMF SDK has to be added by hand.
# If one is missing, configure fails loudly instead of quietly shipping a binary
# without that encoder family.

param(
    [string]$Version = "9.0.2",
    [string]$OutputDir = "$PSScriptRoot\..\resources\ffmpeg-custom",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$MSYS2 = "C:\msys64"
$BASH = "$MSYS2\usr\bin\bash.exe"

Write-Host "=== DiNho FFmpeg Custom Build ===" -ForegroundColor Cyan
Write-Host "Version: $Version"
Write-Host "Output:  $OutputDir"
Write-Host ""

# --- Step 0: preflight do toolchain ---
# Sem isto a falha só apareceria lá no fim, dentro do configure do MSYS2, e a mensagem
# seria do ffmpeg — não do pré-requisito que faltou.
$msys2Root = if ($env:MSYS2_ROOT) { $env:MSYS2_ROOT } else { $MSYS2 }
$BASH = Join-Path $msys2Root "usr\bin\bash.exe"
$PACMAN = Join-Path $msys2Root "usr\bin\pacman.exe"

if (-not (Test-Path $BASH) -or -not (Test-Path $PACMAN)) {
    Write-Host "[0/6] MSYS2 nao encontrado em $msys2Root" -ForegroundColor Red
    Write-Host ""
    Write-Host "Instale o MSYS2 e os pacotes de build antes de rodar este script:" -ForegroundColor Yellow
    Write-Host "  1) winget install MSYS2.MSYS2" -ForegroundColor Yellow
    Write-Host "  2) Abrir o 'MSYS2 MinGW x64' e rodar:" -ForegroundColor Yellow
    $pkgs = @(
        "mingw-w64-x86_64-toolchain", "mingw-w64-x86_64-nasm", "mingw-w64-x86_64-pkgconf",
        "mingw-w64-x86_64-autotools", "mingw-w64-x86_64-cc", "mingw-w64-x86_64-dlfcn",
        "mingw-w64-x86_64-x264", "mingw-w64-x86_64-x265", "mingw-w64-x86_64-ffnvcodec-headers",
        "mingw-w64-x86_64-libvpl", "mingw-w64-x86_64-svt-av1", "mingw-w64-x86_64-amf-headers"
    )
    Write-Host "     pacman -S --noconfirm" -ForegroundColor Yellow
    for ($i = 0; $i -lt $pkgs.Count; $i += 3) {
        $chunk = ($pkgs[$i..([Math]::Min($i + 2, $pkgs.Count - 1))] -join " ")
        $suffix = if ($i + 3 -lt $pkgs.Count) { " \" } else { "" }
        Write-Host "       $chunk$suffix" -ForegroundColor Yellow
    }
    Write-Host ""
    Write-Host "Se o MSYS2 estiver em outro caminho, defina MSYS2_ROOT antes de chamar." -ForegroundColor Yellow
    exit 1
}

# --- Step 1: Download ffmpeg source ---
$BUILD_DIR = "$env:TEMP\ffmpeg-build"
$srcDir = "$BUILD_DIR\ffmpeg-$Version"
$tarFile = "$BUILD_DIR\ffmpeg-$Version.tar.xz"
$url = "https://ffmpeg.org/releases/ffmpeg-$Version.tar.xz"

if (-not (Test-Path $srcDir)) {
    Write-Host "[1/6] Downloading ffmpeg $Version source..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $BUILD_DIR -Force | Out-Null
    if (-not (Test-Path $tarFile)) {
        Invoke-WebRequest -Uri $url -OutFile $tarFile -UseBasicParsing
    }
    Write-Host "      Extracting..."
    tar xf $tarFile -C $BUILD_DIR
    if (-not (Test-Path $srcDir)) { throw "Extraction failed" }
} else {
    Write-Host "[1/6] Source already downloaded" -ForegroundColor Green
}

# --- Step 2: Generate MSYS2 build script ---
Write-Host "[2/6] Generating build script..." -ForegroundColor Yellow

$srcMsys = ($srcDir -replace '\\','/')
$outMsys = ($OutputDir -replace '\\','/')

$manifestPath = Join-Path $PSScriptRoot 'ffmpeg-requirements.json'
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

$encoders  = ($manifest.encoders -join ',')
$decoders  = ($manifest.decoders -join ',')
$muxers    = (($manifest.muxers -join ',') + ',concat,av1')
$demuxers  = (($manifest.demuxers -join ',') + ',lavfi,image2,h264,hevc,av1')
$filters   = ($manifest.filters -join ',')
$bsfs      = ($manifest.bsfs -join ',')
$protocols = ($manifest.protocols -join ',')

$buildScript = @"
#!/bin/bash
set -e
export MSYSTEM=MINGW64
export PATH="/mingw64/bin:/usr/bin:/bin:`$PATH"

echo "=== Environment ==="
echo "MSYSTEM=`$MSYSTEM"
uname -a
gcc --version | head -1
echo ""

cd "$srcMsys"

if [ "$($Clean.IsPresent -replace 'True','1' -replace 'False','0')" = "1" ]; then
    echo "=== Cleaning ==="
    make clean 2>/dev/null || true
fi

echo "=== Configuring ==="
./configure \
  --prefix=/mingw64 \
  --enable-gpl \
  --enable-nonfree \
  --disable-everything \
  --disable-doc \
  --disable-htmlpages \
  --disable-manpages \
  --disable-podpages \
  --disable-txtpages \
  --disable-avdevice \
  --enable-static \
  --disable-shared \
  --enable-libx264 \
  --enable-libx265 \
  --enable-nvenc \
  --enable-libvpl \
  --enable-amf \
  --enable-libsvtav1 \
  --enable-encoder=$encoders \
  --enable-decoder=$decoders \
  --enable-muxer=$muxers \
  --enable-demuxer=$demuxers \
  --enable-filter=$filters \
  --enable-bsf=$bsfs \
  --enable-protocol=$protocols \
  --enable-small \
  --pkg-config-flags=--static

# Patch config.mak for MinGW gcc 16.x compatibility:
# MinGW's math.h already provides lrint/llrint/rint as extern declarations,
# but configure can't detect them (no -lm needed on MinGW). Force HAVE_*=1
# so ffmpeg doesn't try to provide conflicting static definitions.
echo ""
echo "=== Patching config.mak for MinGW compatibility ==="
if [ -f ffbuild/config.mak ]; then
  sed -i 's/^HAVE_LRINT=0/HAVE_LRINT=1/' ffbuild/config.mak
  sed -i 's/^HAVE_LRINTF=0/HAVE_LRINTF=1/' ffbuild/config.mak
  sed -i 's/^HAVE_RINT=0/HAVE_RINT=1/' ffbuild/config.mak
  sed -i 's/^HAVE_ROUND=0/HAVE_ROUND=1/' ffbuild/config.mak
  sed -i 's/^HAVE_ROUNDF=0/HAVE_ROUNDF=1/' ffbuild/config.mak
  sed -i 's/^HAVE_TRUNC=0/HAVE_TRUNC=1/' ffbuild/config.mak
  sed -i 's/^HAVE_TRUNCF=0/HAVE_TRUNCF=1/' ffbuild/config.mak
  echo "Forced HAVE_LRINT=1 and related math functions"
fi

echo ""
echo "=== Building ==="
cores=`$(nproc)
echo "Using `$cores parallel jobs"
mingw32-make -j`$cores

echo ""
echo "=== Copying ==="
ls -lh ffmpeg.exe
mkdir -p "$outMsys"
cp ffmpeg.exe "$outMsys/ffmpeg.exe"
echo "Copied to $outMsys/ffmpeg.exe"

echo ""
echo "=== Done ==="
"@

# O preflight (step 0) honra MSYS2_ROOT, mas estes dois paths eram C:\msys64 hardcoded: com
# o MSYS2 instalado em outro lugar o script de build era gravado num tmp que o bash não
# executaria ("/tmp/ffmpeg-build.sh" aponta para $MSYS2_ROOT/tmp, não para C:\msys64\tmp), e
# as DLLs eram procuradas num diretório inexistente — o build só não quebrava em máquinas
# com MSYS2 no caminho padrão, que é onde ninguém testaria.
$msysTmp = Join-Path $msys2Root "tmp"
if (-not (Test-Path $msysTmp)) { New-Item -ItemType Directory -Path $msysTmp -Force | Out-Null }
$msysScriptPath = Join-Path $msysTmp "ffmpeg-build.sh"
[System.IO.File]::WriteAllText($msysScriptPath, $buildScript, [System.Text.UTF8Encoding]::new($false))

# --- Step 4: Build ---
Write-Host "[4/6] Building ffmpeg (this takes 5-15 minutes)..." -ForegroundColor Yellow

$proc = Start-Process -FilePath $BASH -ArgumentList "-l", "/tmp/ffmpeg-build.sh" `
    -Wait -PassThru -NoNewWindow `
    -RedirectStandardOutput "$BUILD_DIR\build-out.log" `
    -RedirectStandardError "$BUILD_DIR\build-err.log"

# Stream output in real-time
if (Test-Path "$BUILD_DIR\build-out.log") {
    Get-Content "$BUILD_DIR\build-out.log" -ErrorAction SilentlyContinue | ForEach-Object {
        if ($_ -match "^===|^Using|^gcc|^make|^-|^warning:|WARNING:") { Write-Host "  $_" }
        elseif ($_ -match "error|Error") { Write-Host "  $_" -ForegroundColor Red }
    }
}

if ($proc.ExitCode -ne 0) {
    Write-Host "BUILD FAILED (exit code $($proc.ExitCode))" -ForegroundColor Red
    if (Test-Path "$BUILD_DIR\build-err.log") {
        Get-Content "$BUILD_DIR\build-err.log" -ErrorAction SilentlyContinue | Select-Object -Last 30 | ForEach-Object {
            Write-Host "  $_" -ForegroundColor Red
        }
    }
    throw "Build failed"
}

# --- Step 5: Copy DLLs ---
Write-Host "[5/6] Copying runtime DLLs..." -ForegroundColor Yellow
$msysBin = Join-Path $msys2Root "mingw64\bin"

# Find DLLs that ffmpeg.exe depends on (from MSYS2)
$neededDlls = @(
    "libbz2-1.dll",
    "libgcc_s_seh-1.dll",
    "libiconv-2.dll",
    "libwinpthread-1.dll",
    "libva.dll",
    "libva_win32.dll",
    "libx264-165.dll",
    "libx265-216.dll",
    "zlib1.dll",
    "libstdc++-6.dll"
)

foreach ($dll in $neededDlls) {
    $src = Join-Path $msysBin $dll
    $dst = Join-Path $OutputDir $dll
    if (Test-Path $src) {
        Copy-Item $src $dst -Force
        $size = [math]::Round((Get-Item $dst).Length / 1KB, 1)
        Write-Host "  $dll ($size KB)"
    } else {
        Write-Host "  WARN: $dll not found in MSYS2" -ForegroundColor Yellow
    }
}

# --- Step 6: Verify ---
Write-Host "[6/6] Verifying requirement gate..." -ForegroundColor Yellow
$ffmpegPath = "$OutputDir\ffmpeg.exe"
if (-not (Test-Path $ffmpegPath)) { throw "ffmpeg.exe not found at $ffmpegPath" }

& $ffmpegPath -version 2>&1 | Select-Object -First 3 | ForEach-Object { Write-Host "  $_" }

Write-Host ""
$verifier = Join-Path $PSScriptRoot 'verify-ffmpeg.js'
& node $verifier --ffmpeg $ffmpegPath --manifest $manifestPath
if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg requirement gate FAILED (exit $LASTEXITCODE) — the build is missing components the engine needs. Do not ship it."
}

$ffmpegSize = [math]::Round((Get-Item $ffmpegPath).Length / 1MB, 1)
$totalSize = [math]::Round((Get-ChildItem $OutputDir -File | Measure-Object -Property Length -Sum).Sum / 1MB, 1)
Write-Host ""
Write-Host "=== Build Complete ===" -ForegroundColor Green
Write-Host "  ffmpeg.exe: $ffmpegSize MB"
Write-Host "  Total (with DLLs): $totalSize MB (was 231 MB)"
Write-Host "  Saved: $([math]::Round(231 - $totalSize, 0)) MB ($([math]::Round((231 - $totalSize) / 231 * 100))%)"
Write-Host "  Path: $OutputDir"
