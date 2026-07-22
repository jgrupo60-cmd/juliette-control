[CmdletBinding()]
param(
    [string]$FunctionAppName = "juliette-control-api",
    [string]$FunctionResourceGroup = "JULIETTE-CONTROL"
)

$ErrorActionPreference = "Stop"
$function = az functionapp show --name $FunctionAppName --resource-group $FunctionResourceGroup --only-show-errors | ConvertFrom-Json
$base = "https://$($function.defaultHostName)"

Write-Host "Health:" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$base/api/health" -Method Get | ConvertTo-Json -Depth 8

Write-Host "`nVM status:" -ForegroundColor Cyan
Invoke-RestMethod -Uri "$base/api/vm/status" -Method Get | ConvertTo-Json -Depth 8

Write-Host "`nNo se ejecutó /api/vm/start para evitar encender la VM accidentalmente." -ForegroundColor Yellow
