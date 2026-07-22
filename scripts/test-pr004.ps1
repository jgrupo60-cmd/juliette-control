[CmdletBinding()]
param(
    [string]$FunctionAppName = "juliette-control-api",
    [string]$FunctionResourceGroup = "JULIETTE-CONTROL",
    [string]$SubscriptionNameOrId = "Azure for Students"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

if (-not (Get-Command az -ErrorAction SilentlyContinue)) {
    throw "Required command 'az' was not found in PATH."
}

& az account set --subscription $SubscriptionNameOrId --only-show-errors
if ($LASTEXITCODE -ne 0) {
    throw "Could not select subscription '$SubscriptionNameOrId'."
}

$raw = & az functionapp show `
    --name $FunctionAppName `
    --resource-group $FunctionResourceGroup `
    --only-show-errors `
    --output json 2>&1
if ($LASTEXITCODE -ne 0) {
    throw "Could not find Function App '$FunctionAppName'.`n$($raw -join [Environment]::NewLine)"
}

try {
    $function = (($raw | ForEach-Object { $_.ToString() }) -join [Environment]::NewLine) | ConvertFrom-Json
}
catch {
    throw "Azure CLI did not return valid JSON for the Function App."
}

$hostName = [string]$function.defaultHostName
if ([string]::IsNullOrWhiteSpace($hostName)) {
    throw "Azure did not return the Function App hostname."
}
$base = "https://$hostName"

Write-Host "Health:" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$base/api/health" -Method Get -TimeoutSec 60 | ConvertTo-Json -Depth 8

Write-Host "`nVM status:" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$base/api/vm/status" -Method Get -TimeoutSec 60 | ConvertTo-Json -Depth 8

Write-Host "`nThe /api/vm/start endpoint was not called, so this test cannot start the VM." -ForegroundColor Yellow
