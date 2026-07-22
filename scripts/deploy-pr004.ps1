[CmdletBinding()]
param(
    [string]$FunctionAppName = "juliette-control-api",
    [string]$FunctionResourceGroup = "JULIETTE-CONTROL",
    [string]$GitHubOrigin = "https://jgrupo60-cmd.github.io"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Require-Command([string]$Name) {
    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "No se encontró '$Name' en PATH. Cierra y vuelve a abrir PowerShell después de instalarlo."
    }
}

Require-Command "az"
Require-Command "func"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ApiPath = Join-Path $RepoRoot "api"
$ConfigPath = Join-Path $RepoRoot "config\app.js"

Write-Host "[1/5] Verificando sesión de Azure..." -ForegroundColor Cyan
try {
    $null = az account show --only-show-errors | ConvertFrom-Json
} catch {
    az login | Out-Host
}

$account = az account show --only-show-errors | ConvertFrom-Json
Write-Host "Suscripción activa: $($account.name)" -ForegroundColor DarkGray

Write-Host "[2/5] Verificando Function App..." -ForegroundColor Cyan
$function = az functionapp show `
    --name $FunctionAppName `
    --resource-group $FunctionResourceGroup `
    --only-show-errors | ConvertFrom-Json

if (-not $function.defaultHostName) {
    throw "Azure no devolvió el hostname de la Function App."
}

Write-Host "[3/5] Configurando CORS para GitHub Pages..." -ForegroundColor Cyan
az functionapp cors add `
    --name $FunctionAppName `
    --resource-group $FunctionResourceGroup `
    --allowed-origins $GitHubOrigin `
    --only-show-errors | Out-Null

Write-Host "[4/5] Publicando Azure Function con compilación remota..." -ForegroundColor Cyan
Push-Location $ApiPath
try {
    func azure functionapp publish $FunctionAppName --build remote
} finally {
    Pop-Location
}

$ApiBaseUrl = "https://$($function.defaultHostName)"
Write-Host "[5/5] Conectando el frontend con $ApiBaseUrl ..." -ForegroundColor Cyan
$config = Get-Content $ConfigPath -Raw
$config = [regex]::Replace(
    $config,
    "apiBaseUrl:\s*'[^']*'",
    "apiBaseUrl: '$ApiBaseUrl'"
)
Set-Content -Path $ConfigPath -Value $config -Encoding UTF8

Write-Host "" 
Write-Host "PR-004 desplegado correctamente." -ForegroundColor Green
Write-Host "API: $ApiBaseUrl/api/health"
Write-Host ""
Write-Host "Ahora revisa config/app.js, prueba la API y luego ejecuta:" -ForegroundColor Yellow
Write-Host "  git add ."
Write-Host '  git commit -m "PR-004: deploy Azure Bridge and connect production frontend"'
Write-Host "  git push origin main"
