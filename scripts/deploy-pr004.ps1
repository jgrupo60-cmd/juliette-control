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
        throw "No se encontró '$Name' en PATH."
    }
}

Require-Command "az"
Require-Command "func"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$ApiPath = Join-Path $RepoRoot "api"
$ConfigPath = Join-Path $RepoRoot "config\app.js"

if (-not (Test-Path $ApiPath)) {
    throw "No se encontró la carpeta API: $ApiPath"
}
if (-not (Test-Path $ConfigPath)) {
    throw "No se encontró el archivo de configuración: $ConfigPath"
}

Write-Host "[1/5] Verificando sesión de Azure..." -ForegroundColor Cyan
az account show --only-show-errors *> $null
if ($LASTEXITCODE -ne 0) {
    az login | Out-Host
    if ($LASTEXITCODE -ne 0) {
        throw "No fue posible iniciar sesión en Azure."
    }
}

$SubscriptionName = az account show --query "name" --output tsv --only-show-errors
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace([string]$SubscriptionName)) {
    throw "Azure CLI no devolvió la suscripción activa."
}
Write-Host "Suscripción activa: $SubscriptionName" -ForegroundColor DarkGray

Write-Host "[2/5] Verificando Function App..." -ForegroundColor Cyan
$FunctionHostName = az functionapp list `
    --resource-group $FunctionResourceGroup `
    --query "[?name=='$FunctionAppName'].defaultHostName | [0]" `
    --output tsv `
    --only-show-errors

if ($LASTEXITCODE -ne 0) {
    throw "Azure CLI no pudo consultar la Function App '$FunctionAppName'."
}

$FunctionHostName = ([string]$FunctionHostName).Trim()
if ([string]::IsNullOrWhiteSpace($FunctionHostName)) {
    throw "No se encontró la Function App '$FunctionAppName' en '$FunctionResourceGroup', o Azure no devolvió su hostname."
}

$ApiBaseUrl = "https://$FunctionHostName"
Write-Host "Function App encontrada: $FunctionHostName" -ForegroundColor DarkGray

Write-Host "[3/5] Configurando CORS para GitHub Pages..." -ForegroundColor Cyan
az functionapp cors add `
    --name $FunctionAppName `
    --resource-group $FunctionResourceGroup `
    --allowed-origins $GitHubOrigin `
    --only-show-errors | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "No se pudo configurar CORS."
}

Write-Host "[4/5] Publicando Azure Function con compilación remota..." -ForegroundColor Cyan
Push-Location $ApiPath
try {
    func azure functionapp publish $FunctionAppName --python --build remote
    if ($LASTEXITCODE -ne 0) {
        throw "La publicación de Azure Functions falló con código $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

Write-Host "[5/5] Conectando el frontend con $ApiBaseUrl ..." -ForegroundColor Cyan
$config = Get-Content $ConfigPath -Raw
$updatedConfig = [regex]::Replace(
    $config,
    "apiBaseUrl:\s*'[^']*'",
    "apiBaseUrl: '$ApiBaseUrl'"
)

if ($updatedConfig -eq $config -and $config -notmatch [regex]::Escape("apiBaseUrl: '$ApiBaseUrl'")) {
    throw "No se encontró la propiedad apiBaseUrl en config/app.js."
}

Set-Content -Path $ConfigPath -Value $updatedConfig -Encoding UTF8

Write-Host ""
Write-Host "Despliegue completado correctamente." -ForegroundColor Green
Write-Host "API base: $ApiBaseUrl"
Write-Host ""
Write-Host "Ahora ejecuta:" -ForegroundColor Yellow
Write-Host "  git status"
Write-Host "  git add -A"
Write-Host '  git commit -m "Simplify Juliette Control Center"'
Write-Host "  git push origin main"
