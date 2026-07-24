param(
    [ValidateSet("Debug", "Release")]
    [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"
$ProjectDir = Join-Path $PSScriptRoot "src" "DiNho.Capture.Poc"
$ProjectFile = Join-Path $ProjectDir "DiNho.Capture.Poc.csproj"

Write-Host "=== DiNho Clips — Build ($Configuration) ===" -ForegroundColor Cyan
Write-Host "Projeto: $ProjectFile"
Write-Host ""

# Check dotnet
$dotnet = Get-Command "dotnet" -ErrorAction SilentlyContinue
if (-not $dotnet) {
    Write-Host "ERRO: .NET SDK não encontrado. Instale o .NET 9 SDK em:" -ForegroundColor Red
    Write-Host "  https://dotnet.microsoft.com/download/dotnet/9.0"
    exit 1
}

Write-Host "SDK: $(dotnet --version)"

# Restore
Write-Host ""
Write-Host ">>> Restaurando pacotes..." -ForegroundColor Yellow
dotnet restore $ProjectFile
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Falha no restore. Verifique as mensagens acima." -ForegroundColor Red
    exit 1
}

# Build
Write-Host ""
Write-Host ">>> Compilando ($Configuration)..." -ForegroundColor Yellow
dotnet build $ProjectFile -c $Configuration --no-restore
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERRO: Falha no build. Verifique as mensagens acima." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Build concluído com sucesso!" -ForegroundColor Green
Write-Host "Binário: $(Join-Path $ProjectDir "bin" "x64" $Configuration "net10.0-windows10.0.26100.0" "DiNho.Capture.Poc.exe")"
