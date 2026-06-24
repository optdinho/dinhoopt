param(
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$ProjectDir = Join-Path $PSScriptRoot "src" "DiNho.Capture.Poc"

if (-not $NoBuild) {
    & "$PSScriptRoot\build.ps1"
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host ""
Write-Host "=== Executando POC de Captura ===" -ForegroundColor Cyan
Write-Host ""

dotnet run --project $ProjectDir -c Release --no-build
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Execução falhou." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host ">>> Relatório gerado acima." -ForegroundColor Green
Write-Host "Critério de saída: p95 < 16ms (60fps)" -ForegroundColor Yellow
